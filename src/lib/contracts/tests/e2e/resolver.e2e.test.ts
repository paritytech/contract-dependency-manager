// Resolver e2e against a local PPN: the registry owns the resolver, one
// resolver upgrade reaches a name published before it, and routing through
// a shim costs a measured amount over calling the implementation directly.

import { describe, test, expect, beforeAll, afterAll } from "vitest";
import { keccak_256 } from "@noble/hashes/sha3.js";
import type { HexString } from "polkadot-api";
import { createCdmAssetHubClient, prepareSigner, type CdmAssetHubClient } from "@parity/cdm-env";
import { ALICE_SS58 } from "@parity/cdm-utils";
import { CONTRACTS_REGISTRY_ABI, CONTRACT_RESOLVER_ABI } from "@parity/cdm-builder/abi";
import { encodeProxyLatest, packVersionKey } from "@parity/cdm-builder/proxy";
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
const URI = "ipfs://bafyresolvere2e";
const KEY_1_0_0 = packVersionKey(1, 0, 0);
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

    const published = await registry.publish.tx(NAME, KEY_1_0_0, impl, URI);
    expect(published.ok).toBe(true);
    const proxy = await registry.getProxy.query(NAME);
    proxyAddress = String((proxy.value as { value: string }).value);
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

    test("routingOf reflects the publish", async () => {
        const r = await resolver.routingOf.query(proxyAddress);
        expect(r.success).toBe(true);
        const row = r.value as { latest_key: unknown; latest_impl: unknown };
        expect(BigInt(String(row.latest_key))).toBe(KEY_1_0_0);
        expect(lc(row.latest_impl)).toBe(lc(impl));
    });

    test("only the registry can repoint the resolver", async () => {
        const r = await resolver.setCode.query(fixture, { origin: ALICE_SS58 });
        expect(r.success).toBe(false);
    });
});

describe("one resolver upgrade reaches an already-published name", () => {
    test("upgradeResolver to the fixture: the name now answers the marker", async () => {
        realImpl = await resolverCode();
        const r = await registry.upgradeResolver.tx(fixture);
        expect(r.ok).toBe(true);
        expect(await resolverCode()).toBe(lc(fixture));

        for (const input of [encodeProxyLatest(), GET_COUNT]) {
            const answer = await dryRunCall(api, proxyAddress, input);
            expect(answer.reverted).toBe(false);
            expect(answer.data).toBe(MARKER);
        }
    });

    test("upgrading back restores normal routing", async () => {
        const r = await registry.upgradeResolver.tx(realImpl);
        expect(r.ok).toBe(true);
        expect(await resolverCode()).toBe(realImpl);

        const latest = await dryRunCall(api, proxyAddress, encodeProxyLatest());
        expect(latest.data).toBe(
            `0x${KEY_1_0_0.toString(16).padStart(64, "0")}${addressWord(impl)}`,
        );
        const count = await dryRunCall(api, proxyAddress, GET_COUNT);
        expect(count.reverted).toBe(false);
        expect(BigInt(count.data)).toBe(0n);
    });
});

describe("routing overhead", () => {
    test("each frame a routed call adds, in both weight dimensions", async () => {
        const routingOf = `${selector("routingOf(address)")}${addressWord(proxyAddress)}`;
        const calls: [string, string, string][] = [
            ["implementation directly", impl, GET_COUNT],
            ["resolver implementation routingOf directly", await resolverCode(), routingOf],
            ["resolver routingOf through its proxy", deployed.resolverAddress, routingOf],
            ["shim meta latest() (no delegate)", proxyAddress, encodeProxyLatest()],
            ["shim plain call", proxyAddress, GET_COUNT],
        ];
        const measured = [];
        for (const [label, dest, input] of calls) {
            const r = await dryRunCall(api, dest, input);
            expect(r.success).toBe(true);
            expect(r.reverted).toBe(false);
            measured.push({ label, refTime: r.refTime, proofSize: r.proofSize });
            console.log(
                `routing overhead: ${label}: ${r.refTime} ref_time, ${r.proofSize} proof_size`,
            );
        }
        const direct = measured[0];
        const viaShim = measured[measured.length - 1];
        expect(viaShim.refTime).toBeGreaterThan(direct.refTime);
        expect(viaShim.proofSize).toBeGreaterThan(direct.proofSize);
    });
});
