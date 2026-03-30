#!/usr/bin/env bun
/**
 * Deploy the ContractRegistry contract to Asset Hub.
 *
 * Usage:
 *   bun run src/lib/scripts/deploy-registry.ts --name local
 *   bun run src/lib/scripts/deploy-registry.ts --assethub-url ws://127.0.0.1:10020
 *   bun run src/lib/scripts/deploy-registry.ts --name preview-net --suri //Bob
 */
import { resolve } from "path";
import { existsSync } from "fs";
import { parseArgs } from "util";
import { connectAssetHubWebSocket, prepareSigner, getChainPreset, ss58Address } from "@dotdm/env";
import { ContractDeployer, CONTRACTS_REGISTRY_CRATE, computeDeploySalt } from "@dotdm/contracts";

const { values: opts } = parseArgs({
    args: process.argv.slice(2),
    options: {
        name: { type: "string", short: "n" },
        "assethub-url": { type: "string" },
        suri: { type: "string" },
    },
});

let assethubUrl = opts["assethub-url"];
if (opts.name) {
    const preset = getChainPreset(opts.name);
    assethubUrl = assethubUrl ?? preset.assethubUrl;
}
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

// Connect
console.log(`Connecting to ${assethubUrl}...`);
const signerName = opts.suri?.startsWith("//") ? opts.suri.slice(2) : undefined;
const signer = prepareSigner(signerName ?? "Alice");
const { client, api } = connectAssetHubWebSocket(assethubUrl);
await client.getChainSpecData();
console.log("Connected.");

const deployer = new ContractDeployer(signer, ss58Address(signer.publicKey), client, api);

// Map account (required on fresh chains, harmless if already mapped)
try {
    await api.tx.Revive.map_account().signAndSubmit(signer);
    console.log("Account mapped.");
} catch {
    // already mapped
}

// Deploy with CREATE2 for deterministic address
const CDM_REGISTRY_PACKAGE = "@cdm/registry";
console.log(`Deploying ContractRegistry (CREATE2 salt: "${CDM_REGISTRY_PACKAGE}")...`);
const { address } = await deployer.deploy(pvmPath, CDM_REGISTRY_PACKAGE);
console.log(`\nCONTRACTS_REGISTRY_ADDR=${address}`);

client.destroy();
