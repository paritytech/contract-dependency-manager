import { Command } from "commander";
import { resolve } from "path";
import { existsSync, writeFileSync } from "fs";
import {
    connectWebSocket,
    connectSmoldot,
    detectConnectionType,
} from "../lib/connection.js";
import {
    ContractDeployer,
    buildAllContracts,
    deployAllContracts,
} from "../lib/deployer.js";
import { detectDeploymentOrder } from "../lib/detection.js";
import { DEFAULT_SIGNER, CONTRACTS_REGISTRY_CRATE } from "../constants.js";

const deploy = new Command("deploy")
    .description("Deploy and register contracts")
    .argument("<url>", "WebSocket URL (ws://) or parachain chainspec path for smoldot")
    .option("-s, --signer <name>", "Signer name for dev accounts", DEFAULT_SIGNER)
    .option("--suri <uri>", "Secret URI for signing (overrides --signer)")
    .option("--skip-build", "Skip build phase (use existing artifacts)", false)
    .option("--dry-run", "Show deployment plan without executing", false)
    .option("--bootstrap", "Full bootstrap: deploy ContractRegistry first, then all CDM contracts", false)
    .option("--relay-chainspec <path>", "Path to relay chain chainspec (required for smoldot)")
    .option("--root <path>", "Workspace root directory", process.cwd());

type DeployOptions = {
    signer: string;
    suri?: string;
    skipBuild: boolean;
    dryRun: boolean;
    bootstrap: boolean;
    relayChainspec?: string;
    root: string;
};

deploy.action(async (url: string, opts: DeployOptions) => {
    const rootDir = resolve(opts.root);

    // Non-bootstrap mode still requires CONTRACTS_REGISTRY_ADDR
    if (!opts.bootstrap) {
        const registry = process.env.CONTRACTS_REGISTRY_ADDR;
        if (!registry) {
            console.error("Error: CONTRACTS_REGISTRY_ADDR environment variable is required");
            console.error("  Set it to the deployed ContractRegistry address, or use --bootstrap for a fresh deploy");
            console.error("\nUsage:");
            console.error("  CONTRACTS_REGISTRY_ADDR=0x... cdm deploy <url>");
            console.error("  cdm deploy --bootstrap <url>");
            process.exit(1);
        }
        return await deployWithRegistry(url, registry, rootDir, opts);
    }

    // Bootstrap mode: deploy everything from scratch
    return await bootstrapDeploy(url, rootDir, opts);
});

/**
 * Standard deploy: registry already exists, deploy CDM contracts.
 */
async function deployWithRegistry(
    url: string,
    registry: string,
    rootDir: string,
    opts: DeployOptions,
): Promise<void> {
    console.log("=== CDM Deploy ===\n");
    console.log(`Target: ${url}`);
    console.log(`Registry: ${registry}`);
    console.log(`Root: ${rootDir}`);
    console.log(`Signer: ${opts.suri ?? opts.signer}\n`);

    // Dry run: just show what would be deployed
    if (opts.dryRun) {
        printDryRun(rootDir);
        return;
    }

    // Phase 1: Build all contracts with registry address
    if (!opts.skipBuild) {
        console.log("Phase 1: Building contracts with registry address...");
        buildAllContracts(rootDir, registry);
    }

    // Phase 2: Connect to chain
    console.log("Phase 2: Connecting to chain...");
    const deployer = await createDeployer(url, opts);
    deployer.setRegistry(registry);

    // Phase 3: Deploy and register all contracts
    console.log("\nPhase 3: Deploying and registering contracts...");
    await deployAllContracts(deployer, rootDir);

    console.log("\n=== Deployment Complete ===");
    deployer.client.destroy();
}

/**
 * Bootstrap deploy: deploy ContractRegistry first, then everything else.
 */
async function bootstrapDeploy(
    url: string,
    rootDir: string,
    opts: DeployOptions,
): Promise<void> {
    console.log("=== CDM Bootstrap Deploy ===\n");
    console.log(`Target: ${url}`);
    console.log(`Root: ${rootDir}`);
    console.log(`Signer: ${opts.suri ?? opts.signer}\n`);

    // Dry run
    if (opts.dryRun) {
        console.log("=== Dry Run (Bootstrap) ===\n");
        console.log("Step 1: Deploy ContractRegistry (bootstrap)");
        console.log(`  Artifact: target/${CONTRACTS_REGISTRY_CRATE}.release.polkavm\n`);
        console.log("Step 2: Deploy CDM contracts:");
        printDryRun(rootDir);
        return;
    }

    // Check registry artifact exists
    const registryPvmPath = resolve(rootDir, `target/${CONTRACTS_REGISTRY_CRATE}.release.polkavm`);
    if (!existsSync(registryPvmPath)) {
        console.error(`ERROR: ContractRegistry not built: ${registryPvmPath}`);
        console.error("Build contracts first:");
        console.error("  cargo pvm-contract build --manifest-path Cargo.toml -p contracts");
        process.exit(1);
    }

    // Connect
    console.log("Connecting to chain...");
    const deployer = await createDeployer(url, opts);

    // Map account (required for Revive pallet on fresh chains)
    console.log("Mapping account...");
    try {
        await deployer.api.tx.Revive.map_account().signAndSubmit(deployer.signer);
        console.log("  Account mapped\n");
    } catch {
        console.log("  Account already mapped\n");
    }

    const addresses: Record<string, string> = {};

    // Phase 1: Deploy ContractRegistry
    console.log("=== Phase 1: Deploy ContractRegistry ===");
    const registryAddr = await deployer.deploy(registryPvmPath);
    addresses[CONTRACTS_REGISTRY_CRATE] = registryAddr;
    console.log(`  ContractRegistry: ${registryAddr}\n`);
    deployer.setRegistry(registryAddr);

    // Phase 2: Rebuild CDM contracts with the new registry address
    if (!opts.skipBuild) {
        console.log("=== Phase 2: Rebuild CDM contracts with registry address ===");
        buildAllContracts(rootDir, registryAddr);
    }

    // Phase 3: Deploy and register CDM contracts
    console.log("=== Phase 3: Deploy CDM contracts ===");
    const order = detectDeploymentOrder(rootDir);
    console.log(`Deployment order: ${order.crateNames.join(" -> ")}\n`);

    for (let i = 0; i < order.crateNames.length; i++) {
        const crateName = order.crateNames[i];
        const cdmPackage = order.cdmPackages[i];
        const pvmPath = resolve(rootDir, `target/${crateName}.release.polkavm`);

        if (!existsSync(pvmPath)) {
            console.error(`  WARNING: Skipping ${crateName} - not built`);
            continue;
        }

        const addr = await deployer.deploy(pvmPath);
        addresses[crateName] = addr;
        console.log(`  ${crateName}: ${addr}`);

        if (cdmPackage) {
            await deployer.register(cdmPackage);
            console.log(`    registered as ${cdmPackage}`);
        }
    }

    // Save addresses
    const addrPath = resolve(rootDir, "target/.addresses.json");
    writeFileSync(addrPath, JSON.stringify(addresses, null, 2));

    console.log(`\n=== Deployment Complete ===`);
    console.log(`CONTRACTS_REGISTRY_ADDR=${registryAddr}`);
    console.log(`\nAll addresses saved to ${addrPath}`);

    deployer.client.destroy();
}

async function createDeployer(
    url: string,
    opts: DeployOptions,
): Promise<ContractDeployer> {
    const signerName = opts.suri?.startsWith("//")
        ? opts.suri.slice(2)
        : opts.signer;

    const deployer = new ContractDeployer(signerName);

    const connectionType = detectConnectionType(url);
    if (connectionType === "smoldot") {
        if (!opts.relayChainspec) {
            console.error("Error: --relay-chainspec is required when using smoldot");
            process.exit(1);
        }
        const { client, api } = await connectSmoldot(url, opts.relayChainspec);
        deployer.setConnection(client, api);
    } else {
        const { client, api } = connectWebSocket(url);
        deployer.setConnection(client, api);
    }

    // Wait for connection
    const chain = await deployer.client.getChainSpecData();
    console.log(`Connected to: ${chain.name}\n`);

    return deployer;
}

function printDryRun(rootDir: string): void {
    const order = detectDeploymentOrder(rootDir);
    console.log("Contracts to deploy (in order):");
    for (let i = 0; i < order.crateNames.length; i++) {
        const pkg = order.cdmPackages[i];
        console.log(`  ${i + 1}. ${order.crateNames[i]}${pkg ? ` (${pkg})` : ""}`);
    }

    console.log("\nDependency analysis:");
    for (const contract of order.contracts) {
        if (contract.dependsOnCrates.length > 0) {
            console.log(`  ${contract.name} depends on: ${contract.dependsOnCrates.join(", ")}`);
        }
    }
    console.log("\n(Run without --dry-run to execute deployment)");
}

export const deployCommand = deploy;
