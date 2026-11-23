import type { AbiEntry, AbiParam } from "@parity/product-sdk-contracts";

/**
 * Hand-written ABI of the CREATE3 factory (`src/contract/create3/factory`).
 *
 * The DEPLOYED factory is always the committed blob at
 * `src/contract/create3/artifacts/create3-factory.polkavm` (its bytes pin the
 * factory's CREATE2 address), so this ABI only ever changes together with a
 * deliberate new factory generation.
 */

/** Generated-ABI entry shape: `AbiEntry` plus the event-only fields. */
type FactoryAbiParam = Omit<AbiParam, "components"> & {
    indexed?: boolean;
    components?: FactoryAbiParam[];
};
type FactoryAbiEntry = Omit<AbiEntry, "inputs" | "outputs"> & {
    anonymous?: boolean;
    inputs: FactoryAbiParam[];
    outputs?: FactoryAbiParam[];
};

const FACTORY_ABI: FactoryAbiEntry[] = [
    {
        type: "constructor",
        inputs: [{ name: "child_code_hash", type: "bytes32" }],
        stateMutability: "nonpayable",
    },
    {
        type: "function",
        name: "deploy",
        inputs: [
            { name: "salt", type: "bytes32" },
            { name: "code_hash", type: "bytes32" },
            { name: "input", type: "bytes" },
        ],
        outputs: [{ name: "", type: "address" }],
        stateMutability: "nonpayable",
    },
    {
        type: "function",
        name: "predict",
        inputs: [{ name: "salt", type: "bytes32" }],
        outputs: [{ name: "", type: "address" }],
        stateMutability: "view",
    },
    {
        type: "function",
        name: "getOwner",
        inputs: [],
        outputs: [{ name: "", type: "address" }],
        stateMutability: "view",
    },
    {
        type: "function",
        name: "setOwner",
        inputs: [{ name: "new_owner", type: "address" }],
        outputs: [],
        stateMutability: "nonpayable",
    },
    {
        type: "function",
        name: "getChildCodeHash",
        inputs: [],
        outputs: [{ name: "", type: "bytes32" }],
        stateMutability: "view",
    },
    { type: "error", name: "NotOwner", inputs: [] },
    { type: "error", name: "ChildCallFailed", inputs: [] },
    {
        type: "event",
        name: "Deployed",
        anonymous: false,
        inputs: [
            { indexed: true, name: "salt", type: "bytes32" },
            { indexed: false, name: "address", type: "address" },
            { indexed: false, name: "code_hash", type: "bytes32" },
        ],
    },
];

export const CREATE3_FACTORY_ABI: AbiEntry[] = FACTORY_ABI;
