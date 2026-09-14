#!/usr/bin/env bun
/**
 * Deploy the ContractRegistry to Asset Hub via the CREATE3 factory:
 * (i) bootstrap the frozen CREATE3 factory if the network lacks it,
 * (ii) CREATE2 the implementation blob, (iii) upload the EIP-1967 proxy code
 * and deploy it THROUGH the factory. The proxy address is the stable
 * registry address (CONTRACTS_REGISTRY_ADDR) — a pure function of
 * (factory, salt), independent of any bytecode or constructor input.
 *
 * Usage:
 *   bun run src/lib/scripts/deploy-registry.ts --name local
 *   bun run src/lib/scripts/deploy-registry.ts --assethub-url ws://127.0.0.1:10020
 *   bun run src/lib/scripts/deploy-registry.ts --name local
 *   bun run src/lib/scripts/deploy-registry.ts --assethub-url wss://... --registry-address 0x...
 *   bun run src/lib/scripts/deploy-registry.ts -n paseo --migrate-from-registry 0x...
 */
import { dirname, resolve } from "path";
import { existsSync, mkdirSync } from "fs";
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
import { createContractFromClient } from "@parity/product-sdk-contracts";
import { CONTRACTS_REGISTRY_PACKAGE, CREATE3_FACTORY_PACKAGE } from "@parity/cdm-utils";
import { getAccount } from "@parity/cdm-utils/accounts";
import {
    ContractDeployer,
    CONTRACTS_REGISTRY_ABI,
    CONTRACTS_REGISTRY_CRATE,
    CONTRACTS_REGISTRY_PROXY_CRATE,
    CREATE3_FACTORY_ABI,
    predictRegistryDeploy,
    deployRegistryWithProxy,
} from "@parity/cdm-builder";
import {
    exportRegistrySnapshot,
    importRegistrySnapshot,
    writeRegistrySnapshot,
} from "@parity/cdm-migrations/registry";

const { values: opts } = parseArgs({
    args: process.argv.slice(2),
    options: {
        name: { type: "string", short: "n" },
        "assethub-url": { type: "string" },
        "registry-address": { type: "string" },
        "migrate-from-registry": { type: "string" },
        "migration-json": { type: "string" },
        "migration-batch-size": { type: "string" },
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

const rootDir = resolve(import.meta.dir, "../../..");
const implPvmPath = resolve(rootDir, `target/release/${CONTRACTS_REGISTRY_CRATE}.polkavm`);
const proxyPvmPath = resolve(rootDir, `target/release/${CONTRACTS_REGISTRY_PROXY_CRATE}.polkavm`);
const migrationBatchSize = opts["migration-batch-size"] ? Number(opts["migration-batch-size"]) : 10;

function timestampForFileName(): string {
    return new Date().toISOString().replace(/[:.]/g, "-");
}

function resolveMigrationJsonPath(): string {
    return (
        opts["migration-json"] ??
        resolve(
            rootDir,
            "dist",
            `registry-migration-${opts.name ?? "custom"}-${timestampForFileName()}.json`,
        )
    );
}

for (const path of [implPvmPath, proxyPvmPath]) {
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

const migrationSnapshotPath = opts["migrate-from-registry"]
    ? resolveMigrationJsonPath()
    : undefined;
const migrationSourceRegistryAddress = opts["migrate-from-registry"];
const migrationSnapshot = opts["migrate-from-registry"]
    ? await (async () => {
          if (!Number.isInteger(migrationBatchSize) || migrationBatchSize <= 0) {
              console.error(
                  `Error: invalid --migration-batch-size ${opts["migration-batch-size"]}`,
              );
              process.exit(1);
          }

          console.log(`Exporting registry data from ${opts["migrate-from-registry"]}...`);
          const snapshot = await exportRegistrySnapshot({
              name: opts.name,
              assethubUrl,
              registryAddress: opts["migrate-from-registry"],
          });
          mkdirSync(dirname(migrationSnapshotPath!), { recursive: true });
          await writeRegistrySnapshot(migrationSnapshotPath!, snapshot);
          console.log(
              `Exported ${snapshot.contracts.length} contracts to ${migrationSnapshotPath}`,
          );
          return snapshot;
      })()
    : undefined;

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

// Map account (required on fresh chains, harmless if already mapped)
try {
    await chainClient.assetHub.tx.Revive.map_account().signAndSubmit(signer);
    console.log("Account mapped.");
} catch {
    // already mapped
}

// Predict every address offline (CREATE3 factory, implementation, registry
// proxy). The registry address is a pure function of (factory, salt), so all
// idempotence/preflight checks below compare against
// `expected.registryAddress`.
const expected = predictRegistryDeploy(deployer, rootDir, implPvmPath);

/**
 * Query the live implementation address via the registry proxy's `getCode()`.
 * The CREATE2 prediction only matches the initial deployment — after any
 * `setCode` upgrade the live implementation differs, so an already-deployed
 * registry must be asked, not predicted.
 */
async function queryLiveImplementation(registryAddress: string): Promise<string | undefined> {
    try {
        const registry = await createContractFromClient(
            chainClient.raw.assetHub,
            chainClient.descriptors.assetHub,
            registryAddress as `0x${string}`,
            CONTRACTS_REGISTRY_ABI,
            { defaultOrigin: resolveQueryOrigin({ chainName: opts.name, assethubUrl }) },
        );
        const result = await registry.getCode.query();
        if (result.success && typeof result.value === "string") return result.value;
    } catch {
        // old-generation registry without getCode(); fall through
    }
    return undefined;
}

async function finishWithRegistry(address: string, alreadyDeployed: boolean): Promise<void> {
    try {
        if (migrationSnapshot) {
            if (migrationSourceRegistryAddress?.toLowerCase() === address.toLowerCase()) {
                throw new Error(
                    `Refusing to import migration snapshot back into its source registry ${address}`,
                );
            }

            console.log(
                `${alreadyDeployed ? "Importing" : "Uploading"} migrated registry data into ${address}...`,
            );
            await importRegistrySnapshot(
                migrationSnapshot,
                {
                    name: opts.name,
                    assethubUrl,
                    registryAddress: address,
                    suri: opts.suri,
                    batchSize: migrationBatchSize,
                },
                ({ imported, total, batchIndex, totalBatches }) => {
                    console.log(
                        `  Imported ${imported}/${total} contracts (${batchIndex}/${totalBatches})`,
                    );
                },
            );
        }

        // For an already-deployed registry the predicted implementation is
        // wrong after any setCode upgrade — ask the proxy for the live one.
        const implAddress = alreadyDeployed
            ? await queryLiveImplementation(address)
            : expected.implAddress;
        if (implAddress) {
            console.log(`\nCONTRACTS_REGISTRY_IMPL_ADDR=${implAddress}`);
        } else {
            console.warn(
                `\nCould not query getCode() on ${address} — the registry may predate the proxy split.`,
            );
        }
        console.log(`CREATE3_FACTORY_ADDR=${expected.factoryAddress}`);
        console.log(`CONTRACTS_REGISTRY_ADDR=${address}`);
    } finally {
        chainClient.destroy();
    }
}

if (selectedRegistryAddress) {
    const info = await chainClient.assetHub.query.Revive.AccountInfoOf.getValue(
        selectedRegistryAddress as `0x${string}`,
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

// Deploy: CREATE3 factory bootstrap (if needed), then the implementation
// blob (plain CREATE2, skipped when already on-chain), then the proxy
// THROUGH the factory. The proxy address depends only on (factory, salt).
console.log(
    `Deploying ContractRegistry via CREATE3 (factory salt "${CREATE3_FACTORY_PACKAGE}", registry salt "${CONTRACTS_REGISTRY_PACKAGE}")...`,
);
const { implAddress, proxyAddress } = await deployRegistryWithProxy(deployer, {
    rootDir,
    implPvmPath,
    proxyPvmPath,
    factoryContract: (factoryAddress) =>
        createContractFromClient(
            chainClient.raw.assetHub,
            chainClient.descriptors.assetHub,
            factoryAddress as `0x${string}`,
            CREATE3_FACTORY_ABI,
            { defaultSigner: signer, defaultOrigin: ss58Address(signer.publicKey) },
        ),
    prediction: expected,
    log: console.log,
});
console.log(`Implementation deployed at ${implAddress}`);
await finishWithRegistry(proxyAddress, false);
