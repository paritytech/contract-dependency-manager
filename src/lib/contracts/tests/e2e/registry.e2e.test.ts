// End-to-end registry validation against a live `revive-dev-node`.
//
// The suite spawns a fresh node + deploys the registry once (`beforeAll`) —
// the harness shells out to `deploy-registry.ts`, which bootstraps the
// CREATE3 factory, deploys the implementation blob, deploys the EIP-1967
// proxy through the factory, and hands back the proxy address. All calls
// below go through the proxy with
// the implementation's ABI, via the same code path CDM's TS pipeline uses
// (`createContractFromClient` + the embedded `CONTRACTS_REGISTRY_ABI`).
// Each assertion is its own `test()` for granular failure attribution.
//
// Gated to the `e2e/` directory by `vitest.e2e.config.ts` so `pnpm test`
// (unit only) stays fast; run this suite via `pnpm test:e2e`.

import { describe, test, expect, beforeAll, afterAll } from "vitest";
import type { HexString } from "polkadot-api";
import { createCdmAssetHubClient, prepareSigner, type CdmAssetHubClient } from "@parity/cdm-env";
import { ALICE_SS58 } from "@parity/cdm-utils";
// Subpath `@parity/cdm-builder/abi` rather than the package root: vitest's
// Vite resolver tree-shakes the package's `dist/index.js` (re-exports +
// Node-only deps in adjacent modules) and CONTRACTS_REGISTRY_ABI comes back
// undefined. The dedicated subpath maps straight to `dist/abi.js`.
import { CONTRACTS_REGISTRY_ABI } from "@parity/cdm-builder/abi";
import { createContractFromClient } from "@parity/product-sdk-contracts";
import { spawnReviveNode, deployRegistry, type NodeHandle } from "./harness";

const NAME = "@test/roundtrip";
const ADDR = "0x1111111111111111111111111111111111111111" as HexString;
// 59-byte URI exercises the spilled-chunks (long-form) Solidity string layout.
const URI = "ipfs://bafy2bzaceblahblahQmExampleLongCidExercisingSpilledChunks";

let node: NodeHandle;
let chainClient: CdmAssetHubClient;
// The implementation blob's address — the proxy delegates every call to it.
let implAddress: string;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let registry: any;

function lc(v: unknown): string {
    return String(v).toLowerCase();
}

// Nullable lookups (getAddress, getMetadataUri, and the *AtVersion variants)
// return `(bool isSome, value)` output pairs that product-sdk decodes into an
// `{ isSome, value }` object keyed by the ABI's output names. Mirror the
// unwrap helper used by the CLI install pipeline and the frontend so tests
// assert against the inner value directly.
function unwrapOption<T>(val: unknown): { isSome: boolean; value: T | undefined } {
    if (val && typeof val === "object" && "isSome" in val) {
        const opt = val as { isSome: boolean; value: T };
        return { isSome: opt.isSome, value: opt.isSome ? opt.value : undefined };
    }
    return { isSome: false, value: undefined };
}

beforeAll(async () => {
    node = await spawnReviveNode();
    const deployed = await deployRegistry(node.wsUrl);
    implAddress = deployed.implAddress;

    const signer = prepareSigner("Alice");
    chainClient = await createCdmAssetHubClient(node.wsUrl, "local");
    await chainClient.raw.assetHub.getChainSpecData();
    registry = await createContractFromClient(
        chainClient.raw.assetHub,
        chainClient.descriptors.assetHub,
        deployed.address,
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

    test("isFrozen is false initially", async () => {
        const r = await registry.isFrozen.query();
        expect(r.success).toBe(true);
        expect(r.value).toBe(false);
    });

    test("getCode returns the implementation address", async () => {
        const r = await registry.getCode.query();
        expect(r.success).toBe(true);
        expect(lc(r.value)).toBe(lc(implAddress));
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

describe("registry freeze / unfreeze", () => {
    // The harness has a single funded signer (Alice), who is both the proxy
    // deployer (admin) and the publisher — so instead of asserting that a
    // non-admin publish reverts while frozen, assert the admin escape hatch:
    // freeze, publish as admin (still allowed), then unfreeze.
    test("freeze tx finalizes and isFrozen flips to true", async () => {
        const r = await registry.freeze.tx();
        expect(r.ok).toBe(true);

        const frozen = await registry.isFrozen.query();
        expect(frozen.value).toBe(true);
    });

    test("the admin can still publish while frozen", async () => {
        const FROZEN_NAME = "@test/frozen";
        const r = await registry.publishLatest.tx(FROZEN_NAME, ADDR, URI);
        expect(r.ok).toBe(true);

        const count = await registry.getVersionCount.query(FROZEN_NAME);
        expect(count.value).toBe(1);
    });

    test("unfreeze tx finalizes and isFrozen flips back to false", async () => {
        const r = await registry.unfreeze.tx();
        expect(r.ok).toBe(true);

        const frozen = await registry.isFrozen.query();
        expect(frozen.value).toBe(false);
    });
});

describe("registry upgrade + admin surface", () => {
    test("setCode to the current implementation succeeds and emits an event", async () => {
        const r = await registry.setCode.tx(implAddress);
        expect(r.ok).toBe(true);
        // The Upgraded event surfaces as a Revive.ContractEmitted record in
        // the raw event list; a shape-agnostic containment check keeps this
        // resilient to papi event envelope changes.
        const eventsJson = JSON.stringify(r.value.events, (_key, value) =>
            typeof value === "bigint" ? value.toString() : value,
        );
        expect(eventsJson).toContain("ContractEmitted");

        const code = await registry.getCode.query();
        expect(lc(code.value)).toBe(lc(implAddress));
    });

    test("transferName hands a name to a new owner and locks out the old one", async () => {
        const TRANSFER_NAME = "@test/transferred";
        const NEW_OWNER = "0x2222222222222222222222222222222222222222";

        const published = await registry.publishLatest.tx(TRANSFER_NAME, ADDR, URI);
        expect(published.ok).toBe(true);

        const transferred = await registry.transferName.tx(TRANSFER_NAME, NEW_OWNER);
        expect(transferred.ok).toBe(true);

        const owner = await registry.getOwner.query(TRANSFER_NAME);
        expect(lc(owner.value)).toBe(lc(NEW_OWNER));

        // The previous owner may no longer publish under the name.
        const republish = await registry.publishLatest.tx(TRANSFER_NAME, ADDR, URI);
        expect(republish.ok).toBe(false);
    });

    test("getAdmin/setAdmin round-trip (self-assignment)", async () => {
        const before = await registry.getAdmin.query();
        expect(before.success).toBe(true);
        const admin = String(before.value);
        expect(lc(admin)).not.toBe("0x0000000000000000000000000000000000000000");

        const r = await registry.setAdmin.tx(admin);
        expect(r.ok).toBe(true);

        const after = await registry.getAdmin.query();
        expect(lc(after.value)).toBe(lc(admin));
    });
});
