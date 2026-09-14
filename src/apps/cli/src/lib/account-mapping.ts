import type { PolkadotSigner } from "polkadot-api";
import { stringifyBigInt } from "@parity/cdm-utils";

export type MapAccountOutcome = "mapped" | "already-mapped";

/**
 * Minimal structural view of the Asset Hub typed API needed to submit
 * `Revive.map_account`. Both `CdmAssetHubClient` and `CdmChainClient`
 * `assetHub` APIs satisfy it.
 */
export interface ReviveMapAccountApi {
    tx: {
        Revive: {
            map_account: () => {
                signAndSubmit: (
                    signer: PolkadotSigner,
                ) => Promise<{ ok: boolean; dispatchError?: { type: string; value: unknown } }>;
            };
        };
    };
}

function isAccountAlreadyMappedError(dispatchError: unknown): boolean {
    if (!dispatchError || typeof dispatchError !== "object") return false;
    const moduleError = dispatchError as { type?: unknown; value?: unknown };
    if (moduleError.type !== "Module") return false;
    const pallet = moduleError.value as { type?: unknown; value?: unknown } | undefined;
    if (!pallet || pallet.type !== "Revive") return false;
    const error = pallet.value as { type?: unknown } | undefined;
    return error?.type === "AccountAlreadyMapped";
}

/**
 * Submit `Revive.map_account`, treating only the pallet's
 * `AccountAlreadyMapped` dispatch error as "already mapped". Every other
 * failure — failed dispatch (e.g. insufficient funds) or a rejected
 * submission (network drop, invalid tx) — is surfaced as a thrown error
 * instead of being misreported as an existing mapping.
 */
export async function ensureAccountMapped(
    api: ReviveMapAccountApi,
    signer: PolkadotSigner,
): Promise<MapAccountOutcome> {
    const result = await api.tx.Revive.map_account().signAndSubmit(signer);
    if (result.ok) return "mapped";
    if (isAccountAlreadyMappedError(result.dispatchError)) return "already-mapped";
    throw new Error(`Revive.map_account failed: ${stringifyBigInt(result.dispatchError)}`);
}

if (import.meta.vitest) {
    const { describe, expect, test, vi } = import.meta.vitest;

    function fakeSigner(): PolkadotSigner {
        return {
            publicKey: new Uint8Array(32),
            signTx: vi.fn(async () => new Uint8Array(65)),
            signBytes: vi.fn(async () => new Uint8Array(64)),
        };
    }

    function apiWith(
        result: { ok: boolean; dispatchError?: { type: string; value: unknown } } | Error,
    ): ReviveMapAccountApi {
        return {
            tx: {
                Revive: {
                    map_account: () => ({
                        signAndSubmit: async () => {
                            if (result instanceof Error) throw result;
                            return result;
                        },
                    }),
                },
            },
        };
    }

    describe("ensureAccountMapped", () => {
        test("reports a successful submission as mapped", async () => {
            await expect(ensureAccountMapped(apiWith({ ok: true }), fakeSigner())).resolves.toBe(
                "mapped",
            );
        });

        test("treats only the AccountAlreadyMapped dispatch error as already mapped", async () => {
            const api = apiWith({
                ok: false,
                dispatchError: {
                    type: "Module",
                    value: { type: "Revive", value: { type: "AccountAlreadyMapped" } },
                },
            });
            await expect(ensureAccountMapped(api, fakeSigner())).resolves.toBe("already-mapped");
        });

        test("surfaces other dispatch errors instead of reporting already mapped", async () => {
            const api = apiWith({
                ok: false,
                dispatchError: {
                    type: "Module",
                    value: { type: "Balances", value: { type: "InsufficientBalance" } },
                },
            });
            await expect(ensureAccountMapped(api, fakeSigner())).rejects.toThrow(
                /Revive\.map_account failed.*InsufficientBalance/s,
            );
        });

        test("propagates submission failures such as network errors", async () => {
            const api = apiWith(new Error("WebSocket connection lost"));
            await expect(ensureAccountMapped(api, fakeSigner())).rejects.toThrow(
                "WebSocket connection lost",
            );
        });
    });
}
