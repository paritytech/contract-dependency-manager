// End-to-end per-name proxy validation against a live `revive-dev-node`.
//
// This is the suite that proves the versioned-proxy model does what it
// promises: one stable address per name, multiple implementation versions
// live simultaneously behind it, all sharing one storage. It publishes the
// shared-counter template blob twice (two distinct implementation addresses,
// same code), then interleaves plain calls (latest), versioned calls (exact
// version via the `[MAGIC][key]` calldata prefix), CDM meta queries, and the
// min-supported ratchet — asserting throughout that every route reads and
// writes the SAME counter.
//
// Wire-format helpers come from `@parity/cdm-builder`'s proxy.ts, so this
// suite also locks TS-side encoding against the deployed Rust end to end.

import { describe, test, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { keccak_256 } from "@noble/hashes/sha3.js";
import type { HexString } from "polkadot-api";
import { createCdmAssetHubClient, prepareSigner, type CdmAssetHubClient } from "@parity/cdm-env";
import { ALICE_SS58, GAS_LIMIT, STORAGE_DEPOSIT_LIMIT } from "@parity/cdm-utils";
import { CONTRACTS_REGISTRY_ABI } from "@parity/cdm-builder/abi";
import {
    encodeProxyAdmin,
    encodeProxyImplOf,
    encodeProxyLatest,
    encodeProxyMinSupported,
    encodeProxyPublish,
    encodeProxyResolveMax,
    encodeProxyVersionCount,
    encodeVersionedCall,
    packVersionKey,
} from "@parity/cdm-builder";
import { createContractFromClient } from "@parity/product-sdk-contracts";
import { submitAndWatch, type SubmittableTransaction } from "@parity/product-sdk-tx";
import {
    spawnReviveNode,
    deployRegistry,
    deployBlob,
    ensureTemplateBuilt,
    COUNTER_PVM,
    COUNTER_ABI_JSON,
    type NodeHandle,
} from "./harness";

const NAME = "@test/shared-counter";
const URI = "ipfs://bafyproxye2e";
const KEY_1_0_0 = packVersionKey(1, 0, 0);
const KEY_1_1_0 = packVersionKey(1, 1, 0);

// keccak256(signature)[..4] as calldata hex.
function selector(signature: string): `0x${string}` {
    const hash = keccak_256(new TextEncoder().encode(signature)).subarray(0, 4);
    return `0x${Array.from(hash)
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("")}` as `0x${string}`;
}

const INCREMENT = selector("increment()");
const GET_COUNT = selector("getCount()");
// Proxy revert selectors (signatures pinned in contract-proxy + proxy.ts).
const UNSUPPORTED_VERSION = selector("UnsupportedVersion(uint128,uint128)");
const UNKNOWN_VERSION = selector("UnknownVersion()");

let node: NodeHandle;
let chainClient: CdmAssetHubClient;
let registryAddress: string;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let api: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let signer: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let registry: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let counter: any;
let implA: HexString;
let implB: HexString;
let proxyAddress: string;

function lc(v: unknown): string {
    return String(v).toLowerCase();
}

/** Dry-run a raw contract call (versioned/meta wire formats have no ABI). */
async function dryRunCall(
    dest: string,
    input: string,
): Promise<{ success: boolean; reverted: boolean; data: string }> {
    const r = await api.apis.ReviveApi.call(ALICE_SS58, dest, 0n, undefined, undefined, input, {
        at: "best",
    });
    if (!r.result.success) {
        return { success: false, reverted: false, data: "0x" };
    }
    const flags = Number(r.result.value.flags);
    const data =
        typeof r.result.value.data === "string" ? r.result.value.data : r.result.value.data.asHex();
    return { success: true, reverted: (flags & 1) === 1, data: lc(data) };
}

/** Submit a raw contract call as a transaction (fixed generous limits). */
async function rawCallTx(dest: string, input: string): Promise<void> {
    const tx = api.tx.Revive.call({
        dest,
        value: 0n,
        gas_limit: { ref_time: GAS_LIMIT.refTime, proof_size: GAS_LIMIT.proofSize },
        storage_deposit_limit: STORAGE_DEPOSIT_LIMIT,
        data: input,
    });
    const result = await submitAndWatch(tx as unknown as SubmittableTransaction, signer, {
        waitFor: "best-block",
    });
    expect(result.ok).toBe(true);
}

/** Right-aligned 32-byte word containing a u128, as lowercase hex (no 0x). */
function u128Word(value: bigint): string {
    return value.toString(16).padStart(64, "0");
}

/** Right-aligned 32-byte word containing an address, lowercase hex (no 0x). */
function addressWord(address: string): string {
    return address.toLowerCase().replace(/^0x/, "").padStart(64, "0");
}

beforeAll(async () => {
    node = await spawnReviveNode();
    const deployed = await deployRegistry(node.wsUrl);
    registryAddress = deployed.address;
    await ensureTemplateBuilt();

    signer = prepareSigner("Alice");
    chainClient = await createCdmAssetHubClient(node.wsUrl, "local");
    await chainClient.raw.assetHub.getChainSpecData();
    api = chainClient.raw.assetHub.getTypedApi(chainClient.descriptors.assetHub);

    registry = await createContractFromClient(
        chainClient.raw.assetHub,
        chainClient.descriptors.assetHub,
        deployed.address,
        CONTRACTS_REGISTRY_ABI,
        { defaultSigner: signer, defaultOrigin: ALICE_SS58 },
    );

    // Two instances of the counter blob: distinct implementation addresses,
    // identical code — versions 1.0.0 and 1.1.0 of the same contract.
    implA = await deployBlob(api, signer, COUNTER_PVM);
    implB = await deployBlob(api, signer, COUNTER_PVM);
}, 300_000);

afterAll(async () => {
    chainClient?.destroy();
    await node?.kill();
});

describe("publish creates the per-name proxy", () => {
    test("first publish instantiates the proxy and getAddress resolves to it", async () => {
        const r = await registry.publish.tx(NAME, KEY_1_0_0, implA, URI);
        expect(r.ok).toBe(true);

        const proxy = await registry.getProxy.query(NAME);
        const opt = proxy.value as { isSome: boolean; value: string };
        expect(opt.isSome).toBe(true);
        proxyAddress = String(opt.value);
        expect(lc(proxyAddress)).not.toBe(lc(implA));

        // The plain counter ABI is served straight through the proxy.
        const abiJson = JSON.parse(readFileSync(COUNTER_ABI_JSON, "utf8"));
        const counterAbi = Array.isArray(abiJson) ? abiJson : abiJson.abi;
        counter = await createContractFromClient(
            chainClient.raw.assetHub,
            chainClient.descriptors.assetHub,
            proxyAddress,
            counterAbi,
            { defaultSigner: signer, defaultOrigin: ALICE_SS58 },
        );
    });

    test("plain calls route to the latest implementation", async () => {
        const r = await counter.increment.tx();
        expect(r.ok).toBe(true);

        const count = await counter.getCount.query();
        expect(count.success).toBe(true);
        expect(Number(count.value)).toBe(1);
    });
});

describe("multiple versions over one storage", () => {
    test("second publish keeps the proxy address", async () => {
        const r = await registry.publish.tx(NAME, KEY_1_1_0, implB, URI);
        expect(r.ok).toBe(true);

        const addr = await registry.getAddress.query(NAME);
        expect(lc((addr.value as { value: string }).value)).toBe(lc(proxyAddress));
    });

    test("plain call now routes to the new implementation — same state", async () => {
        // The counter written through implA continues through implB: the
        // storage belongs to the proxy, not to either implementation.
        const r = await counter.increment.tx();
        expect(r.ok).toBe(true);

        const count = await counter.getCount.query();
        expect(Number(count.value)).toBe(2);
    });

    test("a versioned call executes the OLD implementation on the same state", async () => {
        await rawCallTx(proxyAddress, encodeVersionedCall(KEY_1_0_0, INCREMENT));

        // Written via 1.0.0 (implA), read via latest (implB): one counter.
        const count = await counter.getCount.query();
        expect(Number(count.value)).toBe(3);
    });

    test("versioned reads through both versions see the same value", async () => {
        for (const key of [KEY_1_0_0, KEY_1_1_0]) {
            const r = await dryRunCall(proxyAddress, encodeVersionedCall(key, GET_COUNT));
            expect(r.success).toBe(true);
            expect(r.reverted).toBe(false);
            expect(BigInt(`0x${r.data.replace(/^0x/, "")}`)).toBe(3n);
        }
    });

    test("a never-published version reverts UnknownVersion", async () => {
        const r = await dryRunCall(
            proxyAddress,
            encodeVersionedCall(packVersionKey(9, 9, 9), GET_COUNT),
        );
        expect(r.success).toBe(true);
        expect(r.reverted).toBe(true);
        expect(r.data.startsWith(UNKNOWN_VERSION)).toBe(true);
    });
});

describe("meta plane", () => {
    test("versionCount / latest / implOf / admin / minSupported", async () => {
        const count = await dryRunCall(proxyAddress, encodeProxyVersionCount());
        expect(count.data).toBe(`0x${u128Word(2n)}`);

        const latest = await dryRunCall(proxyAddress, encodeProxyLatest());
        expect(latest.data).toBe(`0x${u128Word(KEY_1_1_0)}${addressWord(implB)}`);

        const implOf = await dryRunCall(proxyAddress, encodeProxyImplOf(KEY_1_0_0));
        expect(implOf.data).toBe(`0x${addressWord(implA)}`);

        // The registry (proxy address) is the admin — it instantiated it.
        const admin = await dryRunCall(proxyAddress, encodeProxyAdmin());
        expect(admin.data).toBe(`0x${addressWord(registryAddress)}`);

        const min = await dryRunCall(proxyAddress, encodeProxyMinSupported());
        expect(min.data).toBe(`0x${u128Word(0n)}`);
    });

    test("resolveMax binary-searches the published range", async () => {
        // ^1.0.0 → highest published 1.x = 1.1.0
        const r = await dryRunCall(
            proxyAddress,
            encodeProxyResolveMax(KEY_1_0_0, packVersionKey(1, 0xffffffff, 0xffffffff)),
        );
        expect(r.data).toBe(`0x${u128Word(KEY_1_1_0)}`);

        // An empty range resolves to 0.
        const none = await dryRunCall(
            proxyAddress,
            encodeProxyResolveMax(packVersionKey(2, 0, 0), packVersionKey(3, 0, 0)),
        );
        expect(none.data).toBe(`0x${u128Word(0n)}`);
    });

    test("meta admin ops from a non-registry caller revert", async () => {
        // Alice calls publish straight at the proxy (not through the
        // registry) — the proxy's admin is the registry, so this must revert.
        const r = await dryRunCall(
            proxyAddress,
            encodeProxyPublish(packVersionKey(2, 0, 0), implA),
        );
        expect(r.success).toBe(true);
        expect(r.reverted).toBe(true);
    });
});

describe("min-supported ratchet", () => {
    test("owner raises the floor through the registry", async () => {
        const r = await registry.setMinSupported.tx(NAME, KEY_1_1_0);
        expect(r.ok).toBe(true);

        const min = await dryRunCall(proxyAddress, encodeProxyMinSupported());
        expect(min.data).toBe(`0x${u128Word(KEY_1_1_0)}`);
    });

    test("pinned calls below the floor revert UnsupportedVersion", async () => {
        const r = await dryRunCall(proxyAddress, encodeVersionedCall(KEY_1_0_0, GET_COUNT));
        expect(r.success).toBe(true);
        expect(r.reverted).toBe(true);
        expect(r.data.startsWith(UNSUPPORTED_VERSION)).toBe(true);
    });

    test("plain (latest) calls are unaffected by the floor", async () => {
        const r = await counter.increment.tx();
        expect(r.ok).toBe(true);
        const count = await counter.getCount.query();
        expect(Number(count.value)).toBe(4);
    });
});

describe("publish rules", () => {
    test("non-monotonic publish is rejected", async () => {
        const r = await registry.publish.tx(NAME, packVersionKey(1, 0, 5), implA, URI);
        expect(r.ok).toBe(false);
    });
});
