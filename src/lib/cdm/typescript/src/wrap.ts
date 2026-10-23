import type { SS58String } from "polkadot-api";
import type { Contract, ContractDef, QueryOptions, TxOptions } from "@parity/product-sdk-contracts";
import { ss58Address, type CdmSigner } from "@parity/cdm-env";
import type { AbiEntry, QueryOpts, QueryResult, TxOpts, TxResult } from "./types";

/**
 * `.tx()` resolves once the extrinsic is finalized (product-sdk defaults to
 * best-block). Queries and the tx sizing dry-run read at finalized via the
 * runtime's `at` option, configured where the runtime is built (cdm-core).
 */
const TX_WAIT_FOR: TxOptions["waitFor"] = "finalized";

/**
 * The owning `Cdm`'s defaults, read on every call so `setDefaults()` reaches
 * existing handles. `origin` is set only when one was configured explicitly.
 */
export interface CallDefaults {
    origin?: SS58String;
    signer: CdmSigner;
}

type WrappedMethod = {
    query: (...args: unknown[]) => Promise<QueryResult<any>>;
    tx: (...args: unknown[]) => Promise<TxResult>;
};

function buildMethodArity(abi: AbiEntry[]): Record<string, number> {
    const arity: Record<string, number> = {};
    for (const entry of abi) {
        if (entry.type === "function" && entry.name) {
            arity[entry.name] = entry.inputs.length;
        }
    }
    return arity;
}

// A trailing plain object beyond the method's arity is the overrides object
// (a struct/tuple argument in the last position is still positional). An
// explicit trailing `undefined` in the options slot means "no overrides".
function splitArgs<T>(
    methodName: string,
    arity: number,
    args: unknown[],
): { positionalArgs: unknown[]; overrides?: T } {
    let positionalArgs = args;
    let overrides: T | undefined;
    if (args.length > arity && args.length > 0) {
        const last = args[args.length - 1];
        if (last === undefined && args.length === arity + 1) {
            positionalArgs = args.slice(0, -1);
        } else if (last && typeof last === "object" && !Array.isArray(last)) {
            positionalArgs = args.slice(0, -1);
            overrides = last as T;
        }
    }
    // product-sdk detects its own options object by the same arity rule, so a
    // short argument list would make it read our options as a positional arg.
    if (positionalArgs.length !== arity) {
        throw new Error(`${methodName} expects ${arity} argument(s), got ${positionalArgs.length}`);
    }
    return { positionalArgs, overrides };
}

/**
 * Dry-run origin when the call doesn't pass one: the explicitly configured
 * default origin, else the account of the signer in effect. Always passed to
 * product-sdk explicitly: without an origin its `.query()` dry-runs as the
 * pallet-revive account rather than the signer.
 */
function resolveOrigin(defaultOrigin: SS58String | undefined, signer: CdmSigner): SS58String {
    return defaultOrigin ?? (ss58Address(signer.publicKey) as SS58String);
}

function toQueryOptions(overrides: QueryOpts | undefined, defaults: CallDefaults): QueryOptions {
    const opts: QueryOptions = {
        origin: overrides?.origin ?? resolveOrigin(defaults.origin, defaults.signer),
    };
    if (overrides?.value !== undefined) opts.value = overrides.value;
    return opts;
}

function toTxOptions(overrides: TxOpts | undefined, defaults: CallDefaults): TxOptions {
    const signer = overrides?.signer ?? defaults.signer;
    const opts: TxOptions = {
        waitFor: TX_WAIT_FOR,
        signer,
        origin: overrides?.origin ?? resolveOrigin(defaults.origin, signer),
    };
    if (overrides?.value !== undefined) opts.value = overrides.value;
    if (overrides?.gasLimit !== undefined) opts.gasLimit = overrides.gasLimit;
    if (overrides?.storageDepositLimit !== undefined)
        opts.storageDepositLimit = overrides.storageDepositLimit;
    return opts;
}

/**
 * Adapt a product-sdk contract handle to the CDM handle shape: positional args
 * plus an optional trailing overrides object, `QueryResult` / `TxResult`
 * results, and `.tx()` throwing on failure instead of returning a `Result`.
 * Signer and origin are resolved here on every call (see {@link CallDefaults}).
 */
export function wrapContract(
    contract: Contract<ContractDef>,
    abi: AbiEntry[],
    getDefaults: () => CallDefaults,
): Record<string, WrappedMethod> {
    const methodArity = buildMethodArity(abi);

    return new Proxy({} as Record<string, WrappedMethod>, {
        get(_, methodName) {
            if (typeof methodName !== "string") return undefined;
            const arity = methodArity[methodName];
            if (arity === undefined) return undefined;

            return {
                query: async (...args: unknown[]) => {
                    const { positionalArgs, overrides } = splitArgs<QueryOpts>(
                        methodName,
                        arity,
                        args,
                    );
                    const result = await contract[methodName].query(
                        ...positionalArgs,
                        toQueryOptions(overrides, getDefaults()),
                    );
                    if (result.success) {
                        return {
                            success: true,
                            value: result.value,
                            gasRequired: result.gasRequired,
                        };
                    }
                    return {
                        success: false,
                        value: undefined,
                        gasRequired: result.gasRequired,
                        error: result.value,
                    };
                },
                tx: async (...args: unknown[]) => {
                    const { positionalArgs, overrides } = splitArgs<TxOpts>(
                        methodName,
                        arity,
                        args,
                    );
                    const result = await contract[methodName].tx(
                        ...positionalArgs,
                        toTxOptions(overrides, getDefaults()),
                    );
                    if (!result.ok) throw result.error;
                    const { txHash, block, ok, events } = result.value;
                    return { txHash, blockHash: block.hash, ok, events };
                },
            } satisfies WrappedMethod;
        },
    });
}
