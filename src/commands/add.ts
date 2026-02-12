import { Command } from "commander";
import { resolve } from "path";
import { writeFileSync, mkdirSync } from "fs";
import { execSync } from "child_process";
import { contracts } from "@polkadot-api/descriptors";
import { createInkSdk, ss58ToEthereum } from "@polkadot-api/sdk-ink";
import { connectWebSocket } from "../lib/connection.js";
import { DEFAULT_NODE_URL, ALICE_SS58 } from "../constants.js";

const add = new Command("add")
    .description("Add a CDM contract library for use with polkadot-api")
    .argument("<library>", 'CDM library name (e.g., "@polkadot/reputation")')
    .option(
        "--registry <address>",
        "ContractRegistry address (or set CONTRACTS_REGISTRY_ADDR env var)",
    )
    .option("--url <url>", "Chain WebSocket URL", DEFAULT_NODE_URL)
    .option("--root <path>", "Project root directory", process.cwd());

type AddOptions = {
    registry?: string;
    url: string;
    root: string;
};

add.action(async (library: string, opts: AddOptions) => {
    const registryAddr = opts.registry ?? process.env.CONTRACTS_REGISTRY_ADDR;
    if (!registryAddr) {
        console.error(
            "Error: Registry address required. Use --registry or set CONTRACTS_REGISTRY_ADDR",
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

    const metadataUri = result.value.response;
    if (!metadataUri) {
        console.error(`Contract "${library}" not found in registry`);
        client.destroy();
        process.exit(1);
    }

    console.log(`  Metadata URI: ${metadataUri}`);

    // Fetch ABI from metadata URI
    console.log(`\nFetching ABI from ${metadataUri}...`);
    const response = await fetch(metadataUri);
    if (!response.ok) {
        console.error(`Failed to fetch ABI: ${response.statusText}`);
        client.destroy();
        process.exit(1);
    }
    const abi = await response.json();

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
