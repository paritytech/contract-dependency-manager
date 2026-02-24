import type { SS58String, PolkadotSigner } from "polkadot-api";
import type { AbiEntry, QueryResult, TxOpts, TxResult } from "./types";

type PapiInkContract = any; // papi's InkSdk contract type

function buildMethodArgMap(abi: AbiEntry[]): Record<string, string[]> {
    const map: Record<string, string[]> = {};
    for (const entry of abi) {
        if (entry.type === "function" && entry.name) {
            map[entry.name] = entry.inputs.map((p) => p.name);
        }
    }
    return map;
}

function positionalToNamed(argNames: string[], values: unknown[]): Record<string, unknown> {
    const data: Record<string, unknown> = {};
    for (let i = 0; i < argNames.length; i++) {
        data[argNames[i]] = values[i];
    }
    return data;
}

// Check if last arg is an overrides object (not a regular positional arg)
function extractOverrides<T>(
    argNames: string[],
    args: unknown[],
): { positionalArgs: unknown[]; overrides?: T } {
    if (args.length > argNames.length && args.length > 0) {
        const last = args[args.length - 1];
        if (last && typeof last === "object" && !Array.isArray(last)) {
            return { positionalArgs: args.slice(0, -1), overrides: last as T };
        }
    }
    return { positionalArgs: args };
}

export function wrapContract(
    papiContract: PapiInkContract,
    abi: AbiEntry[],
    defaults: { origin?: SS58String; signer?: PolkadotSigner },
): Record<
    string,
    {
        query: (...args: any[]) => Promise<QueryResult<any>>;
        tx: (...args: any[]) => Promise<TxResult>;
    }
> {
    const methodArgs = buildMethodArgMap(abi);

    return new Proxy({} as any, {
        get(_, methodName: string) {
            if (typeof methodName !== "string") return undefined;
            const argNames = methodArgs[methodName];
            if (!argNames) return undefined;

            return {
                query: async (...args: unknown[]) => {
                    const { positionalArgs, overrides } = extractOverrides<{
                        origin?: SS58String;
                        value?: bigint;
                    }>(argNames, args);
                    const data = positionalToNamed(argNames, positionalArgs);
                    const origin = overrides?.origin ?? defaults.origin;
                    if (!origin)
                        throw new Error(
                            "No origin provided for query. Pass { origin } or set defaultOrigin.",
                        );

                    const result = await papiContract.query(methodName, {
                        origin,
                        data,
                        ...(overrides?.value !== undefined && { value: overrides.value }),
                    });
                    return {
                        success: result.success,
                        value: result.success ? result.value.response : undefined,
                        gasRequired: result.value?.gasRequired,
                    };
                },
                tx: async (...args: unknown[]) => {
                    const { positionalArgs, overrides } = extractOverrides<TxOpts>(argNames, args);
                    const data = positionalToNamed(argNames, positionalArgs);
                    const signer = overrides?.signer ?? defaults.signer;
                    if (!signer)
                        throw new Error(
                            "No signer provided for tx. Pass { signer } or set defaultSigner.",
                        );

                    const origin = defaults.origin;
                    const tx = papiContract.send(methodName, {
                        data,
                        origin: origin ?? "",
                        ...(overrides?.value !== undefined && { value: overrides.value }),
                        ...(overrides?.gasLimit && { gasLimit: overrides.gasLimit }),
                        ...(overrides?.storageDepositLimit !== undefined && {
                            storageDepositLimit: overrides.storageDepositLimit,
                        }),
                    });
                    const result = await tx.signAndSubmit(signer);
                    return {
                        txHash: result.txHash,
                        blockHash: result.block?.hash ?? "",
                        ok: result.ok,
                        events: result.events ?? [],
                    };
                },
            };
        },
    });
}
