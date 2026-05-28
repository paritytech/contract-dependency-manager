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
} from "@dotdm/env";
import { getAccount } from "@dotdm/utils/accounts";
import { ALICE_SS58, CONTRACTS_REGISTRY_PACKAGE } from "@dotdm/utils";
import {
    ContractDeployer,
    CONTRACTS_REGISTRY_CRATE,
    resolveFeatures,
    resolveLocalRegistry,
    writeCdmLocalJson,
    writeGlobalLocalRegistry,
} from "@dotdm/contracts";
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
 * Resolve the path to the ContractRegistry PolkaVM artifact. Looks in the
 * caller's `target/` first (cdm source repo or any project with a built
 * registry), then falls back to the user-global stash at
 * `~/.cdm/share/contract-registry.release.polkavm` which install.sh populates
 * from the cdm release assets. Returns null if neither exists.
 */
function resolveRegistryPvmPath(rootDir: string): string | null {
    const localPath = resolve(rootDir, `target/${CONTRACTS_REGISTRY_CRATE}.release.polkavm`);
    if (existsSync(localPath)) return localPath;
    const sharedPath = resolve(homedir(), `.cdm/share/${CONTRACTS_REGISTRY_CRATE}.release.polkavm`);
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
 * CREATE2 produces; otherwise we refuse to deploy a mismatch.
 */
async function bootstrapDeploy(
    rootDir: string,
    opts: DeployOptions,
    configuredRegistry: string | undefined,
): Promise<void> {
    console.log("=== CDM Bootstrap Deploy ===\n");

    const registryPvmPath = resolveRegistryPvmPath(rootDir);
    if (!registryPvmPath) {
        console.error(
            `ERROR: ContractRegistry bytecode not found. Looked in:\n` +
                `  - ${resolve(rootDir, `target/${CONTRACTS_REGISTRY_CRATE}.release.polkavm`)}\n` +
                `  - ${resolve(homedir(), `.cdm/share/${CONTRACTS_REGISTRY_CRATE}.release.polkavm`)}\n` +
                `Either build it locally (\`make build-registry\` from a cdm checkout) ` +
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
        await chainClient.assetHub.tx.Revive.map_account().signAndSubmit(signer);
        console.log("  Account mapped\n");
    } catch {
        console.log("  Account already mapped\n");
    }

    let expectedRegistry: Awaited<ReturnType<typeof deployer.dryRunDeploy>>;
    try {
        expectedRegistry = await deployer.dryRunDeploy(registryPvmPath, CONTRACTS_REGISTRY_PACKAGE);
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("DuplicateContract")) {
            console.error(
                "ERROR: ContractRegistry already exists on chain at the CREATE2 address but\n" +
                    "no local cache pointed at it (~/.cdm/local-registry is missing and the\n" +
                    "project has no cdm.local.json). Recover by either:\n" +
                    "  - restarting the local chain to wipe state: cdm network stop && cdm network start --fresh\n" +
                    "  - or asking whoever last bootstrapped to share their registry address and\n" +
                    '    writing it to cdm.local.json as {"localRegistry": "0x…"}',
            );
        } else {
            console.error(msg);
        }
        chainClient.destroy();
        process.exit(1);
    }
    // For non-local (or local with an explicit/pinned target), reject a
    // signer+bytecode that would land at a different address — most likely a
    // wrong account or stale bytecode.
    const shouldEnforceMatch = opts.name !== "local" || Boolean(opts.registryAddress);
    if (
        shouldEnforceMatch &&
        configuredRegistry &&
        expectedRegistry.address.toLowerCase() !== configuredRegistry.toLowerCase()
    ) {
        console.error(
            `ERROR: ContractRegistry bootstrap would deploy ${expectedRegistry.address}, but the selected target uses ${configuredRegistry}.`,
        );
        console.error(
            "Use the matching deployer/bytecode for this target, or pass --registry-address for a separate registry target.",
        );
        chainClient.destroy();
        process.exit(1);
    }

    console.log("Deploying ContractRegistry...");
    const { address: registryAddr } = await deployer.deploy(
        registryPvmPath,
        CONTRACTS_REGISTRY_PACKAGE,
    );
    console.log(`  ContractRegistry: ${registryAddr}\n`);

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
