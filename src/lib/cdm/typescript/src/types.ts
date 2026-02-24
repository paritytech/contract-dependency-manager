import type { PolkadotSigner, HexString, Binary, FixedSizeBinary, SS58String } from "polkadot-api";

// Per-contract definition shape (generated into .cdm/cdm.d.ts via module augmentation)
export interface CdmContractDef {
    methods: Record<string, { args: any[]; response: any }>;
}

// Augmentable interface — cdm install generates declarations extending this
// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface CdmContracts {}

// Query result wrapper
export interface QueryResult<T> {
    success: boolean;
    value: T;
    gasRequired?: bigint;
}

// Transaction options override
export interface TxOpts {
    signer?: PolkadotSigner;
    value?: bigint;
    gasLimit?: { refTime: bigint; proofSize: bigint };
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
            ...args: C["methods"][K]["args"]
        ) => Promise<QueryResult<C["methods"][K]["response"]>>;
        tx: (...args: [...C["methods"][K]["args"], opts?: TxOpts]) => Promise<TxResult>;
    };
};

// Options for createCdm()
export interface CdmOptions {
    cdmJsonPath?: string;
    targetHash?: string;
    client?: import("polkadot-api").PolkadotClient;
    defaultOrigin?: SS58String;
    defaultSigner?: PolkadotSigner;
}

// Resolved contract info from ~/.cdm/
export interface ResolvedContract {
    name: string;
    address: string;
    abi: AbiEntry[];
    abiPath: string;
    version: number;
    metadataCid: string;
}

// ABI types (reuse shape from @dotdm/contracts deployer)
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
