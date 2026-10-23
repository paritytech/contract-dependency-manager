import { describe, test, expect, vi } from "vitest";
import type { Contract, ContractDef } from "@parity/product-sdk-contracts";
import { prepareSigner } from "@parity/cdm-env";
import { wrapContract } from "../src/wrap";
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

        expect(query).toHaveBeenCalledWith(1, 2, {});
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

        expect(query).toHaveBeenCalledWith(point, {});
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
});

describe("wrapContract tx", () => {
    test("always waits for finalized", async () => {
        const { handle, tx } = mockHandle();

        await wrapContract(handle, ABI).add.tx(1, 2);

        expect(tx).toHaveBeenCalledWith(1, 2, { waitFor: "finalized" });
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
