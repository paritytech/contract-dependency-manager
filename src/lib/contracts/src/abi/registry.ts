import type { AbiEntry, AbiParam } from "@parity/product-sdk-contracts";

/**
 * ABIs for the ContractRegistry contract pair.
 *
 * Source of truth: `src/contract` (implementation) and `src/contract/proxy`
 * (EIP-1967 proxy) compiled to PolkaVM; these arrays mirror the Solidity-ABI
 * exports produced by `cargo pvm-contract build`
 * (`target/release/contract-registry.abi.json` and
 * `target/release/contract-registry-proxy.abi.json`). Keep them bit-for-bit
 * identical to the generated metadata — `tests/registry-abi-sync.test.ts`
 * compares them against the built artifacts when those exist.
 *
 * The proxy holds the stable registry address and delegate-forwards every
 * call to the implementation, so `CONTRACTS_REGISTRY_ABI` (the
 * implementation's ABI) is used AT THE PROXY ADDRESS. The proxy's own ABI is
 * only needed to deploy it (`constructor(address implementation)`).
 *
 * Multi-value returns use the HISTORICAL single-tuple wire encoding — each
 * such function has ONE unnamed tuple-typed output with named components —
 * matching every already-deployed registry so old CLIs keep decoding.
 *
 * Naming note: where the generated JSON names a tuple component `is_some`,
 * this file uses the historical `isSome` (product-sdk keys decoded objects by
 * component name and every consumer reads `isSome`/`value`). Names are
 * display/decode keys only — types, structure, and order are bit-exact with
 * the generated ABI.
 */

/** Generated-ABI entry shape: `AbiEntry` plus the event-only fields. */
type RegistryAbiParam = Omit<AbiParam, "components"> & {
    indexed?: boolean;
    components?: RegistryAbiParam[];
};
type RegistryAbiEntry = Omit<AbiEntry, "inputs" | "outputs"> & {
    anonymous?: boolean;
    inputs: RegistryAbiParam[];
    outputs?: RegistryAbiParam[];
};

const REGISTRY_ABI: RegistryAbiEntry[] = [
    {
        type: "constructor",
        inputs: [],
        stateMutability: "nonpayable",
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
        name: "setAdmin",
        inputs: [{ name: "new_admin", type: "address" }],
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
        name: "freeze",
        inputs: [],
        outputs: [],
        stateMutability: "nonpayable",
    },
    {
        type: "function",
        name: "unfreeze",
        inputs: [],
        outputs: [],
        stateMutability: "nonpayable",
    },
    {
        type: "function",
        name: "isFrozen",
        inputs: [],
        outputs: [{ name: "", type: "bool" }],
        stateMutability: "view",
    },
    {
        type: "function",
        name: "adminImportContracts",
        inputs: [
            {
                name: "contracts",
                type: "tuple[]",
                components: [
                    { name: "contract_name", type: "string" },
                    { name: "owner", type: "address" },
                    {
                        name: "versions",
                        type: "tuple[]",
                        components: [
                            { name: "address", type: "address" },
                            { name: "metadata_uri", type: "string" },
                        ],
                    },
                ],
            },
        ],
        outputs: [],
        stateMutability: "nonpayable",
    },
    {
        type: "function",
        name: "publishLatest",
        inputs: [
            { name: "contract_name", type: "string" },
            { name: "contract_address", type: "address" },
            { name: "metadata_uri", type: "string" },
        ],
        outputs: [],
        stateMutability: "nonpayable",
    },
    {
        type: "function",
        name: "getAddress",
        inputs: [{ name: "contract_name", type: "string" }],
        outputs: [
            {
                name: "",
                type: "tuple",
                components: [
                    { name: "isSome", type: "bool" },
                    { name: "value", type: "address" },
                ],
            },
        ],
        stateMutability: "view",
    },
    {
        type: "function",
        name: "getMetadataUri",
        inputs: [{ name: "contract_name", type: "string" }],
        outputs: [
            {
                name: "",
                type: "tuple",
                components: [
                    { name: "isSome", type: "bool" },
                    { name: "value", type: "string" },
                ],
            },
        ],
        stateMutability: "view",
    },
    {
        type: "function",
        name: "getAddressAtVersion",
        inputs: [
            { name: "contract_name", type: "string" },
            { name: "version", type: "uint32" },
        ],
        outputs: [
            {
                name: "",
                type: "tuple",
                components: [
                    { name: "isSome", type: "bool" },
                    { name: "value", type: "address" },
                ],
            },
        ],
        stateMutability: "view",
    },
    {
        type: "function",
        name: "getMetadataUriAtVersion",
        inputs: [
            { name: "contract_name", type: "string" },
            { name: "version", type: "uint32" },
        ],
        outputs: [
            {
                name: "",
                type: "tuple",
                components: [
                    { name: "isSome", type: "bool" },
                    { name: "value", type: "string" },
                ],
            },
        ],
        stateMutability: "view",
    },
    {
        type: "function",
        name: "getContractNameAt",
        inputs: [{ name: "index", type: "uint32" }],
        outputs: [{ name: "", type: "string" }],
        stateMutability: "view",
    },
    {
        type: "function",
        name: "getContracts",
        inputs: [
            { name: "start", type: "uint32" },
            { name: "count", type: "uint32" },
        ],
        outputs: [
            {
                name: "",
                type: "tuple",
                components: [
                    { name: "total", type: "uint32" },
                    {
                        name: "entries",
                        type: "tuple[]",
                        components: [
                            { name: "name", type: "string" },
                            { name: "version", type: "uint32" },
                            { name: "address", type: "address" },
                            { name: "metadata_uri", type: "string" },
                            { name: "owner", type: "address" },
                        ],
                    },
                ],
            },
        ],
        stateMutability: "view",
    },
    {
        type: "function",
        name: "getOwner",
        inputs: [{ name: "contract_name", type: "string" }],
        outputs: [{ name: "", type: "address" }],
        stateMutability: "view",
    },
    {
        type: "function",
        name: "getVersionCount",
        inputs: [{ name: "contract_name", type: "string" }],
        outputs: [{ name: "", type: "uint32" }],
        stateMutability: "view",
    },
    {
        type: "function",
        name: "getContractCount",
        inputs: [],
        outputs: [{ name: "", type: "uint32" }],
        stateMutability: "view",
    },
    { type: "error", name: "Unauthorized", inputs: [] },
    { type: "error", name: "UnauthorizedAdmin", inputs: [] },
    { type: "error", name: "ContractFrozen", inputs: [] },
    { type: "error", name: "ContractNameEmpty", inputs: [] },
    { type: "error", name: "ContractNameTooLong", inputs: [] },
    { type: "error", name: "ContractNameInvalid", inputs: [] },
    { type: "error", name: "ImportVersionsEmpty", inputs: [] },
    { type: "error", name: "ImportContractExists", inputs: [] },
    { type: "error", name: "VersionOverflow", inputs: [] },
    { type: "error", name: "BadImplementation", inputs: [] },
    {
        type: "event",
        name: "Published",
        anonymous: false,
        inputs: [
            { indexed: true, name: "name", type: "string" },
            { indexed: false, name: "version", type: "uint32" },
            { indexed: false, name: "address", type: "address" },
        ],
    },
    {
        type: "event",
        name: "Upgraded",
        anonymous: false,
        inputs: [{ indexed: true, name: "implementation", type: "address" }],
    },
    {
        type: "event",
        name: "AdminChanged",
        anonymous: false,
        inputs: [
            { indexed: false, name: "previous_admin", type: "address" },
            { indexed: false, name: "new_admin", type: "address" },
        ],
    },
    {
        type: "event",
        name: "FrozenSet",
        anonymous: false,
        inputs: [{ indexed: false, name: "frozen", type: "bool" }],
    },
    { type: "error", name: "InvalidCalldata", inputs: [] },
    { type: "error", name: "CalldataTooLarge", inputs: [] },
    { type: "error", name: "NoSelector", inputs: [] },
    { type: "error", name: "UnknownSelector", inputs: [] },
    { type: "error", name: "NonPayableValueReceived", inputs: [] },
];

export const CONTRACTS_REGISTRY_ABI: AbiEntry[] = REGISTRY_ABI;

const REGISTRY_PROXY_ABI: RegistryAbiEntry[] = [
    {
        type: "constructor",
        inputs: [
            { name: "implementation", type: "address" },
            { name: "admin", type: "address" },
        ],
        stateMutability: "nonpayable",
    },
    { type: "error", name: "InvalidCalldata", inputs: [] },
    { type: "error", name: "CalldataTooLarge", inputs: [] },
    { type: "error", name: "NoSelector", inputs: [] },
    { type: "error", name: "UnknownSelector", inputs: [] },
    { type: "error", name: "NonPayableValueReceived", inputs: [] },
];

/**
 * ABI of the EIP-1967 proxy that fronts the registry. Deploy-time only: the
 * proxy exposes no methods of its own — call the registry through
 * `CONTRACTS_REGISTRY_ABI` at the proxy address.
 */
export const CONTRACTS_REGISTRY_PROXY_ABI: AbiEntry[] = REGISTRY_PROXY_ABI;
