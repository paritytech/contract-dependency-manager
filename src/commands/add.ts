import { Command } from "commander";
import { resolve } from "path";
import { writeFileSync, mkdirSync } from "fs";
import { execSync } from "child_process";
import { contracts } from "@polkadot-api/descriptors";
import { createInkSdk, ss58ToEthereum } from "@polkadot-api/sdk-ink";
import { connectWebSocket } from "../lib/connection.js";
import { DEFAULT_NODE_URL, ALICE_SS58 } from "../constants.js";
import { getChainPreset } from "../lib/known_chains.js";

const add = new Command("add")
    .description("Add a CDM contract library for use with polkadot-api")
    .argument("<library>", 'CDM library name (e.g., "@polkadot/reputation")')
    .option(
        "--registry <address>",
        "ContractRegistry address (or set CONTRACTS_REGISTRY_ADDR env var)",
    )
    .option(
        "-n, --name <name>",
        "Chain preset name (polkadot, paseo, preview-net, local)",
    )
    .option(
        "--ipfs-gateway <url>",
        "IPFS gateway URL for fetching bulletin metadata",
    )
    .option("--url <url>", "Chain WebSocket URL", DEFAULT_NODE_URL)
    .option("--root <path>", "Project root directory", process.cwd());

type AddOptions = {
    registry?: string;
    name?: string;
    ipfsGateway?: string;
    url: string;
    root: string;
};

add.action(async (library: string, opts: AddOptions) => {
    // Resolve chain preset
    if (opts.name && opts.name !== "custom") {
        const preset = getChainPreset(opts.name);
        opts.url = opts.url === DEFAULT_NODE_URL ? preset.assethubUrl : opts.url;
        opts.registry = opts.registry ?? preset.registryAddress;
        opts.ipfsGateway = opts.ipfsGateway ?? preset.ipfsGatewayUrl;
    }

    const registryAddr = opts.registry ?? process.env.CONTRACTS_REGISTRY_ADDR;
    if (!registryAddr) {
        console.error(
            "Error: Registry address required. Use --registry, --name for a preset, or set CONTRACTS_REGISTRY_ADDR",
        );
        process.exit(1);
    }

    const rootDir = resolve(opts.root);

    console.log(`=== CDM Add: ${library} ===\n`);
    console.log(`Registry: ${registryAddr}`);
    console.log(`Chain: ${opts.url}`);
    console.log(`Root: ${rootDir}\n`);

    // Connect to chain
    console.log("Connecting to chain...");
    const { client } = connectWebSocket(opts.url);
    const chain = await client.getChainSpecData();
    console.log(`Connected to: ${chain.name}\n`);

    // Query registry for metadata URI via ink SDK
    console.log(`Looking up "${library}" in registry...`);
    const inkSdk = createInkSdk(client);
    const registry = inkSdk.getContract(
        contracts.contractsRegistry,
        registryAddr,
    );

    const result = await registry.query("getMetadataUri", {
        origin: ALICE_SS58,
        data: { contract_name: library },
    });

    if (!result.success) {
        console.error(`Failed to query registry for "${library}"`);
        client.destroy();
        process.exit(1);
    }

    const metadataCid = result.value.response;
    if (!metadataCid) {
        console.error(`Contract "${library}" not found in registry`);
        client.destroy();
        process.exit(1);
    }

    console.log(`  Metadata CID: ${metadataCid}`);

    // Fetch metadata from IPFS gateway using the CID
    if (!opts.ipfsGateway) {
        console.error("Error: IPFS gateway URL required to fetch metadata. Use --ipfs-gateway or --name for a preset.");
        client.destroy();
        process.exit(1);
    }

    const metadataUrl = `${opts.ipfsGateway}/${metadataCid}`;
    console.log(`\nFetching metadata from ${metadataUrl}...`);
    const metadataResponse = await fetch(metadataUrl);
    if (!metadataResponse.ok) {
        console.error(`Failed to fetch metadata: ${metadataResponse.statusText}`);
        client.destroy();
        process.exit(1);
    }
    const metadata = await metadataResponse.json();
    console.log(`  Description: ${metadata.description || "(none)"}`);

    // TODO: Fetch ABI from metadata once we include it
    // For now, the ABI is not stored in bulletin metadata
    const abi = metadata;

    // Save ABI to .papi/contracts/
    const safeName = library.replace(/[@/]/g, "_").replace(/^_/, "");
    const contractsDir = resolve(rootDir, ".papi/contracts");
    mkdirSync(contractsDir, { recursive: true });
    const abiPath = resolve(contractsDir, `${safeName}.json`);
    writeFileSync(abiPath, JSON.stringify(abi, null, 2));
    console.log(`  Saved ABI to ${abiPath}`);

    // Regenerate papi descriptors
    console.log("\nRegenerating papi descriptors...");
    try {
        execSync("npx papi generate", { cwd: rootDir, stdio: "inherit" });
        console.log("\n=== Done! ===");
        console.log(
            `\nYou can now import and use "${library}" contract types in your TypeScript code.`,
        );
    } catch {
        console.log(
            "\nABI saved. Run 'npx papi generate' to generate TypeScript types.",
        );
    }

    client.destroy();
});

export const addCommand = add;
