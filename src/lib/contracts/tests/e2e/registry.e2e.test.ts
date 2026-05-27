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

let node: NodeHandle;
let chainClient: CdmChainClient;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let registry: any;

function lc(v: unknown): string {
    return String(v).toLowerCase();
}

// The reverted registry returns option-shaped tuples `{ isSome, value }`
// for nullable lookups (getAddress, getMetadataUri, and the *AtVersion
// variants). Mirror the unwrap helper used by the CLI install pipeline and
// the frontend so tests assert against the inner value directly.
function unwrapOption<T>(val: unknown): { isSome: boolean; value: T | undefined } {
    if (val && typeof val === "object" && "isSome" in val) {
        const opt = val as { isSome: boolean; value: T };
        return { isSome: opt.isSome, value: opt.isSome ? opt.value : undefined };
    }
    return { isSome: false, value: undefined };
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

    test("getAddress of an unregistered name returns None", async () => {
        const r = await registry.getAddress.query(NAME);
        expect(r.success).toBe(true);
        expect(unwrapOption(r.value).isSome).toBe(false);
    });

    test("getMetadataUri of an unregistered name returns None", async () => {
        const r = await registry.getMetadataUri.query(NAME);
        expect(r.success).toBe(true);
        expect(unwrapOption(r.value).isSome).toBe(false);
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
        const opt = unwrapOption<string>(r.value);
        expect(opt.isSome).toBe(true);
        expect(lc(opt.value)).toBe(lc(ADDR));
    });

    test("getMetadataUri returns the long-form URI (exercises spilled chunks)", async () => {
        const r = await registry.getMetadataUri.query(NAME);
        const opt = unwrapOption<string>(r.value);
        expect(opt.isSome).toBe(true);
        expect(opt.value).toBe(URI);
    });

    test("getAddressAtVersion(0) matches the latest address", async () => {
        const r = await registry.getAddressAtVersion.query(NAME, 0);
        const opt = unwrapOption<string>(r.value);
        expect(opt.isSome).toBe(true);
        expect(lc(opt.value)).toBe(lc(ADDR));
    });

    test("getMetadataUriAtVersion(0) matches the latest URI", async () => {
        const r = await registry.getMetadataUriAtVersion.query(NAME, 0);
        const opt = unwrapOption<string>(r.value);
        expect(opt.isSome).toBe(true);
        expect(opt.value).toBe(URI);
    });

    test("getContractNameAt(0) returns the registered name", async () => {
        const r = await registry.getContractNameAt.query(0);
        expect(r.value).toBe(NAME);
    });

    test("getOwner returns a non-zero address (the signer's mapped EVM addr)", async () => {
        const ZERO_ADDR = "0x0000000000000000000000000000000000000000";
        const r = await registry.getOwner.query(NAME);
        expect(typeof r.value).toBe("string");
        expect(lc(r.value)).not.toBe(ZERO_ADDR);
    });

    test("getContractCount is now 1", async () => {
        const r = await registry.getContractCount.query();
        expect(r.value).toBe(1);
    });

    test("getContracts returns latest package details in one page", async () => {
        const r = await registry.getContracts.query(0, 10);
        expect(r.success).toBe(true);

        const value = r.value;
        const entries = Array.isArray(value)
            ? value[1]
            : (value as { entries?: unknown } | undefined)?.entries;
        expect(Array.isArray(entries)).toBe(true);

        const entry = (entries as unknown[]).find((candidate) => {
            if (Array.isArray(candidate)) return candidate[0] === NAME;
            return (candidate as { name?: unknown }).name === NAME;
        });
        expect(entry).toBeDefined();

        if (Array.isArray(entry)) {
            expect(entry[1]).toBe(0);
            expect(lc(entry[2])).toBe(lc(ADDR));
            expect(entry[3]).toBe(URI);
        } else {
            const row = entry as {
                version?: unknown;
                address?: unknown;
                metadata_uri?: unknown;
                metadataUri?: unknown;
            };
            expect(Number(row.version)).toBe(0);
            expect(lc(row.address)).toBe(lc(ADDR));
            expect(row.metadata_uri ?? row.metadataUri).toBe(URI);
        }
    });
});

// On-chain prefix search backed by the registry's `OrderedIndex`. The page
// shape is `(names, next_offset, done)`; ink decodes the tuple either as an
// array or as a struct depending on codegen, so the harness normalizes both.
describe("registry searchContractNames", () => {
    function parsePage(value: unknown): { names: string[]; nextOffset: number; done: boolean } {
        if (Array.isArray(value)) {
            return {
                names: Array.isArray(value[0]) ? (value[0] as string[]) : [],
                nextOffset: Number(value[1] ?? 0),
                done: Boolean(value[2]),
            };
        }
        const page = (value ?? {}) as {
            names?: unknown;
            next_offset?: unknown;
            nextOffset?: unknown;
            done?: unknown;
        };
        return {
            names: Array.isArray(page.names) ? (page.names as string[]) : [],
            nextOffset: Number(page.next_offset ?? page.nextOffset ?? 0),
            done: Boolean(page.done),
        };
    }

    test("matching prefix returns the registered name", async () => {
        const r = await registry.searchContractNames.query("@test/", 0, 10);
        expect(r.success).toBe(true);
        const page = parsePage(r.value);
        expect(page.names).toContain(NAME);
    });

    test("non-matching prefix returns an empty page", async () => {
        const r = await registry.searchContractNames.query("@nonexistent/", 0, 10);
        expect(r.success).toBe(true);
        const page = parsePage(r.value);
        expect(page.names).toEqual([]);
        expect(page.done).toBe(true);
    });
});
