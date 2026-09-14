import type { AbiEntry, AbiParam } from "@parity/product-sdk-contracts";

/**
 * ABI for the CREATE3 factory contract.
 *
 * Source of truth: `src/contract/create3/factory` compiled to PolkaVM; this
 * array mirrors the Solidity-ABI export produced by `cargo pvm-contract
 * build` (`target/release/create3-factory.abi.json`). Keep it bit-for-bit
 * identical to the generated metadata — `tests/registry-abi-sync.test.ts`
 * compares it against the built artifact when that exists.
 *
 * NOTE the frozen-artifact rule: the DEPLOYED factory is always the
 * committed blob at `src/contract/create3/artifacts/create3-factory.polkavm`
 * (its bytes pin the factory's CREATE2 address), so this ABI only ever
 * changes together with a deliberate new factory generation.
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
    { type: "error", name: "InvalidCalldata", inputs: [] },
    { type: "error", name: "CalldataTooLarge", inputs: [] },
    { type: "error", name: "NoSelector", inputs: [] },
    { type: "error", name: "UnknownSelector", inputs: [] },
    { type: "error", name: "NonPayableValueReceived", inputs: [] },
];

export const CREATE3_FACTORY_ABI: AbiEntry[] = FACTORY_ABI;
