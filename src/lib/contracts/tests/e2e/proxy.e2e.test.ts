// Per-name shim e2e against a local PPN: the shared-counter blob is
// published twice as two versions of one name, then plain, versioned, and
// meta calls must all read and write the same counter, with the routing
// state readable from the resolver and the shim's fast path following every
// publish, freeze, and opt-out. A second name is sealed.

import { describe, test, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { keccak_256 } from "@noble/hashes/sha3.js";
import type { HexString } from "polkadot-api";
import { createCdmAssetHubClient, prepareSigner, type CdmAssetHubClient } from "@parity/cdm-env";
import { ALICE_SS58 } from "@parity/cdm-utils";
import { CONTRACTS_REGISTRY_ABI, CONTRACT_RESOLVER_ABI } from "@parity/cdm-builder/abi";
import {
    decodeAddressWord,
    decodeBoolWord,
    decodeVersionPair,
    encodeProxyAdmin,
    encodeProxyCallCode,
    encodeProxyFrozen,
    encodeProxyImplOf,
    encodeProxyLatest,
    encodeProxyMetaCall,
    encodeProxyMinSupported,
    encodeProxyResolver,
    encodeProxySealed,
    encodeVersionedCall,
    packVersionKey,
    SHIM_SLOTS,
    unpackFastPath,
} from "@parity/cdm-builder/proxy";
import { createContractFromClient } from "@parity/product-sdk-contracts";
import {
    connectPpn,
    deployRegistry,
    deployBlob,
    dryRunCall,
    ensureTemplateBuilt,
    rawCallTx,
    COUNTER_PVM,
    COUNTER_ABI_JSON,
    type PpnHandle,
} from "./harness";

// Unique per run so the suite holds on networks with prior registry state.
const RUN = Date.now().toString(36);
const NAME = `@test/counter-${RUN}`;
// Sealing is irreversible, so it gets a name of its own.
const SEALED_NAME = `@test/sealed-${RUN}`;
const URI = "ipfs://bafyproxye2e";
const KEY_1_0_0 = packVersionKey(1, 0, 0);
const KEY_1_1_0 = packVersionKey(1, 1, 0);
const KEY_1_2_0 = packVersionKey(1, 2, 0);
/** The fast path of a shim that has no shortcut. */
const NO_FAST_PATH = { key: 0n, target: `0x${"00".repeat(20)}` };

// keccak256(signature)[..4] as calldata hex.
function selector(signature: string): `0x${string}` {
    const hash = keccak_256(new TextEncoder().encode(signature)).subarray(0, 4);
    return `0x${Array.from(hash)
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("")}` as `0x${string}`;
}

const INCREMENT = selector("increment()");
const GET_COUNT = selector("getCount()");
// Resolver revert selectors (signatures pinned in contract-resolver + proxy.ts).
const UNSUPPORTED_VERSION = selector("UnsupportedVersion(uint128,uint128)");
const UNKNOWN_VERSION = selector("UnknownVersion()");
const CONTRACT_FROZEN = selector("ContractFrozen()");
const UNKNOWN_META_SELECTOR = selector("UnknownMetaSelector()");
const UNAUTHORIZED_ADMIN = selector("UnauthorizedAdmin()");
const NAME_SEALED = selector("NameSealed()");
// The shim's own revert selector.
const SEALED = selector("Sealed()");

let ppn: PpnHandle;
let chainClient: CdmAssetHubClient;
let registryAddress: string;
let resolverAddress: string;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let api: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let signer: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let registry: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let resolver: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let counter: any;
let implA: HexString;
let implB: HexString;
let proxyAddress: string;

function lc(v: unknown): string {
    return String(v).toLowerCase();
}

/** Right-aligned 32-byte word containing a u128, as lowercase hex (no 0x). */
function u128Word(value: bigint): string {
    return value.toString(16).padStart(64, "0");
}

/** Right-aligned 32-byte word containing an address, lowercase hex (no 0x). */
function addressWord(address: string): string {
    return address.toLowerCase().replace(/^0x/, "").padStart(64, "0");
}

/** `routingOf(proxy)` as the resolver reports it. */
async function routing(address: string = proxyAddress): Promise<{
    minSupported: bigint;
    frozen: boolean;
    fastPathOff: boolean;
    sealed: boolean;
}> {
    const r = await resolver.routingOf.query(address);
    expect(r.success).toBe(true);
    const row = r.value as {
        min_supported?: unknown;
        frozen?: unknown;
        fast_path_off?: unknown;
        sealed?: unknown;
    };
    return {
        minSupported: BigInt(String(row.min_supported)),
        frozen: Boolean(row.frozen),
        fastPathOff: Boolean(row.fast_path_off),
        sealed: Boolean(row.sealed),
    };
}

/** Dry-run one of the getters the shim answers itself. */
async function shimGetter(address: string, input: string): Promise<`0x${string}`> {
    const r = await dryRunCall(api, address, input);
    expect(r.success).toBe(true);
    expect(r.reverted).toBe(false);
    return r.data as `0x${string}`;
}

/** The shim's fast-path slot, read from chain state: the version it serves without asking the resolver. */
async function fastPath(address: string = proxyAddress): Promise<{ key: bigint; target: string }> {
    const r = await api.apis.ReviveApi.get_storage(address, SHIM_SLOTS.fast, { at: "best" });
    expect(r.success).toBe(true);
    if (r.value === undefined) return NO_FAST_PATH;
    const { key, implementation } = unpackFastPath(r.value);
    return { key, target: implementation };
}

beforeAll(async () => {
    ppn = await connectPpn();
    const deployed = await deployRegistry(ppn.wsUrl);
    registryAddress = deployed.address;
    resolverAddress = deployed.resolverAddress;
    await ensureTemplateBuilt();

    signer = prepareSigner("Alice");
    chainClient = await createCdmAssetHubClient(ppn.wsUrl, "local");
    await chainClient.raw.assetHub.getChainSpecData();
    // The unsafe api skips descriptor compatibility checks — the generated
    // descriptors lag PPN's runtime for Revive.call/ReviveApi.call, and
    // product-sdk itself falls back to the unsafe api for the same reason.
    api = chainClient.raw.assetHub.getUnsafeApi();

    const contractAt = (address: string, abi: typeof CONTRACTS_REGISTRY_ABI) =>
        createContractFromClient(
            chainClient.raw.assetHub,
            chainClient.descriptors.assetHub,
            address as HexString,
            abi,
            { defaultSigner: signer, defaultOrigin: ALICE_SS58 },
        );
    registry = await contractAt(deployed.address, CONTRACTS_REGISTRY_ABI);
    resolver = await contractAt(deployed.resolverAddress, CONTRACT_RESOLVER_ABI);

    implA = await deployBlob(api, signer, COUNTER_PVM);
    implB = await deployBlob(api, signer, COUNTER_PVM);
}, 300_000);

afterAll(async () => {
    chainClient?.destroy();
});

describe("publish creates the per-name shim", () => {
    test("first publish instantiates the shim and getAddress resolves to it", async () => {
        const r = await registry.publish.tx(NAME, KEY_1_0_0, implA, URI);
        expect(r.ok).toBe(true);

        const proxy = await registry.getProxy.query(NAME);
        const opt = proxy.value as { isSome: boolean; value: string };
        expect(opt.isSome).toBe(true);
        proxyAddress = String(opt.value);
        expect(lc(proxyAddress)).not.toBe(lc(implA));

        // The plain counter ABI is served straight through the shim.
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

    test("the shim holds the published version as its fast path", async () => {
        expect(await fastPath()).toEqual({ key: KEY_1_0_0, target: lc(implA) });
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
    test("second publish keeps the shim address", async () => {
        const r = await registry.publish.tx(NAME, KEY_1_1_0, implB, URI);
        expect(r.ok).toBe(true);

        const addr = await registry.getAddress.query(NAME);
        expect(lc((addr.value as { value: string }).value)).toBe(lc(proxyAddress));
    });

    test("the fast path follows the publish", async () => {
        expect(await fastPath()).toEqual({ key: KEY_1_1_0, target: lc(implB) });
    });

    test("plain call now routes to the new implementation — same state", async () => {
        const r = await counter.increment.tx();
        expect(r.ok).toBe(true);

        const count = await counter.getCount.query();
        expect(Number(count.value)).toBe(2);
    });

    test("a versioned call executes the OLD implementation on the same state", async () => {
        await rawCallTx(api, signer, proxyAddress, encodeVersionedCall(KEY_1_0_0, INCREMENT));

        const count = await counter.getCount.query();
        expect(Number(count.value)).toBe(3);
    });

    test("a versioned call for the latest version executes on the same state", async () => {
        await rawCallTx(api, signer, proxyAddress, encodeVersionedCall(KEY_1_1_0, INCREMENT));

        const count = await counter.getCount.query();
        expect(Number(count.value)).toBe(4);
    });

    test("empty calldata reaches the implementation on both fast-path routes", async () => {
        const direct = await dryRunCall(api, implB, "0x");
        expect(direct.success).toBe(true);
        for (const input of ["0x", encodeVersionedCall(KEY_1_1_0, "0x")]) {
            const r = await dryRunCall(api, proxyAddress, input);
            expect(r.success).toBe(true);
            expect(r.reverted).toBe(direct.reverted);
            expect(r.data).toBe(direct.data);
        }
    });

    test("versioned reads through both versions see the same value", async () => {
        for (const key of [KEY_1_0_0, KEY_1_1_0]) {
            const r = await dryRunCall(api, proxyAddress, encodeVersionedCall(key, GET_COUNT));
            expect(r.success).toBe(true);
            expect(r.reverted).toBe(false);
            expect(BigInt(`0x${r.data.replace(/^0x/, "")}`)).toBe(4n);
        }
    });

    test("a never-published version reverts UnknownVersion", async () => {
        const r = await dryRunCall(
            api,
            proxyAddress,
            encodeVersionedCall(packVersionKey(9, 9, 9), GET_COUNT),
        );
        expect(r.success).toBe(true);
        expect(r.reverted).toBe(true);
        expect(r.data.startsWith(UNKNOWN_VERSION)).toBe(true);
    });
});

describe("meta plane", () => {
    test("latest / implOf / admin / minSupported", async () => {
        const latest = await dryRunCall(api, proxyAddress, encodeProxyLatest());
        expect(latest.data).toBe(`0x${u128Word(KEY_1_1_0)}${addressWord(implB)}`);

        const implOf = await dryRunCall(api, proxyAddress, encodeProxyImplOf(KEY_1_0_0));
        expect(implOf.data).toBe(`0x${addressWord(implA)}`);

        const admin = await dryRunCall(api, proxyAddress, encodeProxyAdmin());
        expect(admin.data).toBe(`0x${addressWord(registryAddress)}`);

        const min = await dryRunCall(api, proxyAddress, encodeProxyMinSupported());
        expect(min.data).toBe(`0x${u128Word(0n)}`);
    });

    test("mutations are not meta operations: their selectors are unknown", async () => {
        for (const signature of [
            "publish(uint128,address)",
            "setMinSupported(uint128)",
            "setAdmin(address)",
            "freeze()",
            "unfreeze()",
        ]) {
            const r = await dryRunCall(api, proxyAddress, encodeProxyMetaCall(selector(signature)));
            expect(r.success).toBe(true);
            expect(r.reverted).toBe(true);
            expect(r.data.startsWith(UNKNOWN_META_SELECTOR)).toBe(true);
        }
    });

    test("callCode from anyone but the registry reverts UnauthorizedAdmin", async () => {
        const r = await dryRunCall(api, proxyAddress, encodeProxyCallCode(implA, GET_COUNT));
        expect(r.success).toBe(true);
        expect(r.reverted).toBe(true);
        expect(r.data.startsWith(UNAUTHORIZED_ADMIN)).toBe(true);
    });
});

describe("min-supported ratchet", () => {
    test("owner raises the floor through the registry", async () => {
        const r = await registry.setMinSupported.tx(NAME, KEY_1_1_0);
        expect(r.ok).toBe(true);

        const min = await dryRunCall(api, proxyAddress, encodeProxyMinSupported());
        expect(min.data).toBe(`0x${u128Word(KEY_1_1_0)}`);
        expect((await routing()).minSupported).toBe(KEY_1_1_0);
    });

    test("pinned calls below the floor revert UnsupportedVersion", async () => {
        const r = await dryRunCall(api, proxyAddress, encodeVersionedCall(KEY_1_0_0, GET_COUNT));
        expect(r.success).toBe(true);
        expect(r.reverted).toBe(true);
        expect(r.data.startsWith(UNSUPPORTED_VERSION)).toBe(true);
    });

    test("plain (latest) calls are unaffected by the floor", async () => {
        const r = await counter.increment.tx();
        expect(r.ok).toBe(true);
        const count = await counter.getCount.query();
        expect(Number(count.value)).toBe(5);
    });
});

describe("freeze / unfreeze", () => {
    test("owner freezes through the registry; all delegation halts", async () => {
        const r = await registry.freezeContract.tx(NAME);
        expect(r.ok).toBe(true);

        // Plain and versioned calls both revert ContractFrozen().
        const plain = await dryRunCall(api, proxyAddress, GET_COUNT);
        expect(plain.reverted).toBe(true);
        expect(plain.data.startsWith(CONTRACT_FROZEN)).toBe(true);
        const versioned = await dryRunCall(
            api,
            proxyAddress,
            encodeVersionedCall(KEY_1_1_0, GET_COUNT),
        );
        expect(versioned.reverted).toBe(true);
        expect(versioned.data.startsWith(CONTRACT_FROZEN)).toBe(true);

        // The meta plane and the resolver both report the freeze.
        const frozen = await dryRunCall(api, proxyAddress, encodeProxyFrozen());
        expect(frozen.reverted).toBe(false);
        expect(BigInt(frozen.data)).toBe(1n);
        expect((await routing()).frozen).toBe(true);
    });

    test("freezing empties the shim's fast path; the resolver answers latest()", async () => {
        expect(await fastPath()).toEqual(NO_FAST_PATH);
        const latest = await dryRunCall(api, proxyAddress, encodeProxyLatest());
        expect(latest.data).toBe(`0x${u128Word(KEY_1_1_0)}${addressWord(implB)}`);
    });

    test("unfreeze restores delegation", async () => {
        const r = await registry.unfreezeContract.tx(NAME);
        expect(r.ok).toBe(true);

        const count = await counter.getCount.query();
        expect(count.success).toBe(true);
        expect(Number(count.value)).toBe(5);
        expect((await routing()).frozen).toBe(false);
    });

    test("unfreezing hands the latest version back to the shim", async () => {
        expect(await fastPath()).toEqual({ key: KEY_1_1_0, target: lc(implB) });
    });
});

describe("publish rules", () => {
    test("non-monotonic publish is rejected", async () => {
        const r = await registry.publish.tx(NAME, packVersionKey(1, 0, 5), implA, URI);
        expect(r.ok).toBe(false);
    });

    test("an implementation with no code is rejected", async () => {
        const dry = await registry.publish.query(
            NAME,
            packVersionKey(1, 2, 0),
            "0x1111111111111111111111111111111111111111",
            URI,
            { origin: ALICE_SS58 },
        );
        expect(dry.success).toBe(false);
        expect(dry.value.decoded?.errorName).toBe("BadImplementation");
    });
});

describe("fast path opt-out", () => {
    test("the owner turns the fast path off; plain calls keep working", async () => {
        const r = await registry.setFastPath.tx(NAME, false);
        expect(r.ok).toBe(true);
        expect(await fastPath()).toEqual(NO_FAST_PATH);
        expect((await routing()).fastPathOff).toBe(true);

        const increment = await counter.increment.tx();
        expect(increment.ok).toBe(true);
        const count = await counter.getCount.query();
        expect(Number(count.value)).toBe(6);
    });

    test("a publish leaves the fast path empty", async () => {
        const r = await registry.publish.tx(NAME, KEY_1_2_0, implA, URI);
        expect(r.ok).toBe(true);
        expect(await fastPath()).toEqual(NO_FAST_PATH);
    });

    test("turning it back on hands the shim the latest version", async () => {
        const r = await registry.setFastPath.tx(NAME, true);
        expect(r.ok).toBe(true);
        expect(await fastPath()).toEqual({ key: KEY_1_2_0, target: lc(implA) });
        expect((await routing()).fastPathOff).toBe(false);
    });
});

describe("seal", () => {
    let sealedProxy: string;

    beforeAll(async () => {
        for (const [key, impl] of [
            [KEY_1_0_0, implA],
            [KEY_1_1_0, implB],
        ] as const) {
            const r = await registry.publish.tx(SEALED_NAME, key, impl, URI);
            expect(r.ok).toBe(true);
        }
        const proxy = await registry.getProxy.query(SEALED_NAME);
        sealedProxy = String((proxy.value as { value: string }).value);
    });

    test("the owner seals the name on its latest version", async () => {
        const r = await registry.sealContract.tx(SEALED_NAME);
        expect(r.ok).toBe(true);
        expect((await routing(sealedProxy)).sealed).toBe(true);
    });

    test("the shim's own getters and latest() answer on a sealed name", async () => {
        expect(decodeBoolWord(await shimGetter(sealedProxy, encodeProxySealed()))).toBe(true);
        expect(decodeVersionPair(await shimGetter(sealedProxy, encodeProxyLatest()))).toEqual({
            key: KEY_1_1_0,
            target: lc(implB),
        });
        expect(decodeAddressWord(await shimGetter(sealedProxy, encodeProxyResolver()))).toBe(
            lc(resolverAddress),
        );
    });

    test("plain calls and calls pinned to the sealed version keep working", async () => {
        await rawCallTx(api, signer, sealedProxy, INCREMENT);

        for (const input of [GET_COUNT, encodeVersionedCall(KEY_1_1_0, GET_COUNT)]) {
            const r = await dryRunCall(api, sealedProxy, input);
            expect(r.success).toBe(true);
            expect(r.reverted).toBe(false);
            expect(BigInt(r.data)).toBe(1n);
        }
    });

    test("another version and the resolver's meta queries revert Sealed", async () => {
        for (const input of [encodeVersionedCall(KEY_1_0_0, GET_COUNT), encodeProxyFrozen()]) {
            const r = await dryRunCall(api, sealedProxy, input);
            expect(r.success).toBe(true);
            expect(r.reverted).toBe(true);
            expect(r.data.startsWith(SEALED)).toBe(true);
        }
    });

    test("publish, freezeContract and setFastPath revert NameSealed", async () => {
        const attempts = [
            registry.publish.query(SEALED_NAME, KEY_1_2_0, implA, URI, { origin: ALICE_SS58 }),
            registry.freezeContract.query(SEALED_NAME, { origin: ALICE_SS58 }),
            registry.setFastPath.query(SEALED_NAME, false, { origin: ALICE_SS58 }),
        ];
        for (const attempt of attempts) {
            const dry = await attempt;
            expect(dry.success).toBe(false);
            // The resolver's error bubbles through the registry, whose ABI
            // does not list it, so it arrives undecoded.
            expect(lc(dry.value.data).startsWith(NAME_SEALED)).toBe(true);
        }
    });
});
