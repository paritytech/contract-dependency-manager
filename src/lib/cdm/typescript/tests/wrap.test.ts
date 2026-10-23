import { describe, test, expect, vi } from "vitest";
import type { Contract, ContractDef } from "@parity/product-sdk-contracts";
import { ALICE_SS58 } from "@parity/cdm-utils";
import { prepareSigner } from "@parity/cdm-env";
import { wrapContract as wrap, type CallDefaults } from "../src/wrap";
import type { AbiEntry } from "../src/types";

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
        name: "add",
        inputs: [
            { name: "a", type: "uint32" },
            { name: "b", type: "uint32" },
        ],
        outputs: [{ name: "", type: "uint32" }],
        stateMutability: "nonpayable",
    },
    {
        type: "function",
        name: "setPoint",
        inputs: [
            {
                name: "p",
                type: "tuple",
                components: [
                    { name: "x", type: "uint32" },
                    { name: "y", type: "uint32" },
                ],
            },
        ],
        outputs: [],
        stateMutability: "nonpayable",
    },
    { type: "event", name: "Changed", inputs: [] },
];

const WEIGHT = { ref_time: 11n, proof_size: 22n };
const BOB_SS58 = "5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty";
const CHARLIE_SS58 = "5FLSigC9HGRKVhB9FiEo4Y3koPsNmBmLJbpXg2mp1hXcS59Y";
const ALICE = prepareSigner("Alice");
const BOB = prepareSigner("Bob");

/** Wrap with Cdm's no-config defaults (Alice signer, no explicit origin) unless given. */
function wrapContract(
    handle: Contract<ContractDef>,
    abi: AbiEntry[],
    defaults: CallDefaults = { signer: ALICE },
) {
    return wrap(handle, abi, () => defaults);
}

const TX_OK = {
    ok: true as const,
    value: {
        txHash: "0xtx",
        ok: true,
        block: { hash: "0xblock", number: 7, index: 1 },
        events: [{ type: "Revive" }],
    },
};

function mockHandle(overrides?: { query?: unknown; tx?: unknown }) {
    const query = vi.fn(
        async (..._args: unknown[]) =>
            overrides?.query ?? { success: true, value: 42, gasRequired: WEIGHT },
    );
    const tx = vi.fn(async (..._args: unknown[]) => overrides?.tx ?? TX_OK);
    const handle = new Proxy(
        {},
        {
            get: (_, name) => (typeof name === "string" ? { query, tx } : undefined),
        },
    ) as unknown as Contract<ContractDef>;
    return { handle, query, tx };
}

describe("wrapContract query", () => {
    test("forwards positional args with an empty trailing options object", async () => {
        const { handle, query } = mockHandle();
        const wrapped = wrapContract(handle, ABI);

        const result = await wrapped.add.query(1, 2);

        expect(query).toHaveBeenCalledWith(1, 2, { origin: ALICE_SS58 });
        expect(result).toEqual({ success: true, value: 42, gasRequired: WEIGHT });
    });

    test("maps { origin, value } overrides onto QueryOptions", async () => {
        const { handle, query } = mockHandle();
        const wrapped = wrapContract(handle, ABI);

        await wrapped.getCount.query({ origin: BOB_SS58, value: 5n });

        expect(query).toHaveBeenCalledWith({ origin: BOB_SS58, value: 5n });
    });

    test("does not pin `at` per call (finalized comes from the runtime)", async () => {
        const { handle, query } = mockHandle();
        await wrapContract(handle, ABI).getCount.query();
        const opts = query.mock.calls[0].at(-1) as Record<string, unknown>;
        expect(opts).not.toHaveProperty("at");
    });

    test("treats a trailing struct within the method's arity as a positional arg", async () => {
        const { handle, query } = mockHandle();
        const point = { x: 1, y: 2 };

        await wrapContract(handle, ABI).setPoint.query(point);

        expect(query).toHaveBeenCalledWith(point, { origin: ALICE_SS58 });
    });

    test("failure: value is undefined and the payload is surfaced on `error`", async () => {
        const dispatchError = { type: "Module", value: { type: "Revive" } };
        const { handle } = mockHandle({
            query: { success: false, value: dispatchError, gasRequired: WEIGHT },
        });

        const result = await wrapContract(handle, ABI).getCount.query();

        expect(result).toEqual({
            success: false,
            value: undefined,
            gasRequired: WEIGHT,
            error: dispatchError,
        });
    });

    test("rejects a wrong argument count instead of misreading options as an arg", async () => {
        const { handle, query } = mockHandle();
        await expect(wrapContract(handle, ABI).add.query(1)).rejects.toThrow(
            "add expects 2 argument(s), got 1",
        );
        expect(query).not.toHaveBeenCalled();
    });

    test("treats a trailing `undefined` options argument as no overrides", async () => {
        const { handle, query } = mockHandle();
        const wrapped = wrapContract(handle, ABI);
        const point = { x: 1, y: 2 };

        await wrapped.getCount.query(undefined);
        await wrapped.add.query(1, 2, undefined);
        await wrapped.setPoint.query(point, undefined);

        expect(query.mock.calls).toEqual([
            [{ origin: ALICE_SS58 }],
            [1, 2, { origin: ALICE_SS58 }],
            [point, { origin: ALICE_SS58 }],
        ]);
    });

    test("only strips `undefined` from the options slot; other counts still throw", async () => {
        const { handle, query } = mockHandle();
        const wrapped = wrapContract(handle, ABI);

        await expect(wrapped.getCount.query(undefined, undefined)).rejects.toThrow(
            "getCount expects 0 argument(s), got 2",
        );
        await expect(wrapped.add.query(undefined)).rejects.toThrow(
            "add expects 2 argument(s), got 1",
        );
        expect(query).not.toHaveBeenCalled();
    });
});

describe("wrapContract origin resolution", () => {
    const originOf = (mock: ReturnType<typeof vi.fn>) =>
        (mock.mock.calls[0].at(-1) as { origin?: string }).origin;

    test("query: per-call origin > explicit default origin > default signer's account", async () => {
        const perCall = mockHandle();
        await wrapContract(perCall.handle, ABI, {
            signer: BOB,
            origin: CHARLIE_SS58,
        }).getCount.query({ origin: ALICE_SS58 });
        expect(originOf(perCall.query)).toBe(ALICE_SS58);

        const explicit = mockHandle();
        await wrapContract(explicit.handle, ABI, {
            signer: BOB,
            origin: CHARLIE_SS58,
        }).getCount.query();
        expect(originOf(explicit.query)).toBe(CHARLIE_SS58);

        const derived = mockHandle();
        await wrapContract(derived.handle, ABI, { signer: BOB }).getCount.query();
        expect(originOf(derived.query)).toBe(BOB_SS58);
    });

    test("tx: the origin follows a per-call signer unless an origin is explicit", async () => {
        const derived = mockHandle();
        await wrapContract(derived.handle, ABI).getCount.tx({ signer: BOB });
        expect(derived.tx).toHaveBeenCalledWith({
            waitFor: "finalized",
            signer: BOB,
            origin: BOB_SS58,
        });

        const explicitDefault = mockHandle();
        await wrapContract(explicitDefault.handle, ABI, {
            signer: ALICE,
            origin: CHARLIE_SS58,
        }).getCount.tx({ signer: BOB });
        expect(originOf(explicitDefault.tx)).toBe(CHARLIE_SS58);

        const perCall = mockHandle();
        await wrapContract(perCall.handle, ABI, {
            signer: ALICE,
            origin: CHARLIE_SS58,
        }).getCount.tx({
            signer: BOB,
            origin: ALICE_SS58,
        });
        expect(originOf(perCall.tx)).toBe(ALICE_SS58);
    });

    test("reads the defaults at call time", async () => {
        const { handle, query, tx } = mockHandle();
        const defaults: CallDefaults = { signer: ALICE };
        const wrapped = wrap(handle, ABI, () => defaults);

        defaults.signer = BOB;
        await wrapped.getCount.query();
        await wrapped.getCount.tx();

        expect(originOf(query)).toBe(BOB_SS58);
        expect(tx.mock.calls[0][0]).toMatchObject({ signer: BOB, origin: BOB_SS58 });
    });
});

describe("wrapContract tx", () => {
    test("always waits for finalized", async () => {
        const { handle, tx } = mockHandle();

        await wrapContract(handle, ABI).add.tx(1, 2);

        expect(tx).toHaveBeenCalledWith(1, 2, {
            waitFor: "finalized",
            signer: ALICE,
            origin: ALICE_SS58,
        });
    });

    test("maps every override onto TxOptions; gasLimit Weight passes through unchanged", async () => {
        const { handle, tx } = mockHandle();
        const signer = prepareSigner("Bob");
        const gasLimit = { ref_time: 1_000n, proof_size: 2_000n };

        await wrapContract(handle, ABI).add.tx(1, 2, {
            signer,
            origin: BOB_SS58,
            value: 3n,
            gasLimit,
            storageDepositLimit: 4n,
        });

        expect(tx).toHaveBeenCalledTimes(1);
        const opts = tx.mock.calls[0][2] as Record<string, unknown>;
        expect(opts).toEqual({
            waitFor: "finalized",
            signer,
            origin: BOB_SS58,
            value: 3n,
            gasLimit,
            storageDepositLimit: 4n,
        });
        expect(opts.gasLimit).toBe(gasLimit);
    });

    test("treats a trailing `undefined` options argument as no overrides", async () => {
        const { handle, tx } = mockHandle();
        const wrapped = wrapContract(handle, ABI);
        const defaults = { waitFor: "finalized", signer: ALICE, origin: ALICE_SS58 };

        await wrapped.getCount.tx(undefined);
        await wrapped.add.tx(1, 2, undefined);

        expect(tx.mock.calls).toEqual([[defaults], [1, 2, defaults]]);
        await expect(wrapped.add.tx(1, undefined, undefined, undefined)).rejects.toThrow(
            "add expects 2 argument(s), got 4",
        );
    });

    test("maps the product-sdk TxResult onto CDM's TxResult", async () => {
        const { handle } = mockHandle();

        const result = await wrapContract(handle, ABI).add.tx(1, 2);

        expect(result).toEqual({
            txHash: "0xtx",
            blockHash: "0xblock",
            ok: true,
            events: [{ type: "Revive" }],
        });
    });

    test("throws the `err` channel's error", async () => {
        const error = new Error("Contract reverted");
        const { handle } = mockHandle({ tx: { ok: false, error } });

        await expect(wrapContract(handle, ABI).add.tx(1, 2)).rejects.toBe(error);
    });
});

describe("wrapContract proxy", () => {
    test("exposes only ABI functions", () => {
        const { handle } = mockHandle();
        const wrapped = wrapContract(handle, ABI) as Record<string, unknown>;

        expect(wrapped.getCount).toBeDefined();
        expect(wrapped.Changed).toBeUndefined();
        expect(wrapped.missing).toBeUndefined();
        expect((wrapped as any)[Symbol.iterator]).toBeUndefined();
    });
});
