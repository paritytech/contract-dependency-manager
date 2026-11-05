import type { AbiEntry, AbiParam } from "@parity/product-sdk-contracts";

/**
 * Hand-mirrored ABI of `src/contract/resolver`, matching
 * `target/release/contract-resolver.abi.json` from `cargo pvm-contract
 * build`; `tests/registry-abi-sync.test.ts` diffs it against the built
 * artifact when that exists. Used at the resolver proxy address, which the
 * registry reports through `getResolver()`.
 *
 * `resolve` is what every per-name shim calls; the rest is the registry's
 * write surface (`publish`, `setMinSupported`, `setFrozen`, `setCode`) and
 * the open routing queries (`routingOf`, `implOf`).
 */

/** Generated-ABI entry shape: `AbiEntry` plus the event-only fields. */
type ResolverAbiParam = Omit<AbiParam, "components"> & {
    indexed?: boolean;
    components?: ResolverAbiParam[];
};
type ResolverAbiEntry = Omit<AbiEntry, "inputs" | "outputs"> & {
    anonymous?: boolean;
    inputs: ResolverAbiParam[];
    outputs?: ResolverAbiParam[];
};

const RESOLVER_ABI: ResolverAbiEntry[] = [
    {
        type: "constructor",
        inputs: [],
        stateMutability: "nonpayable",
    },
    {
        type: "function",
        name: "resolve",
        inputs: [
            { name: "caller", type: "address" },
            { name: "value", type: "uint256" },
            { name: "data", type: "bytes" },
        ],
        outputs: [
            {
                name: "",
                type: "tuple",
                components: [
                    { name: "kind", type: "uint8" },
                    { name: "target", type: "address" },
                    { name: "strip", type: "uint32" },
                    { name: "payload", type: "bytes" },
                ],
            },
        ],
        stateMutability: "view",
    },
    {
        type: "function",
        name: "publish",
        inputs: [
            { name: "proxy", type: "address" },
            { name: "version_key", type: "uint128" },
            { name: "implementation", type: "address" },
        ],
        outputs: [],
        stateMutability: "nonpayable",
    },
    {
        type: "function",
        name: "setMinSupported",
        inputs: [
            { name: "proxy", type: "address" },
            { name: "version_key", type: "uint128" },
        ],
        outputs: [],
        stateMutability: "nonpayable",
    },
    {
        type: "function",
        name: "setFrozen",
        inputs: [
            { name: "proxy", type: "address" },
            { name: "frozen", type: "bool" },
        ],
        outputs: [],
        stateMutability: "nonpayable",
    },
    {
        type: "function",
        name: "setCode",
        inputs: [{ name: "new_implementation", type: "address" }],
        outputs: [],
        stateMutability: "nonpayable",
    },
    {
        type: "function",
        name: "getCode",
        inputs: [],
        outputs: [{ name: "", type: "address" }],
        stateMutability: "view",
    },
    {
        type: "function",
        name: "getAdmin",
        inputs: [],
        outputs: [{ name: "", type: "address" }],
        stateMutability: "view",
    },
    {
        type: "function",
        name: "routingOf",
        inputs: [{ name: "proxy", type: "address" }],
        outputs: [
            {
                name: "",
                type: "tuple",
                components: [
                    { name: "latest_key", type: "uint128" },
                    { name: "latest_impl", type: "address" },
                    { name: "min_supported", type: "uint128" },
                    { name: "frozen", type: "bool" },
                ],
            },
        ],
        stateMutability: "view",
    },
    {
        type: "function",
        name: "implOf",
        inputs: [
            { name: "proxy", type: "address" },
            { name: "version_key", type: "uint128" },
        ],
        outputs: [{ name: "", type: "address" }],
        stateMutability: "view",
    },
    { type: "error", name: "UnknownVersion", inputs: [] },
    {
        type: "error",
        name: "UnsupportedVersion",
        inputs: [
            { name: "", type: "uint128" },
            { name: "", type: "uint128" },
        ],
    },
    { type: "error", name: "UnauthorizedAdmin", inputs: [] },
    {
        type: "error",
        name: "VersionNotMonotonic",
        inputs: [
            { name: "", type: "uint128" },
            { name: "", type: "uint128" },
        ],
    },
    { type: "error", name: "InvalidVersionKey", inputs: [] },
    { type: "error", name: "InvalidImplementation", inputs: [] },
    { type: "error", name: "MalformedCall", inputs: [] },
    { type: "error", name: "UnknownMetaSelector", inputs: [] },
    {
        type: "error",
        name: "MinNotMonotonic",
        inputs: [
            { name: "", type: "uint128" },
            { name: "", type: "uint128" },
        ],
    },
    {
        type: "error",
        name: "MinAboveLatest",
        inputs: [
            { name: "", type: "uint128" },
            { name: "", type: "uint128" },
        ],
    },
    { type: "error", name: "NoVersions", inputs: [] },
    { type: "error", name: "ContractFrozen", inputs: [] },
    { type: "error", name: "BadImplementation", inputs: [] },
    { type: "error", name: "InvalidCalldata", inputs: [] },
    { type: "error", name: "CalldataTooLarge", inputs: [] },
    { type: "error", name: "NoSelector", inputs: [] },
    { type: "error", name: "UnknownSelector", inputs: [] },
    { type: "error", name: "NonPayableValueReceived", inputs: [] },
];

export const CONTRACT_RESOLVER_ABI: AbiEntry[] = RESOLVER_ABI;
