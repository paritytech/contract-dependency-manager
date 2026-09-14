import { Command } from "commander";
import { resolve } from "path";
import { getChainPreset, getRegistryAddress } from "@parity/cdm-env";
import { readCdmJson, resolveFeatures } from "@parity/cdm-builder";
import { runBuildWithUI } from "../lib/ui";

const build = new Command("build")
    .description("Build all contracts")
    .option("--contracts <names...>", "Only build specific contracts")
    .option("--features <features>", "Cargo feature flags to pass to the build")
    .option("-n, --name <name>", "Chain preset name (polkadot, paseo, devnet, local)")
    .option("--registry-address <address>", "Registry contract address to embed")
    .option("--root <path>", "Workspace root directory", process.cwd());

type BuildOptions = {
    contracts?: string[];
    features?: string;
    name?: string;
    registryAddress?: string;
    root: string;
};

function resolveRegistryAddress(rootDir: string, opts: BuildOptions): string {
    warnOnStaleCdmJsonRegistry(rootDir, opts);
    if (opts.registryAddress) return opts.registryAddress;
    if (opts.name && opts.name !== "custom") {
        return getChainPreset(opts.name).registryAddress ?? getRegistryAddress(opts.name);
    }

    const cdmResult = readCdmJson(rootDir);
    return cdmResult?.cdmJson.registry ?? getRegistryAddress();
}

/**
 * Warn when `cdm.json.registry` disagrees with the registry address of the
 * selected (or default) network preset: `cdm.json` is a snapshot written by a
 * past `cdm install`, so after a registry redeploy a stale project would
 * silently bake the outdated address into its contracts.
 */
function warnOnStaleCdmJsonRegistry(rootDir: string, opts: BuildOptions): void {
    const cdmRegistry = readCdmJson(rootDir)?.cdmJson.registry;
    if (!cdmRegistry) return;

    let presetAddress: string | undefined;
    try {
        presetAddress =
            opts.name && opts.name !== "custom"
                ? (getChainPreset(opts.name).registryAddress ?? getRegistryAddress(opts.name))
                : getRegistryAddress();
    } catch {
        return; // unknown chain name errors are surfaced by the resolution below
    }

    if (presetAddress && cdmRegistry.toLowerCase() !== presetAddress.toLowerCase()) {
        const cdmJsonWins = !opts.registryAddress && !(opts.name && opts.name !== "custom");
        const hint = cdmJsonWins
            ? "This build will embed the cdm.json address — re-run `cdm install` if it is stale."
            : "The explicitly selected address wins for this build; re-run `cdm install` to refresh cdm.json.";
        console.warn(
            `Warning: cdm.json pins registry ${cdmRegistry}, but the ${opts.name ?? "default"} ` +
                `network preset uses ${presetAddress}. ${hint}`,
        );
    }
}

build.action(async (opts: BuildOptions) => {
    const rootDir = resolve(opts.root);
    console.log(`Root: ${rootDir}\n`);

    const features = resolveFeatures(opts.features, rootDir);
    const registryAddress = resolveRegistryAddress(rootDir, opts);

    const { result } = await runBuildWithUI({
        rootDir,
        contracts: opts.contracts,
        features,
        registryAddress: registryAddress as `0x${string}`,
    });

    if (!result.success) {
        process.exit(1);
    }
});

export const buildCommand = build;
