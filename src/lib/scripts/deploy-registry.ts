#!/usr/bin/env bun
/**
 * Deploy the ContractRegistry contract to Asset Hub.
 *
 * Usage:
 *   bun run src/lib/scripts/deploy-registry.ts --name local
 *   bun run src/lib/scripts/deploy-registry.ts --assethub-url ws://127.0.0.1:10020
 *   bun run src/lib/scripts/deploy-registry.ts --name preview-net
 *   bun run src/lib/scripts/deploy-registry.ts --assethub-url wss://... --registry-address 0x...
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
    ss58Address,
} from "@dotdm/env";
import { CONTRACTS_REGISTRY_PACKAGE } from "@dotdm/utils";
import { getAccount } from "@dotdm/utils/accounts";
import { ContractDeployer, CONTRACTS_REGISTRY_CRATE } from "@dotdm/contracts";

const { values: opts } = parseArgs({
    args: process.argv.slice(2),
    options: {
        name: { type: "string", short: "n" },
        "assethub-url": { type: "string" },
        "registry-address": { type: "string" },
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
const pvmPath = resolve(rootDir, `target/${CONTRACTS_REGISTRY_CRATE}.release.polkavm`);

if (!existsSync(pvmPath)) {
    console.error(`Registry not built: ${pvmPath}`);
    console.error("Run: make build-registry");
    process.exit(1);
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

const deployer = new ContractDeployer(
    signer,
    ss58Address(signer.publicKey),
    chainClient.raw.assetHub,
    chainClient.assetHub,
);

// Map account (required on fresh chains, harmless if already mapped)
try {
    await chainClient.assetHub.tx.Revive.map_account().signAndSubmit(signer);
    console.log("Account mapped.");
} catch {
    // already mapped
}

const expected = await deployer.dryRunDeploy(pvmPath, CONTRACTS_REGISTRY_PACKAGE);

if (selectedRegistryAddress) {
    const info = await chainClient.assetHub.query.Revive.AccountInfoOf.getValue(
        selectedRegistryAddress as `0x${string}`,
    );
    if (info?.account_type.type === "Contract") {
        if (expected.address.toLowerCase() === selectedRegistryAddress.toLowerCase()) {
            console.log(`ContractRegistry already deployed at ${selectedRegistryAddress}`);
            console.log(`\nCONTRACTS_REGISTRY_ADDR=${selectedRegistryAddress}`);
            chainClient.destroy();
            process.exit(0);
        }
    }
}

if (
    hasExplicitRegistryAddress &&
    selectedRegistryAddress &&
    expected.address.toLowerCase() !== selectedRegistryAddress.toLowerCase()
) {
    console.error(
        `Refusing to deploy ContractRegistry: signer ${ss58Address(signer.publicKey)} and current bytecode would deploy ${expected.address}, but the selected target uses ${selectedRegistryAddress}.`,
    );
    console.error(
        "Use the matching deployer/bytecode for this target, or pass --registry-address for a separate registry target.",
    );
    chainClient.destroy();
    process.exit(1);
}

const expectedInfo = await chainClient.assetHub.query.Revive.AccountInfoOf.getValue(
    expected.address as `0x${string}`,
);
if (expectedInfo?.account_type.type === "Contract") {
    console.log(`ContractRegistry already deployed at ${expected.address}`);
    console.log(`\nCONTRACTS_REGISTRY_ADDR=${expected.address}`);
    chainClient.destroy();
    process.exit(0);
}

if (
    !hasExplicitRegistryAddress &&
    selectedRegistryAddress &&
    expected.address.toLowerCase() !== selectedRegistryAddress.toLowerCase()
) {
    console.warn(
        `Selected preset currently points at ${selectedRegistryAddress}, but this deployment will create ${expected.address}.`,
    );
    console.warn("Update the preset registry address after deployment.");
}

// Deploy with CREATE2 for deterministic address
console.log(`Deploying ContractRegistry (CREATE2 salt: "${CONTRACTS_REGISTRY_PACKAGE}")...`);
const { address } = await deployer.deploy(pvmPath, CONTRACTS_REGISTRY_PACKAGE);
console.log(`\nCONTRACTS_REGISTRY_ADDR=${address}`);

chainClient.destroy();
