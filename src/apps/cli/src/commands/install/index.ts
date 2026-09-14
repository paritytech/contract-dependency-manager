import { existsSync } from "fs";
import { resolve } from "path";
import { Command } from "commander";
import type { HexString } from "polkadot-api";
import { createContractFromClient } from "@parity/product-sdk-contracts";
import {
    createCdmAssetHubClient,
    connectIpfsGateway,
    getChainPreset,
    getRegistryAddress,
    DEFAULT_NODE_URL,
    resolveQueryOrigin,
} from "@parity/cdm-env";
import {
    CONTRACTS_REGISTRY_ABI,
    hasBuildableSolidityProject,
    readCdmJson,
    writeCdmJson,
} from "@parity/cdm-builder";
import { spinner } from "../../lib/ui";
import { runInstallWithUI } from "../../lib/install-pipeline";
import type { InstallResult } from "../../lib/install-pipeline";
import { postInstallRust } from "./rust";
import { postInstallSolidity } from "./solidity";
import { postInstallTypeScript } from "./typescript";

export type { InstallResult } from "../../lib/install-pipeline";

function detectProjectType(dir: string): {
    hasRust: boolean;
    hasSolidity: boolean;
    hasTypeScript: boolean;
} {
    return {
        hasRust: existsSync(resolve(dir, "Cargo.toml")),
        hasSolidity: hasBuildableSolidityProject(dir),
        hasTypeScript: existsSync(resolve(dir, "package.json")),
    };
}

function parseLibraryArg(arg: string): { library: string; version: number | "latest" } {
    const colonIdx = arg.lastIndexOf(":");
    if (colonIdx > 0) {
        const lib = arg.slice(0, colonIdx);
        const ver = parseInt(arg.slice(colonIdx + 1), 10);
        if (!isNaN(ver)) return { library: lib, version: ver };
    }
    return { library: arg, version: "latest" };
}

const install = new Command("install")
    .alias("i")
    .description("Install CDM contract libraries")
    .argument(
        "[libraries...]",
        'CDM libraries (e.g., "@polkadot/reputation" or "@polkadot/reputation:3"). Omit to install all from cdm.json.',
    )
    .option("--assethub-url <url>", "WebSocket URL for Asset Hub chain")
    .option("-n, --name <name>", "Chain preset name (polkadot, paseo, devnet, local)")
    .option("--ipfs-gateway-url <url>", "IPFS gateway URL for fetching metadata")
    .option("--registry-address <address>", "Registry contract address");

type InstallOptions = {
    assethubUrl?: string;
    name?: string;
    ipfsGatewayUrl?: string;
    registryAddress?: string;
};

/**
 * Resolve connection options: explicit flags >> chain preset >> default URL.
 * `--assethub-url` has no commander default so an explicitly passed URL always
 * wins over `--name`'s preset — even when it happens to equal the default.
 * Matches the deploy command's resolution pattern.
 */
export function resolveInstallOptions(opts: InstallOptions): InstallOptions & {
    assethubUrl: string;
} {
    const resolved = { ...opts };
    if (resolved.name && resolved.name !== "custom") {
        const preset = getChainPreset(resolved.name);
        resolved.assethubUrl = resolved.assethubUrl ?? preset.assethubUrl;
        resolved.ipfsGatewayUrl = resolved.ipfsGatewayUrl ?? preset.ipfsGatewayUrl;
        resolved.registryAddress = resolved.registryAddress ?? preset.registryAddress;
    }
    return { ...resolved, assethubUrl: resolved.assethubUrl ?? DEFAULT_NODE_URL };
}

install.action(async (libraries: string[], rawOpts: InstallOptions) => {
    const cdmResult = readCdmJson();
    const cdmJson = cdmResult?.cdmJson ?? { dependencies: {}, contracts: {} };

    const opts = resolveInstallOptions(rawOpts);

    if (!opts.ipfsGatewayUrl) {
        console.error(
            "Error: IPFS gateway URL required to fetch metadata. Use --ipfs-gateway-url or --name for a preset.",
        );
        process.exit(1);
    }

    const registryAddress = opts.registryAddress ?? getRegistryAddress(opts.name);
    const artifactsDir = resolve(process.cwd(), ".cdm");

    // Connect to chain with spinner (matching deploy command style)
    const sp = spinner("AssetHub", opts.assethubUrl);
    const chainClient = await createCdmAssetHubClient(opts.assethubUrl, opts.name);
    await chainClient.raw.assetHub.getChainSpecData();
    sp.succeed();

    const registry = await createContractFromClient(
        chainClient.raw.assetHub,
        chainClient.descriptors.assetHub,
        registryAddress as HexString,
        CONTRACTS_REGISTRY_ABI,
        {
            defaultOrigin: resolveQueryOrigin({
                chainName: opts.name,
                assethubUrl: opts.assethubUrl,
            }),
        },
    );
    const ipfs = connectIpfsGateway(opts.ipfsGatewayUrl);

    cdmJson.registry = registryAddress;

    // Determine what to install
    let toInstall: { library: string; requestedVersion: number | "latest" }[];

    if (libraries.length > 0) {
        toInstall = libraries.map((arg) => {
            const parsed = parseLibraryArg(arg);
            return { library: parsed.library, requestedVersion: parsed.version };
        });
    } else {
        // Batch install: read from cdm.json
        const deps = cdmJson.dependencies;
        if (Object.keys(deps).length === 0) {
            console.error("Error: No library specified and no dependencies found in cdm.json.");
            chainClient.destroy();
            process.exit(1);
        }
        toInstall = Object.entries(deps).map(([lib, ver]) => ({
            library: lib,
            requestedVersion: ver === "latest" ? ("latest" as const) : Number(ver),
        }));
    }

    // Detect project type early for header display
    const projectType = detectProjectType(process.cwd());

    // Header (matching deploy command style)
    console.log(`\x1b[1mRegistry\x1b[0m   ${registryAddress}`);
    console.log(
        `\x1b[1mRust\x1b[0m ${projectType.hasRust ? "\x1b[32m✔\x1b[0m" : "\x1b[2m-\x1b[0m"}` +
            `  \x1b[1mSolidity\x1b[0m ${projectType.hasSolidity ? "\x1b[32m✔\x1b[0m" : "\x1b[2m-\x1b[0m"}` +
            `  \x1b[1mTypeScript\x1b[0m ${projectType.hasTypeScript ? "\x1b[32m✔\x1b[0m" : "\x1b[2m-\x1b[0m"}`,
    );

    // Run parallel install with Ink table UI
    const { results, success } = await runInstallWithUI({
        libraries: toInstall,
        registry,
        registryAddress,
        ipfs,
        artifactsDir,
        ipfsGatewayUrl: opts.ipfsGatewayUrl,
    });

    // Update cdm.json dependencies and contracts for successful installs
    if (!cdmJson.contracts) cdmJson.contracts = {};

    for (const result of results) {
        const entry = toInstall.find((t) => t.library === result.library);
        if (entry) {
            cdmJson.dependencies[result.library] = entry.requestedVersion;
            cdmJson.contracts[result.library] = {
                version: result.version,
                address: result.address,
                abi: result.abi,
                metadataCid: result.metadataCid,
            };
        }
    }

    writeCdmJson(cdmJson);

    // Run post-install hooks and update status line
    if (results.length > 0) {
        if (projectType.hasRust) {
            await postInstallRust();
        }
        if (projectType.hasSolidity) {
            await postInstallSolidity();
        }
        if (projectType.hasTypeScript) {
            await postInstallTypeScript();
        }
    }

    chainClient.destroy();

    if (!success) {
        process.exit(1);
    }
});

export const installCommand = install;

if (import.meta.vitest) {
    const { describe, expect, test } = import.meta.vitest;

    describe("resolveInstallOptions", () => {
        test("an explicitly passed Asset Hub URL wins over the preset even when it equals the default", () => {
            const resolved = resolveInstallOptions({
                assethubUrl: DEFAULT_NODE_URL,
                name: "paseo",
            });
            expect(resolved.assethubUrl).toBe(DEFAULT_NODE_URL);
        });

        test("the preset fills in URLs that were not passed explicitly", () => {
            const preset = getChainPreset("paseo");
            const resolved = resolveInstallOptions({ name: "paseo" });
            expect(resolved.assethubUrl).toBe(preset.assethubUrl);
            expect(resolved.ipfsGatewayUrl).toBe(preset.ipfsGatewayUrl);
            expect(resolved.registryAddress).toBe(preset.registryAddress);
        });

        test("falls back to the default node URL when neither a URL nor a preset is given", () => {
            expect(resolveInstallOptions({}).assethubUrl).toBe(DEFAULT_NODE_URL);
        });
    });
}
