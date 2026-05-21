import { Command } from "commander";
import { resolve } from "path";
import { getChainPreset, getRegistryAddress } from "@dotdm/env";
import { readCdmJson, resolveFeatures, resolveTargetRegistryAddress } from "@dotdm/contracts";
import { runBuildWithUI } from "../lib/ui";

const build = new Command("build")
    .description("Build all contracts")
    .option("--contracts <names...>", "Only build specific contracts")
    .option("--features <features>", "Cargo feature flags to pass to the build")
    .option("-n, --name <name>", "Chain preset name (polkadot, paseo, preview-net, local)")
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
    if (opts.registryAddress) return opts.registryAddress;
    if (opts.name && opts.name !== "custom") {
        return getChainPreset(opts.name).registryAddress ?? getRegistryAddress(opts.name);
    }

    const cdmResult = readCdmJson(rootDir);
    const target = Object.values(cdmResult?.cdmJson.targets ?? {})[0];
    return target ? resolveTargetRegistryAddress(target) : getRegistryAddress();
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
