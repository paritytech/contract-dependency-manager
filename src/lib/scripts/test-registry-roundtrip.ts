// Real end-to-end validation of the new SDK ContractRegistry.
//
// Spins NOTHING — assumes a `revive-dev-node --dev` is already listening at
// the URL passed via --assethub-url, and the registry has been deployed to
// the address passed via --registry. Exercises:
//   - publishLatest(name, address, metadataUri) [mutating]
//   - getVersionCount(name)                       [view]
//   - getAddress(name)                            [view]
//   - getMetadataUri(name)                        [view]
//   - getAddressAtVersion(name, version)          [view]
//   - getMetadataUriAtVersion(name, version)      [view]
//   - getOwner(name)                              [view]
//   - getContractCount()                          [view]
//   - searchContractNames(prefix, offset, limit)  [view] — the new linear-scan path
//
// All Solidity-ABI calls flow through the same TS code paths CDM uses in
// production (`createContractFromClient` + the embedded CONTRACTS_REGISTRY_ABI),
// so a passing run here means: the new SDK's wire encoding matches CDM's
// expected shapes on every method the install/publish pipelines touch.

import { parseArgs } from "node:util";
import type { HexString } from "polkadot-api";
import { createCdmAssetHubClient, prepareSigner } from "@dotdm/env";
import { ALICE_SS58 } from "@dotdm/utils";
import { CONTRACTS_REGISTRY_ABI } from "@dotdm/contracts";
import { createContractFromClient } from "@parity/product-sdk-contracts";

const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
        "assethub-url": { type: "string" },
        registry: { type: "string" },
    },
});

const assethubUrl = values["assethub-url"] ?? "ws://127.0.0.1:9944";
const registryAddress = values.registry as HexString | undefined;
if (!registryAddress) {
    console.error("Error: --registry <hex> is required");
    process.exit(1);
}

function assert(cond: unknown, msg: string): void {
    if (cond) {
        console.log(`  ✓ ${msg}`);
    } else {
        console.error(`  ✗ ${msg}`);
        process.exit(1);
    }
}

function eqHex(a: string | undefined, b: string): boolean {
    return (a ?? "").toLowerCase() === b.toLowerCase();
}

console.log(`Connecting to ${assethubUrl}...`);
const signer = prepareSigner("Alice");
const chainClient = await createCdmAssetHubClient(assethubUrl, "local");
await chainClient.raw.assetHub.getChainSpecData();
console.log("Connected.");

const registry = await createContractFromClient(
    chainClient.raw.assetHub,
    chainClient.descriptors.assetHub,
    registryAddress,
    CONTRACTS_REGISTRY_ABI,
    { defaultSigner: signer, defaultOrigin: ALICE_SS58 },
);

const NAME = "@test/roundtrip";
const ADDR = "0x1111111111111111111111111111111111111111" as HexString;
const URI = "ipfs://bafy2bzaceblahblahQmExampleLongCidExercisingSpilledChunks"; // 59 bytes — long-form (length slot + spilled body chunks)

console.log("\n[1] Pre-publish queries (registry should be empty for this name):");
{
    const vc = await registry.getVersionCount.query(NAME);
    assert(vc.success, "getVersionCount: query succeeded");
    assert(vc.value === 0, `getVersionCount: value=${vc.value} (expected 0)`);

    const addr = await registry.getAddress.query(NAME);
    assert(addr.success, "getAddress: query succeeded");
    assert(
        eqHex(addr.value as string, "0x0000000000000000000000000000000000000000"),
        `getAddress: zero address (got ${addr.value})`,
    );

    const meta = await registry.getMetadataUri.query(NAME);
    assert(meta.success, "getMetadataUri: query succeeded");
    assert(meta.value === "", `getMetadataUri: empty string (got "${meta.value}")`);
}

console.log("\n[2] publishLatest tx:");
{
    const result = await registry.publishLatest.tx(NAME, ADDR, URI);
    assert(result.ok, `publishLatest: tx finalized (block hash ${result.blockHash})`);
}

console.log("\n[3] Post-publish queries (registry should reflect version 1):");
{
    const vc = await registry.getVersionCount.query(NAME);
    assert(vc.value === 1, `getVersionCount: value=${vc.value} (expected 1)`);

    const addr = await registry.getAddress.query(NAME);
    assert(eqHex(addr.value as string, ADDR), `getAddress: got ${addr.value} (expected ${ADDR})`);

    const meta = await registry.getMetadataUri.query(NAME);
    assert(meta.value === URI, `getMetadataUri: got "${meta.value}" (expected "${URI}")`);

    const addrAt = await registry.getAddressAtVersion.query(NAME, 0);
    assert(
        eqHex(addrAt.value as string, ADDR),
        `getAddressAtVersion(0): got ${addrAt.value} (expected ${ADDR})`,
    );

    const metaAt = await registry.getMetadataUriAtVersion.query(NAME, 0);
    assert(metaAt.value === URI, `getMetadataUriAtVersion(0): got "${metaAt.value}"`);

    // MappingString<u32> sanity check (non-tuple key) — contract_name_at was
    // also written during publishLatest's first-time registration.
    const nameAt0 = await registry.getContractNameAt.query(0);
    assert(
        nameAt0.value === NAME,
        `getContractNameAt(0): got "${nameAt0.value}" (expected "${NAME}")`,
    );

    const owner = await registry.getOwner.query(NAME);
    assert(typeof owner.value === "string", `getOwner: returned a string (${owner.value})`);

    const count = await registry.getContractCount.query();
    assert(count.value === 1, `getContractCount: ${count.value} (expected 1)`);
}

console.log("\n[4] searchContractNames — the linear-scan prefix-match path:");
{
    const page = await registry.searchContractNames.query("@test/", 0, 10);
    assert(page.success, "searchContractNames: query succeeded");
    const value = page.value as
        | { names?: string[]; next_offset?: number; done?: boolean }
        | unknown[];
    let names: string[] = [];
    let done: boolean | undefined;
    if (Array.isArray(value)) {
        names = (value[0] as string[]) ?? [];
        done = Boolean(value[2]);
    } else if (value && typeof value === "object") {
        names = (value as { names?: string[] }).names ?? [];
        done = (value as { done?: boolean }).done;
    }
    assert(names.includes(NAME), `searchContractNames: returned ${names.join(", ")}`);
    assert(done === true, `searchContractNames: done=${done} (expected true)`);

    const empty = await registry.searchContractNames.query("@nonexistent/", 0, 10);
    const emptyVal = empty.value as { names?: string[] } | unknown[];
    const emptyNames = Array.isArray(emptyVal)
        ? ((emptyVal[0] as string[]) ?? [])
        : ((emptyVal as { names?: string[] }).names ?? []);
    assert(emptyNames.length === 0, `searchContractNames("@nonexistent/"): empty result`);
}

console.log("\nAll roundtrip checks passed. Registry is wire-compatible with CDM TS.");
process.exit(0);
