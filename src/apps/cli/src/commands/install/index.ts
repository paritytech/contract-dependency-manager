import { existsSync } from "fs";
import { resolve } from "path";
import { Command } from "commander";
import { contracts } from "@polkadot-api/descriptors";
import { createInkSdk } from "@polkadot-api/sdk-ink";
import {
    connectAssetHubWebSocket,
    connectIpfsGateway,
    getChainPreset,
    DEFAULT_NODE_URL,
} from "@dotdm/env";
import {
    type AbiEntry,
    saveContract,
    computeTargetHash,
    readCdmJson,
    writeCdmJson,
} from "@dotdm/contracts";
import { ALICE_SS58 } from "@dotdm/utils";
import { postInstallRust } from "./rust";
import { postInstallTypeScript } from "./typescript";

export interface InstallResult {
    targetHash: string;
    library: string;
    version: number;
    address: string;
    abi: AbiEntry[];
    savedPath: string;
    metadataCid: string;
}

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
        "[library]",
        'CDM library (e.g., "@polkadot/reputation" or "@polkadot/reputation:3"). Omit to install all from cdm.json.',
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

async function installOne(
    library: string,
    requestedVersion: number | "latest",
    registry: any,
    ipfs: any,
    targetHash: string,
): Promise<InstallResult> {
    console.log(`\nLooking up "${library}" in registry...`);

    let version: number;
    let metadataCid: string;
    let contractAddress: string;

    if (requestedVersion === "latest") {
        // Use existing getVersionCount → compute latest index, then getMetadataUri + getAddress
        const versionResult = await registry.query("getVersionCount", {
            origin: ALICE_SS58,
            data: { contract_name: library },
        });
        if (!versionResult.success || versionResult.value.response === 0) {
            throw new Error(`Contract "${library}" not found in registry`);
        }
        version = versionResult.value.response - 1;

        const metaResult = await registry.query("getMetadataUri", {
            origin: ALICE_SS58,
            data: { contract_name: library },
        });
        if (!metaResult.success) {
            throw new Error(`Failed to query metadata URI for "${library}"`);
        }
        const metaResponse = metaResult.value.response;
        metadataCid =
            typeof metaResponse === "string"
                ? metaResponse
                : metaResponse?.isSome
                  ? metaResponse.value
                  : "";
        if (!metadataCid) {
            throw new Error(`No metadata URI found for "${library}"`);
        }

        const addrResult = await registry.query("getAddress", {
            origin: ALICE_SS58,
            data: { contract_name: library },
        });
        const addrResponse = addrResult.success ? addrResult.value.response : null;
        contractAddress =
            typeof addrResponse === "string"
                ? addrResponse
                : addrResponse?.isSome
                  ? addrResponse.value
                  : "";
    } else {
        // Use version-specific queries: getMetadataUriAtVersion + getAddressAtVersion
        version = requestedVersion;

        const metaResult = await registry.query("getMetadataUriAtVersion", {
            origin: ALICE_SS58,
            data: { contract_name: library, version: requestedVersion },
        });
        if (!metaResult.success) {
            throw new Error(
                `Failed to query metadata URI for "${library}" version ${requestedVersion}`,
            );
        }
        const metaResponse = metaResult.value.response;
        metadataCid =
            typeof metaResponse === "string"
                ? metaResponse
                : metaResponse?.isSome
                  ? metaResponse.value
                  : "";
        if (!metadataCid) {
            throw new Error(`Version ${requestedVersion} of "${library}" not found in registry`);
        }

        const addrResult = await registry.query("getAddressAtVersion", {
            origin: ALICE_SS58,
            data: { contract_name: library, version: requestedVersion },
        });
        const addrResponse = addrResult.success ? addrResult.value.response : null;
        contractAddress =
            typeof addrResponse === "string"
                ? addrResponse
                : addrResponse?.isSome
                  ? addrResponse.value
                  : "";
    }

    console.log(`  Version: ${version}`);
    console.log(`  Metadata CID: ${metadataCid}`);

    // Fetch metadata from IPFS
    console.log(`  Fetching metadata from IPFS (${metadataCid})...`);
    const metadata = (await (await ipfs.fetch(metadataCid)).json()) as Record<string, unknown>;
    console.log(`  Description: ${metadata.description || "(none)"}`);

    const abi = metadata.abi;
    if (!abi || !Array.isArray(abi) || abi.length === 0) {
        throw new Error(`No ABI found in metadata for "${library}"`);
    }

    // Save contract data to ~/.cdm/
    const savedPath = saveContract({
        targetHash,
        library,
        version,
        abi,
        metadata,
        address: contractAddress,
        metadataCid,
    });
    console.log(`  Saved to ${savedPath}`);

    return {
        targetHash,
        library,
        version,
        address: contractAddress,
        abi: abi as AbiEntry[],
        savedPath,
        metadataCid,
    };
}

install.action(async (library: string | undefined, opts: InstallOptions) => {
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

    // Connect to chain
    console.log("Connecting to chain...");
    const { client } = connectAssetHubWebSocket(opts.assethubUrl);
    const chain = await client.getChainSpecData();
    console.log(`Connected to: ${chain.name}`);

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

    if (library) {
        // Single install: parse version from argument
        const parsed = parseLibraryArg(library);
        toInstall = [{ library: parsed.library, requestedVersion: parsed.version }];
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
        console.log(`\nBatch install: ${toInstall.length} contract(s) from cdm.json`);
    }

    console.log(`\n=== CDM Install ===\n`);
    console.log(`Registry: ${registryAddr}`);
    console.log(`Target: ${targetHash}`);
    console.log(`Chain: ${opts.assethubUrl}`);

    // Install each contract
    const results: InstallResult[] = [];
    for (const { library: lib, requestedVersion } of toInstall) {
        try {
            const result = await installOne(lib, requestedVersion, registry, ipfs, targetHash);
            results.push(result);

            // Update cdm.json dependency with requested version (not resolved version)
            cdmJson.dependencies[targetHash][lib] = requestedVersion;
        } catch (err) {
            console.error(`\nError installing "${lib}": ${(err as Error).message}`);
            client.destroy();
            process.exit(1);
        }
    }

    // Write cdm.json once
    writeCdmJson(cdmJson);
    console.log(`\nUpdated cdm.json`);

    // Run post-install hooks once at the end
    const projectType = detectProjectType(process.cwd());

    if (projectType.hasRust) {
        await postInstallRust();
    }
    if (projectType.hasTypeScript && results.length > 0) {
        // Pass the last result for postInstallTypeScript (it reads all deps from cdm.json anyway)
        await postInstallTypeScript(results[results.length - 1]);
    }

    console.log("\n=== Done! ===");
    for (const r of results) {
        console.log(`  "${r.library}" v${r.version} → ${r.savedPath}`);
    }

    client.destroy();
});

export const installCommand = install;
