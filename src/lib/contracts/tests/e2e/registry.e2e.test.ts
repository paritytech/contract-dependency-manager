// End-to-end registry validation against a live `revive-dev-node`.
//
// The suite spawns a fresh node + deploys the registry once (`beforeAll`),
// then drives every public method via the same code path CDM's TS pipeline
// uses (`createContractFromClient` + the embedded `CONTRACTS_REGISTRY_ABI`).
// Each assertion is its own `test()` for granular failure attribution.
//
// Gated to the `e2e/` directory by `vitest.e2e.config.ts` so `pnpm test`
// (unit only) stays fast; run this suite via `pnpm test:e2e`.

import { describe, test, expect, beforeAll, afterAll } from "vitest";
import type { HexString } from "polkadot-api";
import { createCdmAssetHubClient, prepareSigner, type CdmChainClient } from "@dotdm/env";
import { ALICE_SS58 } from "@dotdm/utils";
// Subpath `@dotdm/contracts/abi` rather than the package root: vitest's
// Vite resolver tree-shakes the package's `dist/index.js` (re-exports +
// Node-only deps in adjacent modules) and CONTRACTS_REGISTRY_ABI comes back
// undefined. The dedicated subpath maps straight to `dist/abi.js`.
import { CONTRACTS_REGISTRY_ABI } from "@dotdm/contracts/abi";
import { createContractFromClient } from "@parity/product-sdk-contracts";
import { spawnReviveNode, deployRegistry, type NodeHandle } from "./harness";

const NAME = "@test/roundtrip";
const ADDR = "0x1111111111111111111111111111111111111111" as HexString;
// 59-byte URI exercises the spilled-chunks (long-form) Solidity string layout.
const URI = "ipfs://bafy2bzaceblahblahQmExampleLongCidExercisingSpilledChunks";
const ZERO_ADDR = "0x0000000000000000000000000000000000000000";

let node: NodeHandle;
let chainClient: CdmChainClient;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let registry: any;

function lc(v: unknown): string {
    return String(v).toLowerCase();
}

beforeAll(async () => {
    node = await spawnReviveNode();
    const registryAddress = await deployRegistry(node.wsUrl);

    const signer = prepareSigner("Alice");
    chainClient = await createCdmAssetHubClient(node.wsUrl, "local");
    await chainClient.raw.assetHub.getChainSpecData();
    registry = await createContractFromClient(
        chainClient.raw.assetHub,
        chainClient.descriptors.assetHub,
        registryAddress,
        CONTRACTS_REGISTRY_ABI,
        { defaultSigner: signer, defaultOrigin: ALICE_SS58 },
    );
}, 180_000);

afterAll(async () => {
    chainClient?.destroy();
    await node?.kill();
});

describe("registry pre-publish (empty state)", () => {
    test("getVersionCount of an unregistered name returns 0", async () => {
        const r = await registry.getVersionCount.query(NAME);
        expect(r.success).toBe(true);
        expect(r.value).toBe(0);
    });

    test("getAddress of an unregistered name returns Address::ZERO", async () => {
        const r = await registry.getAddress.query(NAME);
        expect(r.success).toBe(true);
        expect(lc(r.value)).toBe(ZERO_ADDR);
    });

    test("getMetadataUri of an unregistered name returns empty string", async () => {
        const r = await registry.getMetadataUri.query(NAME);
        expect(r.success).toBe(true);
        expect(r.value).toBe("");
    });

    test("getContractCount is 0", async () => {
        const r = await registry.getContractCount.query();
        expect(r.value).toBe(0);
    });
});

describe("registry publishLatest + post-publish queries", () => {
    test("publishLatest tx finalizes", async () => {
        const r = await registry.publishLatest.tx(NAME, ADDR, URI);
        expect(r.ok).toBe(true);
    });

    test("getVersionCount is now 1", async () => {
        const r = await registry.getVersionCount.query(NAME);
        expect(r.value).toBe(1);
    });

    test("getAddress returns the published address", async () => {
        const r = await registry.getAddress.query(NAME);
        expect(lc(r.value)).toBe(lc(ADDR));
    });

    test("getMetadataUri returns the long-form URI (exercises spilled chunks)", async () => {
        const r = await registry.getMetadataUri.query(NAME);
        expect(r.value).toBe(URI);
    });

    test("getAddressAtVersion(0) matches the latest address", async () => {
        const r = await registry.getAddressAtVersion.query(NAME, 0);
        expect(lc(r.value)).toBe(lc(ADDR));
    });

    test("getMetadataUriAtVersion(0) matches the latest URI", async () => {
        const r = await registry.getMetadataUriAtVersion.query(NAME, 0);
        expect(r.value).toBe(URI);
    });

    test("getContractNameAt(0) returns the registered name", async () => {
        const r = await registry.getContractNameAt.query(0);
        expect(r.value).toBe(NAME);
    });

    test("getOwner returns a non-zero address (the signer's mapped EVM addr)", async () => {
        const r = await registry.getOwner.query(NAME);
        expect(typeof r.value).toBe("string");
        expect(lc(r.value)).not.toBe(ZERO_ADDR);
    });

    test("getContractCount is now 1", async () => {
        const r = await registry.getContractCount.query();
        expect(r.value).toBe(1);
    });
});

describe("registry searchContractNames (linear-scan prefix match)", () => {
    function unpackPage(value: unknown): { names: string[]; nextOffset: number; done: boolean } {
        if (Array.isArray(value)) {
            return {
                names: (value[0] as string[]) ?? [],
                nextOffset: Number(value[1] ?? 0),
                done: Boolean(value[2]),
            };
        }
        const v = value as { names?: string[]; next_offset?: number; done?: boolean };
        return {
            names: v.names ?? [],
            nextOffset: Number(v.next_offset ?? 0),
            done: Boolean(v.done),
        };
    }

    test("matching prefix returns the registered name with done=true", async () => {
        const r = await registry.searchContractNames.query("@test/", 0, 10);
        expect(r.success).toBe(true);
        const page = unpackPage(r.value);
        expect(page.names).toContain(NAME);
        expect(page.done).toBe(true);
    });

    test("non-matching prefix returns an empty page", async () => {
        const r = await registry.searchContractNames.query("@nonexistent/", 0, 10);
        const page = unpackPage(r.value);
        expect(page.names).toEqual([]);
    });
});
