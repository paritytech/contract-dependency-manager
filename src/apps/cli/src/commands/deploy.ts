import { Command } from "commander";
import { resolve } from "path";
import { existsSync, writeFileSync } from "fs";
import {
    connectAssetHubWebSocket,
    connectBulletinWebSocket,
    prepareSigner,
    prepareSignerFromSuri,
    prepareSignerFromMnemonic,
    getChainPreset,
    ss58Address,
} from "@dotdm/env";
import { getAccount } from "@dotdm/utils/accounts";
import { ALICE_SS58, REGISTRY_ADDRESS } from "@dotdm/utils";
import {
    ContractDeployer,
    MetadataPublisher,
    RegistryManager,
    CONTRACTS_REGISTRY_CRATE,
} from "@dotdm/contracts";
import { runPipelineWithUI, spinner } from "../lib/ui";

const deploy = new Command("deploy")
    .description("Deploy and register contracts")
    .option("--assethub-url <url>", "WebSocket URL for Asset Hub chain")
    .option("--bulletin-url <url>", "WebSocket URL for Bulletin chain")
    .option("-n, --name <name>", "Chain preset name (polkadot, paseo, local, custom)")
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
    suri?: string;
    bootstrap: boolean;
};

/**
 * Resolve signer: --suri >> accounts.json >> Alice
 * Returns both the signer and the SS58 origin address for dry-run queries.
 */
function resolveSigner(opts: DeployOptions): {
    signer: ReturnType<typeof prepareSigner>;
    origin: string;
} {
    if (opts.suri) {
        const signer = prepareSignerFromSuri(opts.suri);
        return { signer, origin: ss58Address(signer.publicKey) };
    }
    if (opts.name) {
        const account = getAccount(opts.name);
        if (account) {
            return {
                signer: prepareSignerFromMnemonic(account.mnemonic),
                origin: account.address,
            };
        }
    }
    return { signer: prepareSigner("Alice"), origin: ALICE_SS58 };
}

deploy.action(async (opts: DeployOptions) => {
    // Resolve chain preset
    if (opts.name && opts.name !== "custom") {
        const preset = getChainPreset(opts.name);
        opts.assethubUrl = opts.assethubUrl ?? preset.assethubUrl;
        opts.bulletinUrl = opts.bulletinUrl ?? preset.bulletinUrl;
        opts.ipfsGatewayUrl = opts.ipfsGatewayUrl ?? preset.ipfsGatewayUrl;
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

    await deployWithRegistry(rootDir, opts);
});

/**
 * Build, deploy, and register all CDM contracts against the registry.
 * Uses the pipeline TUI for parallel builds and progress display.
 * Optionally accepts existing connections to reuse.
 */
async function deployWithRegistry(
    rootDir: string,
    opts: DeployOptions,
    existingConnections?: {
        signer: ReturnType<typeof prepareSigner>;
        origin: string;
        client: Awaited<ReturnType<typeof connectAssetHubWebSocket>>["client"];
        api: Awaited<ReturnType<typeof connectAssetHubWebSocket>>["api"];
    },
): Promise<Record<string, string>> {
    let signer: ReturnType<typeof prepareSigner>;
    let origin: string;
    let client: Awaited<ReturnType<typeof connectAssetHubWebSocket>>["client"];
    let api: Awaited<ReturnType<typeof connectAssetHubWebSocket>>["api"];
    let ownsAssetHub: boolean;

    if (existingConnections) {
        signer = existingConnections.signer;
        origin = existingConnections.origin;
        client = existingConnections.client;
        api = existingConnections.api;
        ownsAssetHub = false;
    } else {
        ({ signer, origin } = resolveSigner(opts));

        const sp = spinner("AssetHub", opts.assethubUrl!);
        const conn = await connectAssetHubWebSocket(opts.assethubUrl!);
        client = conn.client;
        api = conn.api;
        await client.getChainSpecData();
        sp.succeed();
        ownsAssetHub = true;
    }

    // Connect to bulletin
    const sp = spinner("Bulletin", opts.bulletinUrl!);
    const bulletinConn = await connectBulletinWebSocket(opts.bulletinUrl!);
    await bulletinConn.client.getChainSpecData();
    sp.succeed();

    const deployer = new ContractDeployer(signer, origin, client, api);
    const publisher = new MetadataPublisher(signer, bulletinConn.api);
    const registry = new RegistryManager(signer, origin, api, client, REGISTRY_ADDRESS);

    console.log(`\x1b[1mRegistry\x1b[0m   ${REGISTRY_ADDRESS}\n`);

    const result = await runPipelineWithUI({
        rootDir,
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
async function bootstrapDeploy(rootDir: string, opts: DeployOptions): Promise<void> {
    console.log("=== CDM Bootstrap Deploy ===\n");

    const registryPvmPath = resolve(rootDir, `target/${CONTRACTS_REGISTRY_CRATE}.release.polkavm`);
    if (!existsSync(registryPvmPath)) {
        console.error(`ERROR: ContractRegistry not built: ${registryPvmPath}`);
        console.error("Build contracts first:");
        console.error("  cargo pvm-contract build --manifest-path Cargo.toml -p contracts");
        process.exit(1);
    }

    // Prepare signer
    const { signer, origin } = resolveSigner(opts);

    // Connect to Asset Hub
    const sp1 = spinner("AssetHub", opts.assethubUrl!);
    const { client, api } = await connectAssetHubWebSocket(opts.assethubUrl!);
    await client.getChainSpecData();
    sp1.succeed();

    // Connect to Bulletin
    const sp2 = spinner("Bulletin", opts.bulletinUrl!);
    const bulletinConn = await connectBulletinWebSocket(opts.bulletinUrl!);
    await bulletinConn.client.getChainSpecData();
    sp2.succeed();

    const deployer = new ContractDeployer(signer, origin, client, api);

    // Map account (required for Revive pallet on fresh chains)
    console.log("Mapping account...");
    try {
        await api.tx.Revive.map_account().signAndSubmit(signer);
        console.log("  Account mapped\n");
    } catch {
        console.log("  Account already mapped\n");
    }

    // Phase 1: Deploy ContractRegistry (CREATE2 for deterministic address)
    const CDM_REGISTRY_PACKAGE = "@cdm/registry";
    console.log("Deploying ContractRegistry...");
    const { address: registryAddr } = await deployer.deploy(registryPvmPath, CDM_REGISTRY_PACKAGE);
    console.log(`  ContractRegistry: ${registryAddr}\n`);

    // Phase 2+3: Build and deploy all CDM contracts
    const addresses = await deployWithRegistry(rootDir, opts, {
        signer,
        origin,
        client,
        api,
    });

    // Save all addresses (registry + CDM contracts)
    addresses[CONTRACTS_REGISTRY_CRATE] = registryAddr;
    const addrPath = resolve(rootDir, "target/.addresses.json");
    writeFileSync(addrPath, JSON.stringify(addresses, null, 2));

    console.log(`\n=== Bootstrap Complete ===`);
    console.log(`Addresses saved to ${addrPath}`);

    bulletinConn.client.destroy();
    client.destroy();
}

export const deployCommand = deploy;
