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
    .argument(
        "<url>",
        "WebSocket URL (ws://) or parachain chainspec path for smoldot",
    )
    .option(
        "-s, --signer <name>",
        "Signer name for dev accounts",
        DEFAULT_SIGNER,
    )
    .option("--suri <uri>", "Secret URI for signing (overrides --signer)")
    .option("--skip-build", "Skip build phase (use existing artifacts)", false)
    .option("--dry-run", "Show deployment plan without executing", false)
    .option(
        "--bootstrap",
        "Full bootstrap: deploy ContractRegistry first, then all CDM contracts",
        false,
    )
    .option(
        "--relay-chainspec <path>",
        "Path to relay chain chainspec (required for smoldot)",
    )
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

    if (opts.bootstrap) {
        return bootstrapDeploy(url, rootDir, opts);
    }

    const registryAddr = process.env.CONTRACTS_REGISTRY_ADDR;
    if (!registryAddr) {
        console.error(
            "Error: CONTRACTS_REGISTRY_ADDR environment variable is required",
        );
        console.error(
            "  Set it to the deployed ContractRegistry address, or use --bootstrap for a fresh deploy",
        );
        console.error("\nUsage:");
        console.error("  CONTRACTS_REGISTRY_ADDR=0x... cdm deploy <url>");
        console.error("  cdm deploy --bootstrap <url>");
        process.exit(1);
    }

    console.log("=== CDM Deploy ===\n");
    console.log(`Target: ${url}`);
    console.log(`Registry: ${registryAddr}`);
    console.log(`Root: ${rootDir}`);
    console.log(`Signer: ${opts.suri ?? opts.signer}\n`);

    if (opts.dryRun) {
        printDryRun(rootDir);
        return;
    }

    await deployWithRegistry(url, registryAddr, rootDir, opts);
    console.log("\n=== Deployment Complete ===");
});

/**
 * Build, deploy, and register all CDM contracts against a known registry.
 * Optionally accepts an existing deployer to reuse the connection.
 */
async function deployWithRegistry(
    url: string,
    registryAddr: string,
    rootDir: string,
    opts: DeployOptions,
    deployer?: ContractDeployer,
): Promise<Record<string, string>> {
    if (!opts.skipBuild) {
        buildAllContracts(rootDir, registryAddr);
    }

    const d = deployer ?? (await createDeployer(url, opts));
    d.setRegistry(registryAddr);

    const addresses = await deployAllContracts(d, rootDir);

    if (!deployer) d.client.destroy();

    return addresses;
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

    if (opts.dryRun) {
        console.log("Step 1: Deploy ContractRegistry (bootstrap)");
        console.log(
            `  Artifact: target/${CONTRACTS_REGISTRY_CRATE}.release.polkavm\n`,
        );
        console.log("Step 2: Deploy CDM contracts:");
        printDryRun(rootDir);
        return;
    }

    const registryPvmPath = resolve(
        rootDir,
        `target/${CONTRACTS_REGISTRY_CRATE}.release.polkavm`,
    );
    if (!existsSync(registryPvmPath)) {
        console.error(`ERROR: ContractRegistry not built: ${registryPvmPath}`);
        console.error("Build contracts first:");
        console.error(
            "  cargo pvm-contract build --manifest-path Cargo.toml -p contracts",
        );
        process.exit(1);
    }

    // Connect
    console.log("Connecting to chain...");
    const deployer = await createDeployer(url, opts);

    // Map account (required for Revive pallet on fresh chains)
    console.log("Mapping account...");
    try {
        await deployer.api.tx.Revive.map_account().signAndSubmit(
            deployer.signer,
        );
        console.log("  Account mapped\n");
    } catch {
        console.log("  Account already mapped\n");
    }

    // Phase 1: Deploy ContractRegistry
    console.log("Deploying ContractRegistry...");
    const registryAddr = await deployer.deploy(registryPvmPath);
    console.log(`  ContractRegistry: ${registryAddr}\n`);

    // Phase 2+3: Build and deploy all CDM contracts
    console.log("Deploying CDM contracts...");
    const addresses = await deployWithRegistry(
        url,
        registryAddr,
        rootDir,
        opts,
        deployer,
    );

    // Save all addresses (registry + CDM contracts)
    addresses[CONTRACTS_REGISTRY_CRATE] = registryAddr;
    const addrPath = resolve(rootDir, "target/.addresses.json");
    writeFileSync(addrPath, JSON.stringify(addresses, null, 2));

    console.log(`\n=== Bootstrap Complete ===`);
    console.log(`CONTRACTS_REGISTRY_ADDR=${registryAddr}`);
    console.log(`Addresses saved to ${addrPath}`);

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
            console.error(
                "Error: --relay-chainspec is required when using smoldot",
            );
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
        console.log(
            `  ${i + 1}. ${order.crateNames[i]}${pkg ? ` (${pkg})` : ""}`,
        );
    }

    console.log("\nDependency analysis:");
    for (const contract of order.contracts) {
        if (contract.dependsOnCrates.length > 0) {
            console.log(
                `  ${contract.name} depends on: ${contract.dependsOnCrates.join(", ")}`,
            );
        }
    }
    console.log("\n(Run without --dry-run to execute deployment)");
}

export const deployCommand = deploy;
