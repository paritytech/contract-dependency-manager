#!/usr/bin/env bun
/**
 * Deploy the CDM registry and point the stable cdm-root contract at it.
 *
 * Usage:
 *   bun run src/lib/scripts/deploy-registry.ts --name paseo
 *   bun run src/lib/scripts/deploy-registry.ts --name paseo --deploy-root
 *   bun run src/lib/scripts/deploy-registry.ts --assethub-url ws://127.0.0.1:10020 --deploy-root
 */
import { existsSync, readFileSync } from "fs";
import { resolve } from "path";
import { parseArgs } from "util";
import {
    createCdmAssetHubClient,
    getChainPreset,
    prepareSigner,
    prepareSignerFromMnemonic,
    prepareSignerFromSuri,
    ss58Address,
    type CdmDeployAssetHubApi,
} from "@dotdm/env";
import {
    ContractDeployer,
    CONTRACTS_REGISTRY_CRATE,
    createContractFromClient,
    submitAndWatch,
    type AbiEntry,
    type SubmittableTransaction,
} from "@dotdm/contracts";
import {
    CONTRACTS_REGISTRY_PACKAGE,
    GAS_LIMIT,
    STORAGE_DEPOSIT_LIMIT,
    stringifyBigInt,
} from "@dotdm/utils";
import { getAccount } from "@dotdm/utils/accounts";

const CDM_ROOT_CRATE = "cdm-root";
const CDM_ROOT_PACKAGE = "@cdm/root";

const { values: opts } = parseArgs({
    args: process.argv.slice(2),
    options: {
        name: { type: "string", short: "n" },
        "assethub-url": { type: "string" },
        "deploy-root": { type: "boolean" },
        suri: { type: "string" },
    },
});

const preset = opts.name ? getChainPreset(opts.name) : undefined;
const assethubUrl = opts["assethub-url"] ?? preset?.assethubUrl;
if (!assethubUrl) {
    console.error("Error: --assethub-url or --name is required");
    process.exit(1);
}

const rootDir = resolve(import.meta.dir, "../../..");
const rootPvmPath = resolve(rootDir, `target/${CDM_ROOT_CRATE}.release.polkavm`);
const rootAbiPath = resolve(rootDir, `target/${CDM_ROOT_CRATE}.release.abi.json`);
const registryPvmPath = resolve(rootDir, `target/${CONTRACTS_REGISTRY_CRATE}.release.polkavm`);

for (const path of [rootPvmPath, rootAbiPath, registryPvmPath]) {
    if (!existsSync(path)) {
        console.error(`Bootstrap artifact not built: ${path}`);
        console.error("Run: make build-registry");
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

function readRootAbi(): AbiEntry[] {
    return JSON.parse(readFileSync(rootAbiPath, "utf8")) as AbiEntry[];
}

console.log(`Connecting to ${assethubUrl}...`);
const signer = resolveSigner();
const origin = ss58Address(signer.publicKey);
const chainClient = await createCdmAssetHubClient(assethubUrl, opts.name);
await chainClient.raw.assetHub.getChainSpecData();
console.log("Connected.");

const deployer = new ContractDeployer(
    signer,
    origin,
    chainClient.raw.assetHub,
    chainClient.assetHub as CdmDeployAssetHubApi,
);

async function contractExists(address: string): Promise<boolean> {
    const info = await chainClient.assetHub.query.Revive.AccountInfoOf.getValue(
        address as `0x${string}`,
    );
    return info?.account_type.type === "Contract";
}

async function ensureMappedAccount(): Promise<void> {
    try {
        await chainClient.assetHub.tx.Revive.map_account().signAndSubmit(signer);
        console.log("Account mapped.");
    } catch {
        console.log("Account already mapped.");
    }
}

async function resolveRootAddress(): Promise<string> {
    const expected = await deployer.dryRunDeploy(rootPvmPath, CDM_ROOT_PACKAGE);

    if (await contractExists(expected.address)) {
        console.log(`CdmRoot already deployed at ${expected.address}`);
        return expected.address;
    }

    if (!opts["deploy-root"]) {
        throw new Error(
            `CdmRoot is not deployed at ${expected.address}. Re-run with --deploy-root to create it.`,
        );
    }

    console.log(`Deploying CdmRoot (CREATE2 salt: "${CDM_ROOT_PACKAGE}")...`);
    const { address } = await deployer.deploy(rootPvmPath, CDM_ROOT_PACKAGE);
    return address;
}

async function resolveRegistryAddress(): Promise<string> {
    const expected = await deployer.dryRunDeploy(registryPvmPath, CONTRACTS_REGISTRY_PACKAGE);

    if (await contractExists(expected.address)) {
        console.log(`ContractRegistry already deployed at ${expected.address}`);
        return expected.address;
    }

    console.log(`Deploying ContractRegistry (CREATE2 salt: "${CONTRACTS_REGISTRY_PACKAGE}")...`);
    const { address } = await deployer.deploy(registryPvmPath, CONTRACTS_REGISTRY_PACKAGE);
    return address;
}

async function updateRootRegistryAddress(rootAddress: string, registryAddress: string) {
    const root = await createContractFromClient(
        chainClient.raw.assetHub,
        chainClient.descriptors.assetHub,
        rootAddress as `0x${string}`,
        readRootAbi(),
        { defaultOrigin: origin },
    );

    const current = await root.getRegistryAddress.query();
    if (
        current.success &&
        typeof current.value === "string" &&
        current.value.toLowerCase() === registryAddress.toLowerCase()
    ) {
        console.log(`CdmRoot already points at ${registryAddress}`);
        return;
    }

    console.log(`Updating CdmRoot registry address to ${registryAddress}...`);
    const tx = await root.setRegistryAddress.prepare(registryAddress, {
        origin,
        gasLimit: { ref_time: GAS_LIMIT.refTime, proof_size: GAS_LIMIT.proofSize },
        storageDepositLimit: STORAGE_DEPOSIT_LIMIT,
    });
    const result = await submitAndWatch(tx as unknown as SubmittableTransaction, signer, {
        waitFor: "best-block",
    });

    if (!result.ok) {
        throw new Error(
            `CdmRoot update failed: ${stringifyBigInt(result.dispatchError ?? "unknown dispatch error")}`,
        );
    }
}

try {
    await ensureMappedAccount();
    const rootAddress = await resolveRootAddress();
    const registryAddress = await resolveRegistryAddress();
    await updateRootRegistryAddress(rootAddress, registryAddress);

    console.log(`\nCDM_ROOT_ADDR=${rootAddress}`);
    console.log(`CONTRACTS_REGISTRY_ADDR=${registryAddress}`);
} finally {
    chainClient.destroy();
}
