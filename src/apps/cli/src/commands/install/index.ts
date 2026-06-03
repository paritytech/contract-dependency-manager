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
} from "@dotdm/env";
import {
    CONTRACTS_REGISTRY_ABI,
    hasBuildableSolidityProject,
    readCdmJson,
    writeCdmJson,
} from "@dotdm/contracts";
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
    .option("--assethub-url <url>", "WebSocket URL for Asset Hub chain", DEFAULT_NODE_URL)
    .option("-n, --name <name>", "Chain preset name (polkadot, paseo, local)")
    .option("--ipfs-gateway-url <url>", "IPFS gateway URL for fetching metadata")
    .option("--registry-address <address>", "Registry contract address");

type InstallOptions = {
    assethubUrl: string;
    name?: string;
    ipfsGatewayUrl?: string;
    registryAddress?: string;
};

install.action(async (libraries: string[], opts: InstallOptions) => {
    const cdmResult = readCdmJson();
    const cdmJson = cdmResult?.cdmJson ?? { dependencies: {}, contracts: {} };

    // Resolve chain preset
    if (opts.name && opts.name !== "custom") {
        const preset = getChainPreset(opts.name);
        opts.assethubUrl =
            opts.assethubUrl === DEFAULT_NODE_URL ? preset.assethubUrl : opts.assethubUrl;
        opts.ipfsGatewayUrl = opts.ipfsGatewayUrl ?? preset.ipfsGatewayUrl;
        opts.registryAddress = opts.registryAddress ?? preset.registryAddress;
    }

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
