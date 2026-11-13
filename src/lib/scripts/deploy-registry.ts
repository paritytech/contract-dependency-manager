#!/usr/bin/env bun
/**
 * Deploy CDM's on-chain contracts to Asset Hub via the CREATE3 factory:
 * (i) bootstrap the frozen CREATE3 factory if the network lacks it,
 * (ii) CREATE2 the registry implementation blob, (iii) upload the EIP-1967
 * proxy code and deploy the registry proxy THROUGH the factory, (iv) deploy
 * the resolver — its implementation blob plus its own EIP-1967 proxy through
 * the factory, admin = the registry — and hand it to the registry
 * (`setResolver`), (v) upload the frozen per-name shim blob and hand the
 * registry its code hash (`setProxyCodeHash`). The two proxy addresses are
 * the stable registry address (CONTRACTS_REGISTRY_ADDR) and resolver address
 * (CDM_RESOLVER_ADDR) — pure functions of (factory, salt), independent of
 * any bytecode or constructor input.
 *
 * With --upgrade, no factory or proxy is redeployed: the new registry
 * implementation blob is deployed at a fresh CREATE2 salt (numeric suffix
 * bumped past consumed ones unless --impl-package pins it), `setCode`
 * repoints the live proxy, and the resolver and shim code hash are ensured.
 * --upgrade-resolver does the same for the resolver implementation through
 * the registry's `upgradeResolver`.
 *
 * Usage:
 *   bun run src/lib/scripts/deploy-registry.ts --name local
 *   bun run src/lib/scripts/deploy-registry.ts --assethub-url ws://127.0.0.1:10020
 *   bun run src/lib/scripts/deploy-registry.ts --assethub-url wss://... --registry-address 0x...
 *   bun run src/lib/scripts/deploy-registry.ts -n paseo --upgrade
 *   bun run src/lib/scripts/deploy-registry.ts -n paseo --upgrade --impl-package "@cdm/registry-impl.2"
 *   bun run src/lib/scripts/deploy-registry.ts -n paseo --upgrade-resolver
 *   bun run src/lib/scripts/deploy-registry.ts -n paseo --upgrade-resolver --impl-package "@cdm/resolver-impl.2"
 */
import { resolve } from "path";
import { existsSync } from "fs";
import { parseArgs } from "util";
import {
    createCdmAssetHubClient,
    prepareSigner,
    prepareSignerFromMnemonic,
    prepareSignerFromSuri,
    getChainPreset,
    resolveQueryOrigin,
    ss58Address,
    type CdmDeployAssetHubApi,
} from "@parity/cdm-env";
import {
    createContractFromClient,
    createContractRuntimeFromClient,
    ensureContractAccountMapped,
} from "@parity/product-sdk-contracts";
import type { AbiEntry } from "@parity/product-sdk-contracts";
import { CONTRACTS_REGISTRY_PACKAGE, CREATE3_FACTORY_PACKAGE } from "@parity/cdm-utils";
import { getAccount } from "@parity/cdm-utils/accounts";
import {
    ContractDeployer,
    CONTRACTS_REGISTRY_ABI,
    CONTRACTS_REGISTRY_CRATE,
    CONTRACTS_EIP1967_PROXY_CRATE,
    CONTRACTS_RESOLVER_CRATE,
    CONTRACT_RESOLVER_ABI,
    CREATE3_FACTORY_ABI,
    predictRegistryDeploy,
    deployRegistryWithProxy,
    upgradeRegistryImplementation,
    upgradeResolverImplementation,
} from "@parity/cdm-builder";

const { values: opts } = parseArgs({
    args: process.argv.slice(2),
    options: {
        name: { type: "string", short: "n" },
        "assethub-url": { type: "string" },
        "registry-address": { type: "string" },
        upgrade: { type: "boolean" },
        "upgrade-resolver": { type: "boolean" },
        "impl-package": { type: "string" },
        suri: { type: "string" },
    },
});

const preset = opts.name ? getChainPreset(opts.name) : undefined;
let assethubUrl = opts["assethub-url"];
if (opts.name) {
    assethubUrl = assethubUrl ?? preset?.assethubUrl;
}
const selectedRegistryAddress = opts["registry-address"] ?? preset?.registryAddress;
const hasExplicitRegistryAddress = Boolean(opts["registry-address"]);
if (!assethubUrl) {
    console.error("Error: --assethub-url or --name is required");
    process.exit(1);
}
if (opts.upgrade && opts["upgrade-resolver"]) {
    console.error("Error: --upgrade and --upgrade-resolver are mutually exclusive");
    process.exit(1);
}

const rootDir = resolve(import.meta.dir, "../../..");
const implPvmPath = resolve(rootDir, `target/release/${CONTRACTS_REGISTRY_CRATE}.polkavm`);
const eip1967ProxyPvmPath = resolve(
    rootDir,
    `target/release/${CONTRACTS_EIP1967_PROXY_CRATE}.polkavm`,
);
const resolverImplPvmPath = resolve(rootDir, `target/release/${CONTRACTS_RESOLVER_CRATE}.polkavm`);

for (const path of [implPvmPath, eip1967ProxyPvmPath, resolverImplPvmPath]) {
    if (!existsSync(path)) {
        console.error(`Registry not built: ${path}`);
        console.error("Run: pnpm build:registry");
        process.exit(1);
    }
}

function resolveSigner() {
    if (opts.suri) return prepareSignerFromSuri(opts.suri);
    if (opts.name) {
        const account = getAccount(opts.name);
        if (account) return prepareSignerFromMnemonic(account.mnemonic);
    }
    return prepareSigner("Alice");
}

// Connect
console.log(`Connecting to ${assethubUrl}...`);
const signer = resolveSigner();
const chainClient = await createCdmAssetHubClient(assethubUrl, opts.name);
await chainClient.raw.assetHub.getChainSpecData();
console.log("Connected.");
const deployAssetHubApi = chainClient.assetHub as CdmDeployAssetHubApi;

const deployer = new ContractDeployer(
    signer,
    ss58Address(signer.publicKey),
    chainClient.raw.assetHub,
    deployAssetHubApi,
);

// Map account (required on fresh chains, skipped if already mapped)
const mapping = await ensureContractAccountMapped(
    createContractRuntimeFromClient(chainClient.raw.assetHub, chainClient.descriptors.assetHub),
    ss58Address(signer.publicKey),
    signer,
    // Same inclusion timeout as the CLI's account mapping (cdm account map / deploy).
    { timeoutMs: 300_000 },
);
if (mapping.ok) {
    console.log(mapping.value === null ? "Account already mapped." : "Account mapped.");
} else {
    console.warn(`Account mapping failed, continuing: ${mapping.error.message}`);
}

// Predict every address offline (CREATE3 factory, implementations, registry
// and resolver proxies). The proxy addresses are pure functions of (factory,
// salt), so all idempotence/preflight checks below compare against
// `expected.registryAddress`.
const expected = predictRegistryDeploy(deployer, rootDir, implPvmPath, resolverImplPvmPath);

/** A contract handle with the admin signer attached, for writes and their verifying reads. */
function adminContractAt(address: string, abi: AbiEntry[]) {
    return createContractFromClient(
        chainClient.raw.assetHub,
        chainClient.descriptors.assetHub,
        address as `0x${string}`,
        abi,
        { defaultSigner: signer, defaultOrigin: ss58Address(signer.publicKey) },
    );
}

const registryContractAt = (address: string) => adminContractAt(address, CONTRACTS_REGISTRY_ABI);
const resolverContractAt = (address: string) => adminContractAt(address, CONTRACT_RESOLVER_ABI);
const factoryContractAt = (address: string) => adminContractAt(address, CREATE3_FACTORY_ABI);

async function requireLiveRegistry(): Promise<string> {
    const registryAddress = selectedRegistryAddress ?? expected.registryAddress;
    const info = await chainClient.assetHub.query.Revive.AccountInfoOf.getValue(
        registryAddress as `0x${string}`,
        { at: "best" },
    );
    if (info?.account_type.type !== "Contract") {
        console.error(`No registry deployed at ${registryAddress} — nothing to upgrade.`);
        chainClient.destroy();
        process.exit(1);
    }
    return registryAddress;
}

// In-place upgrade: deploy the new implementation blob at a fresh CREATE2
// salt, `setCode` through the live proxy, and ensure the resolver and the
// per-name shim code hash. No factory or proxy redeploy — the registry
// address never moves.
if (opts.upgrade) {
    const registryAddress = await requireLiveRegistry();
    console.log(`Upgrading ContractRegistry implementation behind ${registryAddress}...`);
    const upgraded = await upgradeRegistryImplementation(deployer, {
        rootDir,
        implPvmPath,
        eip1967ProxyPvmPath,
        resolverImplPvmPath,
        registryAddress,
        implPackage: opts["impl-package"],
        registryContract: registryContractAt,
        factoryContract: factoryContractAt,
        log: console.log,
    });
    if (upgraded.implPackage) {
        console.log(`Implementation salt: "${upgraded.implPackage}"`);
    }
    console.log(`\nCONTRACTS_REGISTRY_IMPL_ADDR=${upgraded.implAddress}`);
    console.log(`CONTRACT_PROXY_CODE_HASH=${upgraded.proxyCodeHash}`);
    console.log(`CDM_RESOLVER_ADDR=${upgraded.resolverAddress}`);
    console.log(`CONTRACTS_REGISTRY_ADDR=${registryAddress}`);
    chainClient.destroy();
    process.exit(0);
}

// Resolver upgrade: deploy the new resolver implementation blob at a fresh
// CREATE2 salt and repoint the live resolver proxy through the registry.
if (opts["upgrade-resolver"]) {
    const registryAddress = await requireLiveRegistry();
    console.log(`Upgrading the resolver implementation behind registry ${registryAddress}...`);
    const upgraded = await upgradeResolverImplementation(deployer, {
        resolverImplPvmPath,
        registryAddress,
        implPackage: opts["impl-package"],
        registryContract: registryContractAt,
        resolverContract: resolverContractAt,
        log: console.log,
    });
    if (upgraded.implPackage) {
        console.log(`Implementation salt: "${upgraded.implPackage}"`);
    }
    console.log(`\nCDM_RESOLVER_IMPL_ADDR=${upgraded.implAddress}`);
    console.log(`CDM_RESOLVER_ADDR=${upgraded.resolverAddress}`);
    console.log(`CONTRACTS_REGISTRY_ADDR=${registryAddress}`);
    chainClient.destroy();
    process.exit(0);
}

/**
 * Query the live implementation and resolver addresses via the registry
 * proxy. The CREATE2 prediction only matches the initial deployment — after
 * any `setCode` upgrade the live implementation differs, so an
 * already-deployed registry must be asked, not predicted.
 */
async function queryLiveAddresses(
    registryAddress: string,
): Promise<{ implAddress?: string; resolverAddress?: string }> {
    try {
        const registry = await createContractFromClient(
            chainClient.raw.assetHub,
            chainClient.descriptors.assetHub,
            registryAddress as `0x${string}`,
            CONTRACTS_REGISTRY_ABI,
            { defaultOrigin: resolveQueryOrigin({ chainName: opts.name, assethubUrl }) },
        );
        const asAddress = (result: { success: boolean; value: unknown }) =>
            result.success && typeof result.value === "string" ? result.value : undefined;
        return {
            implAddress: asAddress(await registry.getCode.query()),
            resolverAddress: asAddress(await registry.getResolver.query()),
        };
    } catch {
        // old-generation registry without getCode(); fall through
    }
    return {};
}

async function finishWithRegistry(
    address: string,
    alreadyDeployed: boolean,
    proxyCodeHash?: string,
    resolverAddress?: string,
): Promise<void> {
    try {
        // For an already-deployed registry the predicted addresses are wrong
        // after any upgrade — ask the proxy for the live ones.
        const live = alreadyDeployed
            ? await queryLiveAddresses(address)
            : { implAddress: expected.implAddress, resolverAddress };
        if (live.implAddress) {
            console.log(`\nCONTRACTS_REGISTRY_IMPL_ADDR=${live.implAddress}`);
        } else {
            console.warn(
                `\nCould not query getCode() on ${address} — the registry may predate the proxy split.`,
            );
        }
        console.log(`CREATE3_FACTORY_ADDR=${expected.factoryAddress}`);
        console.log(`CONTRACTS_REGISTRY_ADDR=${address}`);
        if (live.resolverAddress) {
            console.log(`CDM_RESOLVER_ADDR=${live.resolverAddress}`);
        }
        if (proxyCodeHash) {
            console.log(`CONTRACT_PROXY_CODE_HASH=${proxyCodeHash}`);
        }
    } finally {
        chainClient.destroy();
    }
}

if (selectedRegistryAddress) {
    const info = await chainClient.assetHub.query.Revive.AccountInfoOf.getValue(
        selectedRegistryAddress as `0x${string}`,
        { at: "best" },
    );
    if (info?.account_type.type === "Contract") {
        if (expected.registryAddress.toLowerCase() === selectedRegistryAddress.toLowerCase()) {
            console.log(`ContractRegistry already deployed at ${selectedRegistryAddress}`);
            await finishWithRegistry(selectedRegistryAddress, true);
            process.exit(0);
        }
    }
}

if (
    hasExplicitRegistryAddress &&
    selectedRegistryAddress &&
    expected.registryAddress.toLowerCase() !== selectedRegistryAddress.toLowerCase()
) {
    console.error(
        `Refusing to deploy ContractRegistry: signer ${ss58Address(signer.publicKey)} would deploy ${expected.registryAddress}, but the selected target uses ${selectedRegistryAddress}.`,
    );
    console.error(
        "Use the matching deployer for this target, or pass --registry-address for a separate registry target.",
    );
    chainClient.destroy();
    process.exit(1);
}

const expectedInfo = await chainClient.assetHub.query.Revive.AccountInfoOf.getValue(
    expected.registryAddress as `0x${string}`,
    { at: "best" },
);
if (expectedInfo?.account_type.type === "Contract") {
    console.log(`ContractRegistry already deployed at ${expected.registryAddress}`);
    await finishWithRegistry(expected.registryAddress, true);
    process.exit(0);
}

if (
    !hasExplicitRegistryAddress &&
    selectedRegistryAddress &&
    expected.registryAddress.toLowerCase() !== selectedRegistryAddress.toLowerCase()
) {
    console.warn(
        `Selected preset currently points at ${selectedRegistryAddress}, but this deployment will create ${expected.registryAddress}.`,
    );
    console.warn("Update the preset registry address after deployment.");
}

// Deploy: CREATE3 factory bootstrap (if needed), the registry implementation
// blob (plain CREATE2, skipped when already on-chain), the registry proxy
// THROUGH the factory, then the resolver pair and the shim code hash.
console.log(
    `Deploying ContractRegistry via CREATE3 (factory salt "${CREATE3_FACTORY_PACKAGE}", registry salt "${CONTRACTS_REGISTRY_PACKAGE}")...`,
);
const { implAddress, proxyAddress, proxyCodeHash, resolverAddress } = await deployRegistryWithProxy(
    deployer,
    {
        rootDir,
        implPvmPath,
        eip1967ProxyPvmPath,
        resolverImplPvmPath,
        factoryContract: factoryContractAt,
        registryContract: registryContractAt,
        prediction: expected,
        log: console.log,
    },
);
console.log(`Implementation deployed at ${implAddress}`);
await finishWithRegistry(proxyAddress, false, proxyCodeHash, resolverAddress);
