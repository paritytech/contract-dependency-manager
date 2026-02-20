import { Command } from "commander";
import { resolve } from "path";
import { existsSync, writeFileSync } from "fs";
import {
    connectWebSocket,
    connectBulletinWebSocket,
} from "../lib/connection.js";
import { ContractDeployer } from "../lib/deployer.js";
import { MetadataPublisher } from "../lib/publisher.js";
import { RegistryManager } from "../lib/registry.js";
import { prepareSigner } from "../lib/signer.js";
import { runPipelineWithUI } from "../lib/ui.js";
import { CONTRACTS_REGISTRY_CRATE } from "../constants.js";
import { getChainPreset } from "../lib/known_chains.js";

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

function spinner(label: string, detail: string) {
    let i = 0;
    const id = setInterval(() => {
        process.stdout.write(`\r\x1b[2K\x1b[1m${label}\x1b[0m ${SPINNER_FRAMES[i++ % SPINNER_FRAMES.length]} ${detail}`);
    }, 80);
    return {
        succeed() {
            clearInterval(id);
            process.stdout.write(`\r\x1b[2K\x1b[1m${label}\x1b[0m \x1b[32m✔\x1b[0m ${detail}\n`);
        },
        fail() {
            clearInterval(id);
            process.stdout.write(`\r\x1b[2K\x1b[1m${label}\x1b[0m \x1b[31m✖\x1b[0m ${detail}\n`);
        },
    };
}

const deploy = new Command("deploy")
    .description("Deploy and register contracts")
    .option(
        "--assethub-url <url>",
        "WebSocket URL for Asset Hub chain",
    )
    .option(
        "--bulletin-url <url>",
        "WebSocket URL for Bulletin chain",
    )
    .option(
        "-n, --name <name>",
        "Chain preset name (polkadot, paseo, preview-net, local, custom)",
    )
    .option(
        "--registry-address <address>",
        "Registry contract address (required unless --bootstrap)",
    )
    .option("--suri <uri>", "Secret URI for signing")
    .option(
        "--bootstrap",
        "Full bootstrap: deploy ContractRegistry first, then all CDM contracts",
        false,
    );

type DeployOptions = {
    assethubUrl?: string;
    bulletinUrl?: string;
    ipfsGatewayUrl?: string;
    name?: string;
    registryAddress?: string;
    suri?: string;
    bootstrap: boolean;
};

deploy.action(async (opts: DeployOptions) => {
    // Resolve chain preset
    if (opts.name && opts.name !== "custom") {
        const preset = getChainPreset(opts.name);
        opts.assethubUrl = opts.assethubUrl ?? preset.assethubUrl;
        opts.bulletinUrl = opts.bulletinUrl ?? preset.bulletinUrl;
        opts.ipfsGatewayUrl = opts.ipfsGatewayUrl ?? preset.ipfsGatewayUrl;
        opts.registryAddress = opts.registryAddress ?? preset.registryAddress;
    }

    // Validate required URLs are present
    if (!opts.assethubUrl) {
        console.error("Error: --assethub-url is required (or use --name for a preset)");
        process.exit(1);
    }
    if (!opts.bulletinUrl) {
        console.error("Error: --bulletin-url is required (or use --name for a preset)");
        process.exit(1);
    }

    const rootDir = process.cwd();

    if (opts.bootstrap) {
        return bootstrapDeploy(rootDir, opts);
    }

    if (!opts.registryAddress) {
        console.error(
            "Error: --registry-address is required unless using --bootstrap",
        );
        console.error(
            "  Set it to the deployed ContractRegistry address, or use --bootstrap for a fresh deploy",
        );
        console.error("\nUsage:");
        console.error(
            "  cdm deploy --assethub-url wss://... --bulletin-url wss://... --registry-address 0x...",
        );
        console.error(
            "  cdm deploy --bootstrap --assethub-url wss://... --bulletin-url wss://...",
        );
        process.exit(1);
    }

    await deployWithRegistry(opts.registryAddress, rootDir, opts);
});

/**
 * Build, deploy, and register all CDM contracts against a known registry.
 * Uses the pipeline TUI for parallel builds and progress display.
 * Optionally accepts existing connections to reuse.
 */
async function deployWithRegistry(
    registryAddr: string,
    rootDir: string,
    opts: DeployOptions,
    existingConnections?: {
        signer: ReturnType<typeof prepareSigner>;
        client: ReturnType<typeof connectWebSocket>["client"];
        api: ReturnType<typeof connectWebSocket>["api"];
    },
): Promise<Record<string, string>> {
    let signer: ReturnType<typeof prepareSigner>;
    let client: ReturnType<typeof connectWebSocket>["client"];
    let api: ReturnType<typeof connectWebSocket>["api"];
    let ownsAssetHub: boolean;

    if (existingConnections) {
        signer = existingConnections.signer;
        client = existingConnections.client;
        api = existingConnections.api;
        ownsAssetHub = false;
    } else {
        const signerName = opts.suri?.startsWith("//")
            ? opts.suri.slice(2)
            : undefined;
        signer = prepareSigner(signerName ?? "Alice");

        const sp = spinner("AssetHub", opts.assethubUrl!);
        const conn = connectWebSocket(opts.assethubUrl!);
        client = conn.client;
        api = conn.api;
        await client.getChainSpecData();
        sp.succeed();
        ownsAssetHub = true;
    }

    // Connect to bulletin
    const sp = spinner("Bulletin", opts.bulletinUrl!);
    const bulletinConn = connectBulletinWebSocket(opts.bulletinUrl!);
    await bulletinConn.client.getChainSpecData();
    sp.succeed();

    const deployer = new ContractDeployer(signer, client, api);
    const publisher = new MetadataPublisher(signer, bulletinConn.api);
    const registry = new RegistryManager(signer, api, client, registryAddr);

    console.log(`\x1b[1mRegistry\x1b[0m   ${registryAddr}\n`);

    const result = await runPipelineWithUI({
        rootDir,
        registryAddr,
        services: { deployer, publisher, registry },
        assethubUrl: opts.assethubUrl,
        bulletinUrl: opts.bulletinUrl,
        ipfsGatewayUrl: opts.ipfsGatewayUrl,
    });

    bulletinConn.client.destroy();
    if (ownsAssetHub) {
        client.destroy();
    }

    if (!result.success) {
        process.exit(1);
    }

    return result.addresses;
}

/**
 * Bootstrap deploy: deploy ContractRegistry first, then everything else.
 */
async function bootstrapDeploy(
    rootDir: string,
    opts: DeployOptions,
): Promise<void> {
    console.log("=== CDM Bootstrap Deploy ===\n");

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

    // Prepare signer
    const signerName = opts.suri?.startsWith("//")
        ? opts.suri.slice(2)
        : undefined;
    const signer = prepareSigner(signerName ?? "Alice");

    // Connect to Asset Hub
    const sp1 = spinner("AssetHub", opts.assethubUrl!);
    const { client, api } = connectWebSocket(opts.assethubUrl!);
    await client.getChainSpecData();
    sp1.succeed();

    // Connect to Bulletin
    const sp2 = spinner("Bulletin", opts.bulletinUrl!);
    const bulletinConn = connectBulletinWebSocket(opts.bulletinUrl!);
    await bulletinConn.client.getChainSpecData();
    sp2.succeed();

    const deployer = new ContractDeployer(signer, client, api);

    // Map account (required for Revive pallet on fresh chains)
    console.log("Mapping account...");
    try {
        await api.tx.Revive.map_account().signAndSubmit(signer);
        console.log("  Account mapped\n");
    } catch {
        console.log("  Account already mapped\n");
    }

    // Phase 1: Deploy ContractRegistry
    console.log("Deploying ContractRegistry...");
    const { address: registryAddr } = await deployer.deploy(registryPvmPath);
    console.log(`  ContractRegistry: ${registryAddr}\n`);

    // Phase 2+3: Build and deploy all CDM contracts
    const addresses = await deployWithRegistry(
        registryAddr,
        rootDir,
        opts,
        { signer, client, api },
    );

    // Save all addresses (registry + CDM contracts)
    addresses[CONTRACTS_REGISTRY_CRATE] = registryAddr;
    const addrPath = resolve(rootDir, "target/.addresses.json");
    writeFileSync(addrPath, JSON.stringify(addresses, null, 2));

    console.log(`\n=== Bootstrap Complete ===`);
    console.log(`CONTRACTS_REGISTRY_ADDR=${registryAddr}`);
    console.log(`Addresses saved to ${addrPath}`);

    bulletinConn.client.destroy();
    client.destroy();
}

export const deployCommand = deploy;
