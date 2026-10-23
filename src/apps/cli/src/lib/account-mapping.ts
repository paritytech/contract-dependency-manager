import { prepareSigner, ss58Address, type CdmSigner } from "@parity/cdm-env";
import { ensureContractAccountMapped, type ContractRuntime } from "@parity/product-sdk-contracts";

export type MapAccountOutcome = "mapped" | "already-mapped";

/**
 * Inclusion timeout for the mapping extrinsic — matches the product-sdk-tx
 * `submitAndWatch` default the deploy pipeline uses, instead of
 * `ensureContractAccountMapped`'s tighter 60s default.
 */
const MAP_ACCOUNT_TIMEOUT_MS = 300_000;

function isAccountAlreadyMappedError(dispatchError: unknown): boolean {
    if (!dispatchError || typeof dispatchError !== "object") return false;
    const moduleError = dispatchError as { type?: unknown; value?: unknown };
    if (moduleError.type !== "Module") return false;
    const pallet = moduleError.value as { type?: unknown; value?: unknown } | undefined;
    if (!pallet || pallet.type !== "Revive") return false;
    const error = pallet.value as { type?: unknown } | undefined;
    return error?.type === "AccountAlreadyMapped";
}

/** Join an error's message with the messages of its `cause` chain. */
function describeError(error: unknown): string {
    const messages: string[] = [];
    for (let e: unknown = error; e !== undefined && messages.length < 5; ) {
        if (!(e instanceof Error)) {
            messages.push(String(e));
            break;
        }
        if (!messages.includes(e.message)) messages.push(e.message);
        e = e.cause;
    }
    return messages.join(": ");
}

/**
 * Ensure the signer's account is mapped on `pallet-revive`, via product-sdk's
 * `ensureContractAccountMapped`: an existing `Revive.OriginalAccount` mapping
 * short-circuits to "already-mapped" without submitting anything; otherwise
 * `Revive.map_account` is submitted and awaited to best-block inclusion.
 *
 * A pallet `AccountAlreadyMapped` dispatch error (the account got mapped
 * between the check and the submission) also counts as "already mapped".
 * Every other failure — failed mapping check, failed dispatch (e.g.
 * insufficient funds), or a rejected submission (network drop, invalid tx) —
 * is thrown instead of being misreported as an existing mapping.
 */
export async function ensureAccountMapped(
    runtime: ContractRuntime,
    signer: CdmSigner,
): Promise<MapAccountOutcome> {
    const result = await ensureContractAccountMapped(
        runtime,
        ss58Address(signer.publicKey),
        signer,
        { timeoutMs: MAP_ACCOUNT_TIMEOUT_MS },
    );
    if (result.ok) return result.value === null ? "already-mapped" : "mapped";
    const { error } = result;
    if ("dispatchError" in error && isAccountAlreadyMappedError(error.dispatchError)) {
        return "already-mapped";
    }
    throw new Error(`Revive.map_account failed: ${describeError(error)}`, { cause: error });
}

if (import.meta.vitest) {
    const { describe, expect, test, vi } = import.meta.vitest;

    type TxEvent = { type: string } & Record<string, unknown>;
    type Submission = { events: TxEvent[] } | { error: Error };

    /**
     * Fake `ContractRuntime` exposing just what `ensureContractAccountMapped`
     * touches: the `Revive.OriginalAccount` lookup and `map_account()`'s
     * `createSubmitAndWatch` event stream.
     */
    function runtimeWith(opts: { mapped?: boolean | Error; submission?: Submission }) {
        const getValue = vi.fn(async (_h160: string) => {
            if (opts.mapped instanceof Error) throw opts.mapped;
            return opts.mapped ? "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY" : undefined;
        });
        const createSubmitAndWatch = vi.fn((_signer: CdmSigner, _options?: unknown) => ({
            subscribe(handlers: { next: (e: TxEvent) => void; error: (e: Error) => void }) {
                queueMicrotask(() => {
                    const submission = opts.submission;
                    if (!submission) handlers.error(new Error("unexpected map_account submission"));
                    else if ("error" in submission) handlers.error(submission.error);
                    else submission.events.forEach((event) => handlers.next(event));
                });
                return { unsubscribe: () => {} };
            },
        }));
        const runtime = {
            api: {
                query: { Revive: { OriginalAccount: { getValue } } },
                tx: { Revive: { map_account: () => ({ createSubmitAndWatch }) } },
            },
            dryRunCall: vi.fn(),
        } as unknown as ContractRuntime;
        return { runtime, getValue, createSubmitAndWatch };
    }

    const block = { hash: "0x01", number: 1, index: 0 };
    const included = (extra: Record<string, unknown>): Submission => ({
        events: [
            { type: "created", txHash: "0xaa" },
            { type: "broadcasted", txHash: "0xaa" },
            { type: "inBestBlock", txHash: "0xaa", block, events: [], ...extra },
        ],
    });

    describe("ensureAccountMapped", () => {
        test("reports an existing mapping as already mapped without submitting", async () => {
            const { runtime, createSubmitAndWatch } = runtimeWith({ mapped: true });
            await expect(ensureAccountMapped(runtime, prepareSigner("Alice"))).resolves.toBe(
                "already-mapped",
            );
            expect(createSubmitAndWatch).not.toHaveBeenCalled();
        });

        test("checks the mapping of the signer's own account", async () => {
            const { runtime, getValue } = runtimeWith({ mapped: true });
            await ensureAccountMapped(runtime, prepareSigner("Alice"));
            // //Alice's pallet-revive H160: keccak256(publicKey)[12..]
            expect(getValue).toHaveBeenCalledWith("0x9621dde636de098b43efb0fa9b61facfe328f99d");
        });

        test("reports a successful submission as mapped", async () => {
            const { runtime, createSubmitAndWatch } = runtimeWith({
                submission: included({ ok: true }),
            });
            const signer = prepareSigner("Alice");
            await expect(ensureAccountMapped(runtime, signer)).resolves.toBe("mapped");
            expect(createSubmitAndWatch).toHaveBeenCalledWith(signer, expect.anything());
        });

        test("treats only the AccountAlreadyMapped dispatch error as already mapped", async () => {
            const { runtime } = runtimeWith({
                submission: included({
                    ok: false,
                    dispatchError: {
                        type: "Module",
                        value: { type: "Revive", value: { type: "AccountAlreadyMapped" } },
                    },
                }),
            });
            await expect(ensureAccountMapped(runtime, prepareSigner("Alice"))).resolves.toBe(
                "already-mapped",
            );
        });

        test("surfaces other dispatch errors instead of reporting already mapped", async () => {
            const { runtime } = runtimeWith({
                submission: included({
                    ok: false,
                    dispatchError: {
                        type: "Module",
                        value: { type: "Balances", value: { type: "InsufficientBalance" } },
                    },
                }),
            });
            await expect(ensureAccountMapped(runtime, prepareSigner("Alice"))).rejects.toThrow(
                /Revive\.map_account failed.*InsufficientBalance/s,
            );
        });

        test("propagates submission failures such as network errors", async () => {
            const { runtime } = runtimeWith({
                submission: { error: new Error("WebSocket connection lost") },
            });
            await expect(ensureAccountMapped(runtime, prepareSigner("Alice"))).rejects.toThrow(
                "WebSocket connection lost",
            );
        });

        test("surfaces a failed mapping check with its underlying cause", async () => {
            const { runtime, createSubmitAndWatch } = runtimeWith({
                mapped: new Error("storage query timed out"),
            });
            await expect(ensureAccountMapped(runtime, prepareSigner("Alice"))).rejects.toThrow(
                /Failed to check mapping status.*storage query timed out/s,
            );
            expect(createSubmitAndWatch).not.toHaveBeenCalled();
        });
    });
}
