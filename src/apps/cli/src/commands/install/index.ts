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

const install = new Command("install")
    .alias("i")
    .description("Install a CDM contract library to ~/.cdm/")
    .argument("<library>", 'CDM library name (e.g., "@polkadot/reputation")')
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

install.action(async (library: string, opts: InstallOptions) => {
    // Resolve chain preset
    if (opts.name && opts.name !== "custom") {
        const preset = getChainPreset(opts.name);
        opts.assethubUrl =
            opts.assethubUrl === DEFAULT_NODE_URL ? preset.assethubUrl : opts.assethubUrl;
        opts.registryAddress = opts.registryAddress ?? preset.registryAddress;
        opts.ipfsGatewayUrl = opts.ipfsGatewayUrl ?? preset.ipfsGatewayUrl;
    }

    const registryAddr = opts.registryAddress ?? process.env.CONTRACTS_REGISTRY_ADDR;
    if (!registryAddr) {
        console.error(
            "Error: Registry address required. Use --registry-address, --name for a preset, or set CONTRACTS_REGISTRY_ADDR",
        );
        process.exit(1);
    }

    const targetHash = computeTargetHash(opts.assethubUrl, opts.ipfsGatewayUrl!, registryAddr);
    console.log(`=== CDM Install: ${library} ===\n`);
    console.log(`Registry: ${registryAddr}`);
    console.log(`Target: ${targetHash}`);
    console.log(`Chain: ${opts.assethubUrl}\n`);

    // Connect to chain
    console.log("Connecting to chain...");
    const { client } = connectAssetHubWebSocket(opts.assethubUrl);
    const chain = await client.getChainSpecData();
    console.log(`Connected to: ${chain.name}\n`);

    // Query registry for metadata URI via ink SDK
    console.log(`Looking up "${library}" in registry...`);
    const inkSdk = createInkSdk(client);
    const registry = inkSdk.getContract(contracts.contractsRegistry, registryAddr);

    const result = await registry.query("getMetadataUri", {
        origin: ALICE_SS58,
        data: { contract_name: library },
    });

    if (!result.success) {
        console.error(`Failed to query registry for "${library}"`);
        client.destroy();
        process.exit(1);
    }

    const response = result.value.response;
    // getMetadataUri returns Option<string> = { isSome: bool, value: string }
    const metadataCid =
        typeof response === "string" ? response : response?.isSome ? response.value : null;
    if (!metadataCid) {
        console.error(`Contract "${library}" not found in registry`);
        client.destroy();
        process.exit(1);
    }

    console.log(`  Metadata CID: ${metadataCid}`);

    // Fetch metadata from IPFS gateway using the CID
    if (!opts.ipfsGatewayUrl) {
        console.error(
            "Error: IPFS gateway URL required to fetch metadata. Use --ipfs-gateway-url or --name for a preset.",
        );
        client.destroy();
        process.exit(1);
    }

    const ipfs = connectIpfsGateway(opts.ipfsGatewayUrl);
    console.log(`\nFetching metadata from IPFS (${metadataCid})...`);
    const metadata = (await (await ipfs.fetch(metadataCid)).json()) as Record<string, unknown>;
    console.log(`  Description: ${metadata.description || "(none)"}`);

    // Query version count and address for local storage
    const versionResult = await registry.query("getVersionCount", {
        origin: ALICE_SS58,
        data: { contract_name: library },
    });
    const version = versionResult.success ? versionResult.value.response - 1 : 0;

    const addressResult = await registry.query("getAddress", {
        origin: ALICE_SS58,
        data: { contract_name: library },
    });
    const addressResponse = addressResult.success ? addressResult.value.response : null;
    const contractAddress =
        typeof addressResponse === "string"
            ? addressResponse
            : addressResponse?.isSome
              ? addressResponse.value
              : "";

    const abi = metadata.abi;
    if (!abi || !Array.isArray(abi) || abi.length === 0) {
        console.error(`No ABI found in metadata for "${library}"`);
        client.destroy();
        process.exit(1);
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

    // Update cdm.json
    const cdmResult = readCdmJson();
    const cdmJson = cdmResult?.cdmJson ?? { targets: {}, dependencies: {} };
    cdmJson.targets[targetHash] = {
        "asset-hub": opts.assethubUrl,
        bulletin: opts.ipfsGatewayUrl!,
        registry: registryAddr,
    };
    if (!cdmJson.dependencies[targetHash]) {
        cdmJson.dependencies[targetHash] = {};
    }
    cdmJson.dependencies[targetHash][library] = version;
    writeCdmJson(cdmJson);
    console.log(`  Updated cdm.json`);

    // Detect project type and run post-install
    const projectType = detectProjectType(process.cwd());

    if (projectType.hasRust) {
        await postInstallRust();
    }
    if (projectType.hasTypeScript) {
        await postInstallTypeScript({
            targetHash,
            library,
            version,
            address: contractAddress,
            abi: abi as AbiEntry[],
            savedPath,
            metadataCid,
        });
    }

    console.log("\n=== Done! ===");
    console.log(`\nContract "${library}" installed to ${savedPath}`);

    client.destroy();
});

export const installCommand = install;
