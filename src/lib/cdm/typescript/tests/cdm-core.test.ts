// Drives `Cdm` through the real product-sdk ContractManager and
// createContractRuntimeFromClient, backed by a fake PolkadotClient built from
// product-sdk's in-memory testing runtime. Verifies the finalized semantics
// CDM keeps on top of product-sdk's best-block defaults.

import { describe, test, expect, vi } from "vitest";
import type { PolkadotClient } from "polkadot-api";
import type { CdmJson } from "@parity/cdm-builder";
import * as productSdk from "@parity/product-sdk-contracts";
import type { ReviveDryRunCall } from "@parity/product-sdk-contracts";
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
import * as browserEntry from "../src/browser";
import {
    ContractDryRunFailedError,
    ContractInvalidOriginError,
    ContractRevertedError,
    TxDispatchError,
} from "../src/index";
import type { AbiEntry } from "../src/types";

const LIBRARY = "@example/counter";
const ADDRESS = "0x00000000000000000000000000000000000000c0";
const BOB_SS58 = "5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty";
const CHARLIE_SS58 = "5FLSigC9HGRKVhB9FiEo4Y3koPsNmBmLJbpXg2mp1hXcS59Y";

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
    {
        type: "function",
        name: "increment",
        inputs: [],
        outputs: [],
        stateMutability: "nonpayable",
    },
    {
        type: "function",
        name: "named",
        inputs: [],
        outputs: [{ name: "count", type: "uint32" }],
        stateMutability: "view",
    },
    {
        type: "function",
        name: "pair",
        inputs: [],
        outputs: [
            { name: "", type: "uint32" },
            { name: "", type: "bool" },
        ],
        stateMutability: "view",
    },
    {
        type: "function",
        name: "echo",
        inputs: [{ name: "data", type: "bytes" }],
        outputs: [{ name: "", type: "bytes" }],
        stateMutability: "view",
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

        const tx = (cdm.getContract(LIBRARY as never) as any).setCount.tx(5);
        await expect(tx).rejects.toThrow(/Revive/);
        await expect(tx).rejects.toBeInstanceOf(TxDispatchError);
    });
});

describe("Cdm trailing undefined options", () => {
    test("query(undefined) and tx(..., undefined) mean no overrides", async () => {
        const { client, fake, built } = setup({ onQuery: () => undefined });
        const counter = new Cdm(CDM_JSON, { client }).getContract(LIBRARY as never) as any;

        await counter.getCount.query(undefined);
        await counter.increment.tx(undefined);
        await counter.setCount.tx(1, undefined);

        expect(fake.calls.map((c) => [c.functionName, c.args, c.origin])).toEqual([
            ["getCount", [], ALICE_SS58],
            ["increment", [], ALICE_SS58],
            ["setCount", [1], ALICE_SS58],
        ]);
        expect(built).toHaveLength(2);
    });
});

describe("Cdm origin follows the signer unless set explicitly", () => {
    const bob = prepareSigner("Bob");
    const alicePublicKey = prepareSigner("Alice").publicKey;
    /** A msg.sender-gated method: reverts unless Bob is the dry-run caller. */
    const onlyBob = (call: DecodedContractCall) =>
        call.origin === BOB_SS58 ? undefined : fakeDryRunResult({ revert: "only owner" });

    test("no signer or origin configured: Alice signs and is the origin", async () => {
        const { client, fake, submissions } = setup({ onQuery: () => undefined });
        const counter = new Cdm(CDM_JSON, { client }).getContract(LIBRARY as never) as any;

        await counter.getCount.query();
        await counter.setCount.tx(1);

        expect(fake.calls.map((c) => c.origin)).toEqual([ALICE_SS58, ALICE_SS58]);
        expect((submissions[0] as { publicKey: Uint8Array }).publicKey).toEqual(alicePublicKey);
    });

    test("a per-call signer is the dry-run origin (msg.sender-gated tx goes through)", async () => {
        const { client, fake, built, submissions } = setup({ onQuery: onlyBob });
        const counter = new Cdm(CDM_JSON, { client }).getContract(LIBRARY as never) as any;

        await counter.setCount.tx(5, { signer: bob });

        expect(fake.calls.map((c) => c.origin)).toEqual([BOB_SS58]);
        expect(built).toHaveLength(1);
        expect(submissions).toEqual([bob]);
    });

    test("defaultSigner without defaultOrigin drives query and tx origin", async () => {
        const { client, fake, submissions } = setup({ onQuery: onlyBob });
        const counter = new Cdm(CDM_JSON, { client, defaultSigner: bob }).getContract(
            LIBRARY as never,
        ) as any;

        await counter.getCount.query();
        await counter.setCount.tx(5);

        expect(fake.calls.map((c) => c.origin)).toEqual([BOB_SS58, BOB_SS58]);
        expect(submissions).toEqual([bob]);
    });

    test("setDefaults({ signer }) moves the origin to the new signer", async () => {
        const { client, fake, submissions } = setup({ onQuery: onlyBob });
        const cdm = new Cdm(CDM_JSON, { client });
        const counter = cdm.getContract(LIBRARY as never) as any;

        cdm.setDefaults({ signer: bob });
        await counter.getCount.query();
        await counter.setCount.tx(5);

        expect(fake.calls.map((c) => c.origin)).toEqual([BOB_SS58, BOB_SS58]);
        expect(submissions).toEqual([bob]);
    });

    test("an explicit defaultOrigin wins over a per-call signer", async () => {
        const { client, fake, submissions } = setup();
        const counter = new Cdm(CDM_JSON, { client, defaultOrigin: CHARLIE_SS58 }).getContract(
            LIBRARY as never,
        ) as any;

        await counter.getCount.query();
        await counter.setCount.tx(5, { signer: bob });

        expect(fake.calls.map((c) => c.origin)).toEqual([CHARLIE_SS58, CHARLIE_SS58]);
        expect(submissions).toEqual([bob]);
    });

    test("setDefaults({ signer }) keeps an origin set via setDefaults({ origin })", async () => {
        const { client, fake, submissions } = setup();
        const cdm = new Cdm(CDM_JSON, { client });
        const counter = cdm.getContract(LIBRARY as never) as any;

        cdm.setDefaults({ origin: CHARLIE_SS58 });
        cdm.setDefaults({ signer: bob });
        await counter.getCount.query();
        await counter.setCount.tx(5);
        await counter.setCount.tx(6, { origin: ALICE_SS58 });

        expect(fake.calls.map((c) => c.origin)).toEqual([CHARLIE_SS58, CHARLIE_SS58, ALICE_SS58]);
        expect(submissions).toEqual([bob, bob]);
    });
});

describe("Cdm result shapes", () => {
    // Locks the product-sdk/viem decoding the generated types describe:
    // a single output is the bare value even when named, several outputs are
    // an object keyed by name or `_<index>`, and `bytes` are hex strings.
    test("single named output is bare, unnamed outputs are keyed _<i>, bytes are hex", async () => {
        const { client } = setup({
            onQuery: ({ functionName, args }) => {
                if (functionName === "named") return 7;
                if (functionName === "pair") return [1, true];
                if (functionName === "echo") return args![0];
                return undefined;
            },
        });
        const counter = new Cdm(CDM_JSON, { client }).getContract(LIBRARY as never) as any;

        expect((await counter.named.query()).value).toBe(7);
        expect((await counter.pair.query()).value).toEqual({ _0: 1, _1: true });
        expect((await counter.echo.query("0xdeadbeef")).value).toBe("0xdeadbeef");
        // `bytes` inputs must be hex: viem cannot encode a Uint8Array.
        await expect(counter.echo.query(new Uint8Array([0xde, 0xad]))).rejects.toThrow(
            "hex_.replace is not a function",
        );
    });
});

describe("Cdm error re-exports", () => {
    test("index and browser entries re-export product-sdk's own error classes", () => {
        for (const name of [
            "ContractError",
            "ContractDryRunFailedError",
            "ContractInvalidOriginError",
            "ContractRevertedError",
            "ContractSignerMissingError",
        ] as const) {
            expect(browserEntry[name]).toBe(productSdk[name]);
        }
        expect(ContractRevertedError).toBe(productSdk.ContractRevertedError);
    });

    test("errors from .tx() and .query() are instanceof the re-exported classes", async () => {
        const reverted = setup({ onQuery: () => fakeDryRunResult({ revert: "nope" }) });
        const counter = new Cdm(CDM_JSON, { client: reverted.client }).getContract(
            LIBRARY as never,
        ) as any;
        const revertError = await counter.setCount.tx(5).catch((e: unknown) => e);
        expect(revertError).toBeInstanceOf(ContractRevertedError);
        expect(revertError).toBeInstanceOf(browserEntry.ContractError);

        const failed = setup({ onQuery: () => fakeDryRunResult({ failure: "OutOfGas" }) });
        await expect(
            (
                new Cdm(CDM_JSON, { client: failed.client }).getContract(LIBRARY as never) as any
            ).setCount.tx(5),
        ).rejects.toBeInstanceOf(ContractDryRunFailedError);

        await expect(counter.getCount.query({ origin: ADDRESS })).rejects.toBeInstanceOf(
            ContractInvalidOriginError,
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

    test("setDefaults reaches existing handles", async () => {
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

    test("setDefaults before first use applies to later handles", async () => {
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
