// Resolver e2e against a local PPN: the registry owns the resolver, one
// resolver upgrade reaches every call that asks the resolver while a shim's
// fast path keeps serving the latest version, and each route through a shim
// costs a measured amount over calling the implementation directly.

import { describe, test, expect, beforeAll, afterAll } from "vitest";
import { keccak_256 } from "@noble/hashes/sha3.js";
import type { HexString } from "polkadot-api";
import { createCdmAssetHubClient, prepareSigner, type CdmAssetHubClient } from "@parity/cdm-env";
import { ALICE_SS58 } from "@parity/cdm-utils";
import { CONTRACTS_REGISTRY_ABI, CONTRACT_RESOLVER_ABI } from "@parity/cdm-builder/abi";
import { encodeProxyLatest, encodeVersionedCall, packVersionKey } from "@parity/cdm-builder/proxy";
import { createContractFromClient } from "@parity/product-sdk-contracts";
import {
    connectPpn,
    deployRegistry,
    deployBlob,
    dryRunCall,
    ensureResolverFixtureBuilt,
    ensureTemplateBuilt,
    COUNTER_PVM,
    FIXTURE_RESOLVER_PVM,
    type DeployedRegistry,
    type PpnHandle,
} from "./harness";

// Unique per run so the suite holds on networks with prior registry state.
const RUN = Date.now().toString(36);
const NAME = `@test/resolver-${RUN}`;
/** A name whose owner turned the fast path off: its shim asks about every call. */
const OFF_NAME = `@test/resolver-off-${RUN}`;
const URI = "ipfs://bafyresolvere2e";
const KEY_1_0_0 = packVersionKey(1, 0, 0);
const KEY_1_1_0 = packVersionKey(1, 1, 0);
/** What the fixture resolver answers to every call. */
const MARKER = `0x${"f1".repeat(32)}`;

function selector(signature: string): `0x${string}` {
    const hash = keccak_256(new TextEncoder().encode(signature)).subarray(0, 4);
    return `0x${Array.from(hash)
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("")}` as `0x${string}`;
}

const GET_COUNT = selector("getCount()");

let ppn: PpnHandle;
let chainClient: CdmAssetHubClient;
let deployed: DeployedRegistry;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let api: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let registry: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let resolver: any;
let impl: HexString;
let fixture: HexString;
let realImpl: string;
let proxyAddress: string;
let offProxyAddress: string;

function lc(v: unknown): string {
    return String(v).toLowerCase();
}

function addressWord(address: string): string {
    return address.toLowerCase().replace(/^0x/, "").padStart(64, "0");
}

async function resolverCode(): Promise<string> {
    const r = await resolver.getCode.query();
    expect(r.success).toBe(true);
    return lc(r.value);
}

async function proxyOf(name: string): Promise<string> {
    const proxy = await registry.getProxy.query(name);
    return String((proxy.value as { value: string }).value);
}

/** Calls that ask the resolver: an older version, and a plain call with the fast path off. */
function routedCounts(): [string, string][] {
    return [
        [proxyAddress, encodeVersionedCall(KEY_1_0_0, GET_COUNT)],
        [offProxyAddress, GET_COUNT],
    ];
}

beforeAll(async () => {
    ppn = await connectPpn();
    deployed = await deployRegistry(ppn.wsUrl);
    await ensureTemplateBuilt();
    await ensureResolverFixtureBuilt();

    const signer = prepareSigner("Alice");
    chainClient = await createCdmAssetHubClient(ppn.wsUrl, "local");
    await chainClient.raw.assetHub.getChainSpecData();
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

    impl = await deployBlob(api, signer, COUNTER_PVM);
    fixture = await deployBlob(api, signer, FIXTURE_RESOLVER_PVM);

    // Every version is the same counter instance, so calls through the two
    // names differ only in how they are routed.
    for (const [name, key] of [
        [NAME, KEY_1_0_0],
        [NAME, KEY_1_1_0],
        [OFF_NAME, KEY_1_0_0],
    ] as const) {
        const published = await registry.publish.tx(name, key, impl, URI);
        expect(published.ok).toBe(true);
    }
    const off = await registry.setFastPath.tx(OFF_NAME, false);
    expect(off.ok).toBe(true);
    proxyAddress = await proxyOf(NAME);
    offProxyAddress = await proxyOf(OFF_NAME);
}, 300_000);

afterAll(async () => {
    chainClient?.destroy();
});

describe("resolver wiring", () => {
    test("the registry reports the deployed resolver and is its admin", async () => {
        const r = await registry.getResolver.query();
        expect(r.success).toBe(true);
        expect(lc(r.value)).toBe(lc(deployed.resolverAddress));

        const admin = await resolver.getAdmin.query();
        expect(lc(admin.value)).toBe(lc(deployed.address));
    });

    test("routingOf reflects the latest publish", async () => {
        const r = await resolver.routingOf.query(proxyAddress);
        expect(r.success).toBe(true);
        const row = r.value as { latest_key: unknown; latest_impl: unknown };
        expect(BigInt(String(row.latest_key))).toBe(KEY_1_1_0);
        expect(lc(row.latest_impl)).toBe(lc(impl));
    });

    test("only the registry can repoint the resolver", async () => {
        const r = await resolver.setCode.query(fixture, { origin: ALICE_SS58 });
        expect(r.success).toBe(false);
    });
});

describe("one resolver upgrade reaches every call that asks the resolver", () => {
    test("upgradeResolver to the fixture: those calls now answer the marker", async () => {
        realImpl = await resolverCode();
        const r = await registry.upgradeResolver.tx(fixture);
        expect(r.ok).toBe(true);
        expect(await resolverCode()).toBe(lc(fixture));

        // A meta query, then an older version and a name with its fast path off.
        const asked: [string, string][] = [[proxyAddress, encodeProxyLatest()], ...routedCounts()];
        for (const [dest, input] of asked) {
            const answer = await dryRunCall(api, dest, input);
            expect(answer.reverted).toBe(false);
            expect(answer.data).toBe(MARKER);
        }
    });

    test("the shim's fast path keeps serving the latest version through the upgrade", async () => {
        for (const input of [GET_COUNT, encodeVersionedCall(KEY_1_1_0, GET_COUNT)]) {
            const count = await dryRunCall(api, proxyAddress, input);
            expect(count.reverted).toBe(false);
            expect(BigInt(count.data)).toBe(0n);
        }
    });

    test("upgrading back restores normal routing", async () => {
        const r = await registry.upgradeResolver.tx(realImpl);
        expect(r.ok).toBe(true);
        expect(await resolverCode()).toBe(realImpl);

        const latest = await dryRunCall(api, proxyAddress, encodeProxyLatest());
        expect(latest.data).toBe(
            `0x${KEY_1_1_0.toString(16).padStart(64, "0")}${addressWord(impl)}`,
        );
        for (const [dest, input] of routedCounts()) {
            const count = await dryRunCall(api, dest, input);
            expect(count.reverted).toBe(false);
            expect(BigInt(count.data)).toBe(0n);
        }
    });
});

describe("routing overhead", () => {
    test("each frame a routed call adds, in both weight dimensions", async () => {
        const measure = async (label: string, dest: string, input: string) => {
            const r = await dryRunCall(api, dest, input);
            expect(r.success).toBe(true);
            expect(r.reverted).toBe(false);
            console.log(
                `routing overhead: ${label}: ${r.refTime} ref_time, ${r.proofSize} proof_size`,
            );
            return r;
        };
        const routingOf = `${selector("routingOf(address)")}${addressWord(proxyAddress)}`;
        const [pinnedOlder, plainOff] = routedCounts();

        const direct = await measure("implementation directly", impl, GET_COUNT);
        await measure(
            "resolver implementation routingOf directly",
            await resolverCode(),
            routingOf,
        );
        await measure("resolver routingOf through its proxy", deployed.resolverAddress, routingOf);
        await measure("shim meta latest() (no delegate)", proxyAddress, encodeProxyLatest());
        const fast = await measure("shim plain call (fast path)", proxyAddress, GET_COUNT);
        await measure(
            "shim call pinned to the latest version (fast path)",
            proxyAddress,
            encodeVersionedCall(KEY_1_1_0, GET_COUNT),
        );
        const routed = await measure(
            "shim plain call, fast path off (through the resolver)",
            ...plainOff,
        );
        await measure(
            "shim call pinned to an older version (through the resolver)",
            ...pinnedOlder,
        );

        // The shim's own frame costs something; asking the resolver costs more.
        for (const dimension of ["refTime", "proofSize"] as const) {
            expect(fast[dimension]).toBeGreaterThan(direct[dimension]);
            expect(routed[dimension]).toBeGreaterThan(fast[dimension]);
        }
    });
});
