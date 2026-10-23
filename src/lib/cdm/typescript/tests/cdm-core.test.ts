// Drives `Cdm` through the real product-sdk ContractManager and
// createContractRuntimeFromClient, backed by a fake PolkadotClient built from
// product-sdk's in-memory testing runtime. Verifies the finalized semantics
// CDM keeps on top of product-sdk's best-block defaults.

import { describe, test, expect, vi } from "vitest";
import type { PolkadotClient } from "polkadot-api";
import type { CdmJson } from "@parity/cdm-builder";
import { ContractRevertedError, type ReviveDryRunCall } from "@parity/product-sdk-contracts";
import {
    createFakeContractRuntime,
    fakeDryRunResult,
    type BuiltContractCall,
    type DecodedContractCall,
} from "@parity/product-sdk-contracts/testing";
import { paseo_asset_hub } from "@parity/product-sdk-descriptors/paseo-asset-hub";
import { ALICE_SS58 } from "@parity/cdm-utils";
import { prepareSigner } from "@parity/cdm-env";
import { Cdm } from "../src/cdm-core";
import type { AbiEntry } from "../src/types";

const LIBRARY = "@example/counter";
const ADDRESS = "0x00000000000000000000000000000000000000c0";
const BOB_SS58 = "5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty";

const ABI: AbiEntry[] = [
    {
        type: "function",
        name: "getCount",
        inputs: [],
        outputs: [{ name: "", type: "uint32" }],
        stateMutability: "view",
    },
    {
        type: "function",
        name: "setCount",
        inputs: [{ name: "value", type: "uint32" }],
        outputs: [],
        stateMutability: "nonpayable",
    },
];

const CDM_JSON: CdmJson = {
    dependencies: { [LIBRARY]: 1 },
    contracts: { [LIBRARY]: { version: 1, address: ADDRESS, abi: ABI } },
};

const BEST_BLOCK = { hash: "0xbest", number: 10, index: 0 };
const FINALIZED_BLOCK = { hash: "0xfinalized", number: 10, index: 0 };

/** A papi submittable that reports inclusion in best block, then finalization. */
function fakeSubmittable(submissions: unknown[], finalizedOk = true) {
    return {
        createSubmitAndWatch(signer: unknown) {
            submissions.push(signer);
            return {
                subscribe(handlers: { next: (e: any) => void }) {
                    queueMicrotask(() => {
                        handlers.next({ type: "created", txHash: "0xtx" });
                        handlers.next({ type: "broadcasted", txHash: "0xtx" });
                        handlers.next({
                            type: "inBestBlock",
                            txHash: "0xtx",
                            ok: true,
                            events: [],
                            block: BEST_BLOCK,
                        });
                        handlers.next({
                            type: "finalized",
                            txHash: "0xtx",
                            ok: finalizedOk,
                            events: [{ type: "Revive" }],
                            block: FINALIZED_BLOCK,
                            ...(finalizedOk
                                ? {}
                                : { dispatchError: { type: "Module", value: { type: "Revive" } } }),
                        });
                    });
                    return { unsubscribe() {} };
                },
            };
        },
    };
}

function setup(options?: {
    onQuery?: (call: DecodedContractCall) => unknown;
    finalizedOk?: boolean;
}) {
    const fake = createFakeContractRuntime({ abi: ABI, onQuery: options?.onQuery });
    const dryRunAt: unknown[] = [];
    const built: BuiltContractCall[] = [];
    const submissions: unknown[] = [];
    const descriptors: unknown[] = [];

    const dryRun: ReviveDryRunCall = (...args) => {
        dryRunAt.push(args[6]?.at);
        return fake.dryRunCall(...args);
    };

    const client = {
        getTypedApi(descriptor: unknown) {
            descriptors.push(descriptor);
            return {
                ...fake.api,
                tx: {
                    Revive: {
                        call: (call: BuiltContractCall) => {
                            built.push(call);
                            return fakeSubmittable(submissions, options?.finalizedOk ?? true);
                        },
                        map_account: () => fakeSubmittable(submissions),
                    },
                },
            };
        },
        getUnsafeApi: () => ({ apis: { ReviveApi: { call: dryRun } } }),
        destroy: vi.fn(),
    } as unknown as PolkadotClient;

    return { fake, client, dryRunAt, built, submissions, descriptors };
}

describe("Cdm query", () => {
    test("decodes the result and dry-runs at finalized", async () => {
        const { client, dryRunAt, fake } = setup({ onQuery: () => 7 });
        const cdm = new Cdm(CDM_JSON, { client });

        const result = await (cdm.getContract(LIBRARY as never) as any).getCount.query();

        expect(result).toEqual({
            success: true,
            value: 7,
            gasRequired: { ref_time: 1n, proof_size: 1n },
        });
        expect(dryRunAt).toEqual(["finalized"]);
        expect(fake.calls[0]).toMatchObject({ origin: ALICE_SS58, dest: ADDRESS });
    });

    test("surfaces a revert as success: false with the decoded payload on `error`", async () => {
        const { client } = setup({ onQuery: () => fakeDryRunResult({ revert: "nope" }) });
        const cdm = new Cdm(CDM_JSON, { client });

        const result = await (cdm.getContract(LIBRARY as never) as any).getCount.query();

        expect(result.success).toBe(false);
        expect(result.value).toBeUndefined();
        expect(result.error).toMatchObject({ type: "ContractRevertedWithPayload", reason: "nope" });
    });
});

describe("Cdm tx", () => {
    test("sizes at finalized and resolves at the finalized block", async () => {
        const { client, dryRunAt, built, submissions } = setup();
        const signer = prepareSigner("Alice");
        const cdm = new Cdm(CDM_JSON, { client, defaultSigner: signer });

        const result = await (cdm.getContract(LIBRARY as never) as any).setCount.tx(5);

        expect(dryRunAt).toEqual(["finalized"]);
        expect(built).toHaveLength(1);
        expect(submissions).toEqual([signer]);
        expect(result).toEqual({
            txHash: "0xtx",
            blockHash: FINALIZED_BLOCK.hash,
            ok: true,
            events: [{ type: "Revive" }],
        });
    });

    test("passes snake_case gasLimit through as the extrinsic weight_limit", async () => {
        const { client, dryRunAt, built } = setup();
        const cdm = new Cdm(CDM_JSON, { client });
        const gasLimit = { ref_time: 123n, proof_size: 456n };

        await (cdm.getContract(LIBRARY as never) as any).setCount.tx(5, {
            gasLimit,
            storageDepositLimit: 9n,
            value: 2n,
        });

        // Both limits given -> no sizing dry-run.
        expect(dryRunAt).toEqual([]);
        expect(built[0]).toMatchObject({
            dest: ADDRESS,
            value: 2n,
            weight_limit: gasLimit,
            storage_deposit_limit: 9n,
        });
    });

    test("throws when the pre-submit dry-run reverts", async () => {
        const { client, built } = setup({
            onQuery: () => fakeDryRunResult({ revert: "not allowed" }),
        });
        const cdm = new Cdm(CDM_JSON, { client });

        await expect(
            (cdm.getContract(LIBRARY as never) as any).setCount.tx(5),
        ).rejects.toBeInstanceOf(ContractRevertedError);
        expect(built).toEqual([]);
    });

    test("throws when the extrinsic fails to dispatch", async () => {
        const { client } = setup({ finalizedOk: false });
        const cdm = new Cdm(CDM_JSON, { client });

        await expect((cdm.getContract(LIBRARY as never) as any).setCount.tx(5)).rejects.toThrow(
            /Revive/,
        );
    });
});

describe("Cdm lifecycle", () => {
    test("uses paseo_asset_hub by default and honours options.descriptor", () => {
        const a = setup();
        new Cdm(CDM_JSON, { client: a.client }).getContract(LIBRARY as never);
        expect(a.descriptors).toEqual([paseo_asset_hub]);

        const b = setup();
        const custom = { ...paseo_asset_hub };
        new Cdm(CDM_JSON, { client: b.client, descriptor: custom }).getContract(LIBRARY as never);
        expect(b.descriptors[0]).toBe(custom);
    });

    test("creates the manager lazily and once", () => {
        const { client, descriptors } = setup();
        const cdm = new Cdm(CDM_JSON, { client });
        expect(descriptors).toHaveLength(0);

        cdm.getContract(LIBRARY as never);
        cdm.getContract(LIBRARY as never);
        expect(descriptors).toHaveLength(1);
    });

    test("setDefaults forwards to an existing manager", async () => {
        const { client, fake, submissions } = setup();
        const cdm = new Cdm(CDM_JSON, { client });
        const counter = cdm.getContract(LIBRARY as never) as any;

        const bob = prepareSigner("Bob");
        cdm.setDefaults({ origin: BOB_SS58, signer: bob });
        await counter.getCount.query();
        await counter.setCount.tx(1);

        expect(fake.calls.map((c) => c.origin)).toEqual([BOB_SS58, BOB_SS58]);
        expect(submissions).toEqual([bob]);
    });

    test("setDefaults before first use seeds the manager", async () => {
        const { client, fake } = setup();
        const cdm = new Cdm(CDM_JSON, { client });
        cdm.setDefaults({ origin: BOB_SS58 });

        await (cdm.getContract(LIBRARY as never) as any).getCount.query();

        expect(fake.calls[0].origin).toBe(BOB_SS58);
    });

    test("destroy() drops the manager; a borrowed client is not destroyed", () => {
        const { client, descriptors } = setup();
        const cdm = new Cdm(CDM_JSON, { client });
        cdm.getContract(LIBRARY as never);

        cdm.destroy();
        cdm.getContract(LIBRARY as never);

        expect(descriptors).toHaveLength(2);
        expect(client.destroy).not.toHaveBeenCalled();
    });

    test("getAddress works without a client; getContract needs one", () => {
        const cdm = new Cdm(CDM_JSON);
        expect(cdm.getAddress(LIBRARY)).toBe(ADDRESS);
        expect(() => cdm.getContract(LIBRARY as never)).toThrow("No client configured");
    });

    test("unknown libraries throw before touching the client", () => {
        const { client, descriptors } = setup();
        const cdm = new Cdm(CDM_JSON, { client });
        expect(() => cdm.getContract("@example/missing" as never)).toThrow(
            'Contract "@example/missing" not found in cdm.json contracts',
        );
        expect(() => cdm.getAddress("@example/missing")).toThrow(/not found/);
        expect(descriptors).toHaveLength(0);
    });
});
