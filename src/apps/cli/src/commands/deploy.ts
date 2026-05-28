import { Command } from "commander";
import { resolve } from "path";
import { existsSync, writeFileSync } from "fs";
import { homedir } from "os";
import {
    createCdmAssetHubClient,
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
import { ALICE_SS58 } from "@parity/cdm-utils";
import {
    ContractDeployer,
    CONTRACTS_REGISTRY_CRATE,
    CONTRACTS_REGISTRY_PROXY_CRATE,
    CREATE3_FACTORY_ABI,
    predictRegistryDeploy,
    deployRegistryWithProxy,
    resolveFeatures,
    resolveLocalRegistry,
    writeCdmLocalJson,
    writeGlobalLocalRegistry,
} from "@parity/cdm-builder";
import { createContractFromClient } from "@parity/product-sdk-contracts";
import type { HexString } from "polkadot-api";
import { ensureAccountMapped } from "../lib/account-mapping";
import { runDeployWithUI, spinner } from "../lib/ui";

const deploy = new Command("deploy")
    .description("Deploy and register contracts")
    .option("--assethub-url <url>", "WebSocket URL for Asset Hub chain")
    .option("--bulletin-url <url>", "WebSocket URL for Bulletin chain")
    .option("--ipfs-gateway-url <url>", "IPFS gateway URL for fetching metadata")
    .option("-n, --name <name>", "Chain preset name (paseo, devnet, local, custom)")
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

/**
 * Resolve the registry address for a deploy. For local, prefers cdm.local.json
 * (written by `cdm deploy --bootstrap -n local`); returns undefined when the
 * local registry hasn't been bootstrapped yet so callers can trigger bootstrap
 * or fail with a clear message. For non-local, falls back to the canonical
 * preset address.
 */
function resolveRegistryAddress(opts: DeployOptions, rootDir: string): string | undefined {
    if (opts.registryAddress) return opts.registryAddress;
    if (opts.name === "local") return resolveLocalRegistry(rootDir);
    return getRegistryAddress(opts.name);
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

    const registryAddress = resolveRegistryAddress(opts, rootDir);

    // Auto-bootstrap on `local`: flip to bootstrap mode when there's no pinned
    // registry yet, or the pinned address isn't on chain (fresh PPN data).
    if (opts.name === "local" && !opts.bootstrap) {
        if (!registryAddress) {
            console.log(
                "Local registry not bootstrapped yet — auto-bootstrapping. Pass --no-bootstrap to skip.",
            );
            opts.bootstrap = true;
        } else if (!(await checkRegistryOnChain(opts.assethubUrl, registryAddress))) {
            console.log(
                "ContractRegistry not found on local chain — auto-bootstrapping. Pass --no-bootstrap to skip.",
            );
            opts.bootstrap = true;
        }
    }

    if (opts.bootstrap) {
        return bootstrapDeploy(rootDir, opts, registryAddress);
    }

    if (!registryAddress) {
        console.error(
            "Error: no registry address available. Run `cdm deploy --bootstrap -n local` first, " +
                "or pass --registry-address.",
        );
        process.exit(1);
    }

    await deployWithRegistry(rootDir, opts, registryAddress);
});

/**
 * Resolve the path to a registry PolkaVM artifact (implementation or proxy).
 * Looks in the caller's `target/release/` first (cdm source repo or any
 * project with a built registry), then falls back to the user-global stash at
 * `~/.cdm/share/<crate>.polkavm` which install.sh populates from the cdm
 * release assets. Returns null if neither exists.
 */
function resolveRegistryPvmPath(rootDir: string, crate: string): string | null {
    const localPath = resolve(rootDir, `target/release/${crate}.polkavm`);
    if (existsSync(localPath)) return localPath;
    const sharedPath = resolve(homedir(), `.cdm/share/${crate}.polkavm`);
    if (existsSync(sharedPath)) return sharedPath;
    return null;
}

async function checkRegistryOnChain(
    assethubUrl: string,
    registryAddress: string,
): Promise<boolean> {
    try {
        const client = await createCdmAssetHubClient(assethubUrl, "local");
        await client.raw.assetHub.getChainSpecData();
        const info = await client.assetHub.query.Revive.AccountInfoOf.getValue(
            registryAddress as HexString,
        );
        client.destroy();
        return info?.account_type.type === "Contract";
    } catch {
        return false;
    }
}

/**
 * Build, deploy, and register all CDM contracts against the registry.
 * Uses the pipeline TUI for parallel builds and progress display.
 * Optionally accepts an existing `CdmChainClient` to reuse.
 */
async function deployWithRegistry(
    rootDir: string,
    opts: DeployOptions,
    registryAddress: string,
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
 *
 * `configuredRegistry` is the pre-resolved target address: either the user's
 * `--registry-address`, the canonical preset address (non-local), or the
 * `localRegistry` from a prior `cdm.local.json` (local re-bootstrap). When
 * undefined (fresh local bootstrap with no override) we accept whatever
 * the CREATE3 deploy produces; otherwise we refuse to deploy a mismatch.
 */
async function bootstrapDeploy(
    rootDir: string,
    opts: DeployOptions,
    configuredRegistry: string | undefined,
): Promise<void> {
    console.log("=== CDM Bootstrap Deploy ===\n");

    const implPvmPath = resolveRegistryPvmPath(rootDir, CONTRACTS_REGISTRY_CRATE);
    const proxyPvmPath = resolveRegistryPvmPath(rootDir, CONTRACTS_REGISTRY_PROXY_CRATE);
    if (!implPvmPath || !proxyPvmPath) {
        const searched = [CONTRACTS_REGISTRY_CRATE, CONTRACTS_REGISTRY_PROXY_CRATE]
            .map(
                (crate) =>
                    `  - ${resolve(rootDir, `target/release/${crate}.polkavm`)}\n` +
                    `  - ${resolve(homedir(), `.cdm/share/${crate}.polkavm`)}`,
            )
            .join("\n");
        console.error(
            `ERROR: ContractRegistry bytecode not found. Looked in:\n${searched}\n` +
                `Either build it locally (\`pnpm build:registry\` from a cdm checkout) ` +
                `or re-run install.sh from a cdm release that ships the bytecode.`,
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
        const outcome = await ensureAccountMapped(chainClient.assetHub, signer);
        console.log(
            outcome === "already-mapped" ? "  Account already mapped\n" : "  Account mapped\n",
        );
    } catch (err) {
        console.error(
            `ERROR: Failed to map account: ${err instanceof Error ? err.message : String(err)}`,
        );
        chainClient.destroy();
        process.exit(1);
    }

    // Phase 1 preflight: deploy ContractRegistry only if this signer
    // produces the registry (proxy) address selected for this network/target.
    // The registry address is CREATE3-derived — a pure function of the
    // factory address and the registry salt, independent of any bytecode.
    // On local with no configured target (fresh bootstrap, no pin), accept
    // whatever the deploy produces.
    const expectedRegistry = predictRegistryDeploy(deployer, rootDir, implPvmPath);
    if (
        configuredRegistry &&
        expectedRegistry.registryAddress.toLowerCase() !== configuredRegistry.toLowerCase()
    ) {
        console.error(
            `ERROR: ContractRegistry bootstrap would deploy ${expectedRegistry.registryAddress}, but the selected target uses ${configuredRegistry}.`,
        );
        console.error(
            "Use the matching deployer for this target, or pass --registry-address for a separate registry target.",
        );
        chainClient.destroy();
        process.exit(1);
    }

    // Phase 1: Deploy ContractRegistry — CREATE3 factory bootstrap (if this
    // network lacks it), the implementation blob (plain CREATE2), then the
    // EIP-1967 proxy THROUGH the factory. The proxy address is the registry
    // address everything else uses.
    console.log("Deploying ContractRegistry (CREATE3 factory + implementation + proxy)...");
    const {
        factoryAddress,
        implAddress,
        proxyAddress: registryAddr,
    } = await deployRegistryWithProxy(deployer, {
        rootDir,
        implPvmPath,
        proxyPvmPath,
        factoryContract: (address) =>
            createContractFromClient(
                chainClient.raw.assetHub,
                chainClient.descriptors.assetHub,
                address as HexString,
                CREATE3_FACTORY_ABI,
                { defaultSigner: signer, defaultOrigin: origin },
            ),
        prediction: expectedRegistry,
    });
    console.log(`  CREATE3 factory: ${factoryAddress}`);
    console.log(`  ContractRegistry implementation: ${implAddress}`);
    console.log(`  ContractRegistry (proxy): ${registryAddr}\n`);

    // Persist the bootstrapped local-registry address so subsequent commands
    // (`cdm build/deploy/install -n local`, setupForeignContracts) can resolve
    // it without an explicit flag.
    if (opts.name === "local") {
        const cdmLocalPath = writeCdmLocalJson(rootDir, {
            localRegistry: registryAddr as `0x${string}`,
        });
        const globalPath = writeGlobalLocalRegistry(registryAddr as `0x${string}`);
        console.log(`  localRegistry → ${cdmLocalPath}`);
        console.log(`  localRegistry → ${globalPath}\n`);
    }

    const addresses = await deployWithRegistry(rootDir, opts, registryAddr, {
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
