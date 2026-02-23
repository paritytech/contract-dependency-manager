import { existsSync } from "fs";
import { resolve } from "path";
import { Command } from "commander";
import { contracts } from "@dotdm/descriptors";
import { createInkSdk } from "@polkadot-api/sdk-ink";
import {
    connectAssetHubWebSocket,
    connectIpfsGateway,
    getChainPreset,
    DEFAULT_NODE_URL,
} from "@dotdm/env";
import { computeTargetHash, readCdmJson, writeCdmJson } from "@dotdm/contracts";
import { spinner } from "../../lib/ui";
import { runInstallWithUI } from "../../lib/install-pipeline";
import type { InstallResult } from "../../lib/install-pipeline";
import { postInstallRust } from "./rust";
import { postInstallTypeScript } from "./typescript";

export type { InstallResult } from "../../lib/install-pipeline";

function detectProjectType(dir: string): { hasRust: boolean; hasTypeScript: boolean } {
    return {
        hasRust: existsSync(resolve(dir, "Cargo.toml")),
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
    .description("Install CDM contract libraries to ~/.cdm/")
    .argument(
        "[libraries...]",
        'CDM libraries (e.g., "@polkadot/reputation" or "@polkadot/reputation:3"). Omit to install all from cdm.json.',
    )
    .option("--assethub-url <url>", "WebSocket URL for Asset Hub chain", DEFAULT_NODE_URL)
    .option(
        "--registry-address <address>",
        "Registry contract address (or set CONTRACTS_REGISTRY_ADDR env var)",
    )
    .option("-n, --name <name>", "Chain preset name (polkadot, paseo, preview-net, local)")
    .option("--ipfs-gateway-url <url>", "IPFS gateway URL for fetching metadata");

type InstallOptions = {
    assethubUrl: string;
    registryAddress?: string;
    name?: string;
    ipfsGatewayUrl?: string;
};

install.action(async (libraries: string[], opts: InstallOptions) => {
    // Read cdm.json early so its target info can fill in missing options
    const cdmResult = readCdmJson();
    const cdmJson = cdmResult?.cdmJson ?? { targets: {}, dependencies: {} };

    // Resolve chain preset
    if (opts.name && opts.name !== "custom") {
        const preset = getChainPreset(opts.name);
        opts.assethubUrl =
            opts.assethubUrl === DEFAULT_NODE_URL ? preset.assethubUrl : opts.assethubUrl;
        opts.registryAddress = opts.registryAddress ?? preset.registryAddress;
        opts.ipfsGatewayUrl = opts.ipfsGatewayUrl ?? preset.ipfsGatewayUrl;
    }

    // If still missing connection info, populate from cdm.json targets
    if (!opts.registryAddress && !process.env.CONTRACTS_REGISTRY_ADDR) {
        const targetEntries = Object.entries(cdmJson.targets);
        if (targetEntries.length > 0) {
            const [, target] = targetEntries[0];
            if (opts.assethubUrl === DEFAULT_NODE_URL) {
                opts.assethubUrl = target["asset-hub"];
            }
            opts.registryAddress = opts.registryAddress ?? target.registry;
            opts.ipfsGatewayUrl = opts.ipfsGatewayUrl ?? target.bulletin;
        }
    }

    const registryAddr = opts.registryAddress ?? process.env.CONTRACTS_REGISTRY_ADDR;
    if (!registryAddr) {
        console.error(
            "Error: Registry address required. Use --registry-address, --name for a preset, or set CONTRACTS_REGISTRY_ADDR",
        );
        process.exit(1);
    }

    if (!opts.ipfsGatewayUrl) {
        console.error(
            "Error: IPFS gateway URL required to fetch metadata. Use --ipfs-gateway-url or --name for a preset.",
        );
        process.exit(1);
    }

    const targetHash = computeTargetHash(opts.assethubUrl, opts.ipfsGatewayUrl, registryAddr);

    // Connect to chain with spinner (matching deploy command style)
    const sp = spinner("AssetHub", opts.assethubUrl);
    const { client } = connectAssetHubWebSocket(opts.assethubUrl);
    await client.getChainSpecData();
    sp.succeed();

    const inkSdk = createInkSdk(client);
    const registry = inkSdk.getContract(contracts.contractsRegistry, registryAddr);
    const ipfs = connectIpfsGateway(opts.ipfsGatewayUrl);

    // Update cdm.json targets with resolved connection info
    cdmJson.targets[targetHash] = {
        "asset-hub": opts.assethubUrl,
        bulletin: opts.ipfsGatewayUrl,
        registry: registryAddr,
    };
    if (!cdmJson.dependencies[targetHash]) {
        cdmJson.dependencies[targetHash] = {};
    }

    // Determine what to install
    let toInstall: { library: string; requestedVersion: number | "latest" }[];

    if (libraries.length > 0) {
        toInstall = libraries.map((arg) => {
            const parsed = parseLibraryArg(arg);
            return { library: parsed.library, requestedVersion: parsed.version };
        });
    } else {
        // Batch install: read from cdm.json
        const deps = cdmJson.dependencies[targetHash];
        if (!deps || Object.keys(deps).length === 0) {
            console.error(
                "Error: No library specified and no dependencies found in cdm.json for this target.",
            );
            client.destroy();
            process.exit(1);
        }
        toInstall = Object.entries(deps).map(([lib, ver]) => ({
            library: lib,
            requestedVersion: ver,
        }));
    }

    // Detect project type early for header display
    const projectType = detectProjectType(process.cwd());

    // Header (matching deploy command style)
    console.log(`\x1b[1mRegistry\x1b[0m   ${registryAddr}`);
    console.log(`\x1b[1mTarget\x1b[0m     ${targetHash}`);
    console.log(
        `\x1b[1mRust\x1b[0m ${projectType.hasRust ? "\x1b[32m✔\x1b[0m" : "\x1b[2m-\x1b[0m"}` +
            `  \x1b[1mTypeScript\x1b[0m ${projectType.hasTypeScript ? "\x1b[32m✔\x1b[0m" : "\x1b[2m-\x1b[0m"}`,
    );

    // Run parallel install with Ink table UI
    const { results, success } = await runInstallWithUI({
        libraries: toInstall,
        registry,
        ipfs,
        targetHash,
        ipfsGatewayUrl: opts.ipfsGatewayUrl,
    });

    // Update cdm.json dependencies for successful installs
    for (const result of results) {
        const entry = toInstall.find((t) => t.library === result.library);
        if (entry) {
            cdmJson.dependencies[targetHash][result.library] = entry.requestedVersion;
        }
    }

    writeCdmJson(cdmJson);

    // Run post-install hooks and update status line
    if (results.length > 0) {
        if (projectType.hasRust) {
            await postInstallRust();
        }
        if (projectType.hasTypeScript) {
            await postInstallTypeScript(results[results.length - 1]);
        }
    }

    client.destroy();

    if (!success) {
        process.exit(1);
    }
});

export const installCommand = install;
