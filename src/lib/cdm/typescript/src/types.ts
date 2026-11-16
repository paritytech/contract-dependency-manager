import type { ChainDefinition, PolkadotClient, SS58String } from "polkadot-api";
import type { CdmSigner } from "@parity/cdm-env";

// Per-contract definition shape (generated into .cdm/cdm.d.ts via module augmentation)
export interface CdmContractDef {
    methods: Record<string, { args: any[]; response: any }>;
}

// Augmentable interface — cdm install generates declarations extending this
// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface CdmContracts {}

/**
 * Substrate weight, as returned by `ReviveApi.call` dry-runs and accepted by
 * `Revive.call`'s `weight_limit`. Same shape as papi's / product-sdk's `Weight`.
 */
export interface Weight {
    ref_time: bigint;
    proof_size: bigint;
}

// Query result wrapper
export interface QueryResult<T> {
    success: boolean;
    /** Decoded response on success; `undefined` on failure (see `error`). */
    value: T;
    /** Weight the dry-run required — usable directly as `TxOpts.gasLimit`. */
    gasRequired?: Weight;
    /**
     * Failure payload when `success` is false: the chain's dispatch error, or a
     * decoded revert (`{ type: "ContractRevertedWithPayload", data, reason?, decoded? }`).
     */
    error?: unknown;
}

// Query options override (trailing argument after the method's positional args)
export interface QueryOpts {
    /** Dry-run caller; defaults per the origin rule on {@link CdmOptions}. */
    origin?: SS58String;
    value?: bigint;
}

// Transaction options override (trailing argument after the method's positional args)
export interface TxOpts {
    /** Signs and submits; without an explicit `origin` it is also the dry-run caller. */
    signer?: CdmSigner;
    /** Caller for the sizing dry-run; defaults per the origin rule on {@link CdmOptions}. */
    origin?: SS58String;
    value?: bigint;
    gasLimit?: Weight;
    storageDepositLimit?: bigint;
}

// Transaction call result
export interface TxResult {
    txHash: string;
    blockHash: string;
    ok: boolean;
    events: unknown[];
}

// The property-based wrapper type
export type CdmContract<C extends CdmContractDef> = {
    [K in keyof C["methods"]]: {
        query: (
            ...args: [...C["methods"][K]["args"], opts?: QueryOpts]
        ) => Promise<QueryResult<C["methods"][K]["response"]>>;
        tx: (...args: [...C["methods"][K]["args"], opts?: TxOpts]) => Promise<TxResult>;
    };
};

// Mutable defaults shared across all contract handles (see `Cdm.setDefaults`)
export interface CdmDefaults {
    origin?: SS58String;
    signer?: CdmSigner;
}

/**
 * Options for `createCdm()` / `new Cdm()`.
 *
 * Origin rule (the caller of `.query()` and of `.tx()`'s sizing dry-run): an
 * explicitly provided origin always wins — per-call `origin`, else
 * `defaultOrigin` / `setDefaults({ origin })`. Otherwise the origin is the
 * account of the effective signer: the per-call `signer` (`.tx()` only), else
 * the default signer. With neither configured, Alice signs and is the origin.
 */
export interface CdmOptions {
    cdmJsonPath?: string;
    client?: PolkadotClient;
    assethubUrl?: string;
    /** Fixed caller for all calls, overriding the signer-derived origin. */
    defaultOrigin?: SS58String;
    /** Default signer for `.tx()`; also the default origin unless `defaultOrigin` is set. Defaults to Alice. */
    defaultSigner?: CdmSigner;
    /**
     * Chain descriptor matching the Asset Hub the client is connected to. Only
     * used for typing/codecs of the `Revive` extrinsic and storage; contract
     * dry-runs go through papi's unsafe API. Defaults to `paseo_asset_hub` from
     * `@parity/product-sdk-descriptors/paseo-asset-hub`.
     */
    descriptor?: ChainDefinition;
}

// Resolved contract info from project .cdm/
export interface ResolvedContract {
    name: string;
    address: string;
    abi: AbiEntry[];
    abiPath: string;
    version: string;
    metadataCid: string;
}

// ABI types (reuse shape from @parity/cdm-builder deployer)
export interface AbiParam {
    name: string;
    type: string;
    components?: AbiParam[];
}

export interface AbiEntry {
    type: string;
    name?: string;
    inputs: AbiParam[];
    outputs?: AbiParam[];
    stateMutability?: string;
}
