import { Command } from "commander";
import { resolve } from "path";
import { existsSync, writeFileSync } from "fs";
import {
    createCdmChainClient,
    prepareSigner,
    prepareSignerFromSuri,
    prepareSignerFromMnemonic,
    getChainPreset,
    getRegistryAddress,
    ss58Address,
    type CdmChainClient,
} from "@parity/cdm-env";
import { getAccount } from "@parity/cdm-utils/accounts";
import { ALICE_SS58, CONTRACTS_REGISTRY_PACKAGE } from "@parity/cdm-utils";
import { ContractDeployer, CONTRACTS_REGISTRY_CRATE, resolveFeatures } from "@parity/cdm-builder";
import type { HexString } from "polkadot-api";
import { runDeployWithUI, spinner } from "../lib/ui";

const deploy = new Command("deploy")
    .description("Deploy and register contracts")
    .option("--assethub-url <url>", "WebSocket URL for Asset Hub chain")
    .option("--bulletin-url <url>", "WebSocket URL for Bulletin chain")
    .option("-n, --name <name>", "Chain preset name (paseo, local, custom)")
    .option("--registry-address <address>", "Registry contract address")
    .option("--suri <uri>", "Secret URI for signing")
    .option("--features <features>", "Cargo feature flags to pass to the build")
    .option(
        "--bootstrap",
        "Full bootstrap: deploy ContractRegistry first, then all CDM contracts",
        false,
    );

type DeployOptions = {
    assethubUrl?: string;
    bulletinUrl?: string;
    ipfsGatewayUrl?: string;
    registryAddress?: string;
    name?: string;
    suri?: string;
    features?: string;
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

function resolveRegistryAddress(opts: DeployOptions): string {
    return opts.registryAddress ?? getRegistryAddress(opts.name);
}

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
    opts.features = resolveFeatures(opts.features, rootDir);

    if (opts.bootstrap) {
        return bootstrapDeploy(rootDir, opts);
    }

    await deployWithRegistry(rootDir, opts);
});

/**
 * Build, deploy, and register all CDM contracts against the registry.
 * Uses the pipeline TUI for parallel builds and progress display.
 * Optionally accepts an existing `CdmChainClient` to reuse.
 */
async function deployWithRegistry(
    rootDir: string,
    opts: DeployOptions,
    existingConnection?: {
        signer: ReturnType<typeof prepareSigner>;
        origin: string;
        chainClient: CdmChainClient;
    },
): Promise<Record<string, string>> {
    let signer: ReturnType<typeof prepareSigner>;
    let origin: string;
    let chainClient: CdmChainClient;
    let ownsChainClient: boolean;

    if (existingConnection) {
        signer = existingConnection.signer;
        origin = existingConnection.origin;
        chainClient = existingConnection.chainClient;
        ownsChainClient = false;
    } else {
        ({ signer, origin } = resolveSigner(opts));

        const spAH = spinner("AssetHub", opts.assethubUrl!);
        const spBL = spinner("Bulletin", opts.bulletinUrl!);
        chainClient = await createCdmChainClient({
            assethubUrl: opts.assethubUrl!,
            bulletinUrl: opts.bulletinUrl!,
            chainName: opts.name,
        });
        await Promise.all([
            chainClient.raw.assetHub.getChainSpecData(),
            chainClient.raw.bulletin.getChainSpecData(),
        ]);
        spAH.succeed();
        spBL.succeed();
        ownsChainClient = true;
    }

    const registryAddress = resolveRegistryAddress(opts);
    console.log(`\x1b[1mRegistry\x1b[0m   ${registryAddress}\n`);

    const { result } = await runDeployWithUI({
        rootDir,
        client: chainClient,
        signer,
        origin,
        registryAddress: registryAddress as HexString,
        features: opts.features,
        assethubUrl: opts.assethubUrl,
        bulletinUrl: opts.bulletinUrl,
        ipfsGatewayUrl: opts.ipfsGatewayUrl,
    });

    if (ownsChainClient) {
        chainClient.destroy();
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
        console.error(
            `  cargo pvm-contract build --manifest-path Cargo.toml -p ${CONTRACTS_REGISTRY_CRATE}`,
        );
        process.exit(1);
    }

    const { signer, origin } = resolveSigner(opts);

    const spAH = spinner("AssetHub", opts.assethubUrl!);
    const spBL = spinner("Bulletin", opts.bulletinUrl!);
    const chainClient = await createCdmChainClient({
        assethubUrl: opts.assethubUrl!,
        bulletinUrl: opts.bulletinUrl!,
        chainName: opts.name,
    });
    await Promise.all([
        chainClient.raw.assetHub.getChainSpecData(),
        chainClient.raw.bulletin.getChainSpecData(),
    ]);
    spAH.succeed();
    spBL.succeed();

    const deployer = new ContractDeployer(
        signer,
        origin,
        chainClient.raw.assetHub,
        chainClient.assetHub,
    );

    // Map account (required for Revive pallet on fresh chains)
    console.log("Mapping account...");
    try {
        await chainClient.assetHub.tx.Revive.map_account().signAndSubmit(signer);
        console.log("  Account mapped\n");
    } catch {
        console.log("  Account already mapped\n");
    }

    // Phase 1 preflight: deploy ContractRegistry only if this signer/bytecode
    // produces the registry address selected for this network/target.
    const registryAddress = resolveRegistryAddress(opts);
    const expectedRegistry = await deployer.dryRunDeploy(
        registryPvmPath,
        CONTRACTS_REGISTRY_PACKAGE,
    );
    if (expectedRegistry.address.toLowerCase() !== registryAddress.toLowerCase()) {
        console.error(
            `ERROR: ContractRegistry bootstrap would deploy ${expectedRegistry.address}, but the selected target uses ${registryAddress}.`,
        );
        console.error(
            "Use the matching deployer/bytecode for this target, or pass --registry-address for a separate registry target.",
        );
        chainClient.destroy();
        process.exit(1);
    }

    // Phase 1: Deploy ContractRegistry (CREATE2 for deterministic address)
    console.log("Deploying ContractRegistry...");
    const { address: registryAddr } = await deployer.deploy(
        registryPvmPath,
        CONTRACTS_REGISTRY_PACKAGE,
    );
    console.log(`  ContractRegistry: ${registryAddr}\n`);
    opts.registryAddress = registryAddr;

    // Phase 2+3: Build and deploy all CDM contracts (reuses the existing chain client)
    const addresses = await deployWithRegistry(rootDir, opts, {
        signer,
        origin,
        chainClient,
    });

    // Save all addresses (registry + CDM contracts)
    addresses[CONTRACTS_REGISTRY_CRATE] = registryAddr;
    const addrPath = resolve(rootDir, "target/.addresses.json");
    writeFileSync(addrPath, JSON.stringify(addresses, null, 2));

    console.log(`\n=== Bootstrap Complete ===`);
    console.log(`Addresses saved to ${addrPath}`);

    chainClient.destroy();
}

export const deployCommand = deploy;
