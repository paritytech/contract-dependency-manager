import type { AbiEntry, AbiParam } from "@parity/product-sdk-contracts";

/**
 * Hand-mirrored ABIs of `src/contract` (implementation) and
 * `src/contract/registry-proxy`, matching `target/release/*.abi.json` from
 * `cargo pvm-contract build`; `tests/registry-abi-sync.test.ts` diffs them
 * against the built artifacts when those exist.
 *
 * `CONTRACTS_REGISTRY_ABI` is used at the proxy address; the proxy's own ABI
 * is only needed to deploy it (`constructor(address implementation, address
 * admin)`).
 *
 * Multi-value returns are ONE unnamed tuple output with named components.
 * Where the generated JSON says `is_some`, this file keeps `isSome` —
 * product-sdk keys decoded objects by component name and every consumer
 * reads `isSome`/`value`; types, structure, and order stay bit-exact.
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
        name: "setProxyCodeHash",
        inputs: [{ name: "code_hash", type: "bytes32" }],
        outputs: [],
        stateMutability: "nonpayable",
    },
    {
        type: "function",
        name: "getProxyCodeHash",
        inputs: [],
        outputs: [{ name: "", type: "bytes32" }],
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
                    { name: "proxy", type: "address" },
                    {
                        name: "versions",
                        type: "tuple[]",
                        components: [
                            { name: "version_key", type: "uint128" },
                            { name: "target", type: "address" },
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
        name: "publish",
        inputs: [
            { name: "contract_name", type: "string" },
            { name: "version_key", type: "uint128" },
            { name: "target", type: "address" },
            { name: "metadata_uri", type: "string" },
        ],
        outputs: [],
        stateMutability: "nonpayable",
    },
    {
        type: "function",
        name: "publishWithInit",
        inputs: [
            { name: "contract_name", type: "string" },
            { name: "version_key", type: "uint128" },
            { name: "target", type: "address" },
            { name: "metadata_uri", type: "string" },
            { name: "init_target", type: "address" },
        ],
        outputs: [],
        stateMutability: "nonpayable",
    },
    {
        type: "function",
        name: "setMinSupported",
        inputs: [
            { name: "contract_name", type: "string" },
            { name: "version_key", type: "uint128" },
        ],
        outputs: [],
        stateMutability: "nonpayable",
    },
    {
        type: "function",
        name: "freezeContract",
        inputs: [{ name: "contract_name", type: "string" }],
        outputs: [],
        stateMutability: "nonpayable",
    },
    {
        type: "function",
        name: "unfreezeContract",
        inputs: [{ name: "contract_name", type: "string" }],
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
        name: "getProxy",
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
        name: "getLatestKey",
        inputs: [{ name: "contract_name", type: "string" }],
        outputs: [{ name: "", type: "uint128" }],
        stateMutability: "view",
    },
    {
        type: "function",
        name: "getMinSupported",
        inputs: [{ name: "contract_name", type: "string" }],
        outputs: [{ name: "", type: "uint128" }],
        stateMutability: "view",
    },
    {
        type: "function",
        name: "getVersionAt",
        inputs: [
            { name: "contract_name", type: "string" },
            { name: "index", type: "uint32" },
        ],
        outputs: [
            {
                name: "",
                type: "tuple",
                components: [
                    { name: "isSome", type: "bool" },
                    { name: "version_key", type: "uint128" },
                    { name: "target", type: "address" },
                    { name: "metadata_uri", type: "string" },
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
                            { name: "version_key", type: "uint128" },
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
    {
        type: "error",
        name: "Unauthorized",
        inputs: [],
    },
    {
        type: "error",
        name: "UnauthorizedAdmin",
        inputs: [],
    },
    {
        type: "error",
        name: "ContractFrozen",
        inputs: [],
    },
    {
        type: "error",
        name: "ContractNameEmpty",
        inputs: [],
    },
    {
        type: "error",
        name: "ContractNameTooLong",
        inputs: [],
    },
    {
        type: "error",
        name: "ContractNameInvalid",
        inputs: [],
    },
    {
        type: "error",
        name: "ImportVersionsEmpty",
        inputs: [],
    },
    {
        type: "error",
        name: "ImportContractExists",
        inputs: [],
    },
    {
        type: "error",
        name: "VersionOverflow",
        inputs: [],
    },
    {
        type: "error",
        name: "BadImplementation",
        inputs: [],
    },
    {
        type: "error",
        name: "InvalidVersionKey",
        inputs: [],
    },
    {
        type: "error",
        name: "VersionNotMonotonic",
        inputs: [
            { name: "", type: "uint128" },
            { name: "", type: "uint128" },
        ],
    },
    {
        type: "error",
        name: "ProxyCodeHashUnset",
        inputs: [],
    },
    {
        type: "error",
        name: "NoProxy",
        inputs: [],
    },
    {
        type: "error",
        name: "InvalidInitTarget",
        inputs: [],
    },
    {
        type: "event",
        name: "Published",
        inputs: [
            {
                name: "name",
                type: "string",
                indexed: true,
            },
            {
                name: "version_key",
                type: "uint128",
                indexed: false,
            },
            {
                name: "target",
                type: "address",
                indexed: false,
            },
        ],
        anonymous: false,
    },
    {
        type: "event",
        name: "ProxyCreated",
        inputs: [
            {
                name: "name",
                type: "string",
                indexed: true,
            },
            {
                name: "proxy",
                type: "address",
                indexed: false,
            },
        ],
        anonymous: false,
    },
    {
        type: "event",
        name: "Initialized",
        inputs: [
            {
                name: "name",
                type: "string",
                indexed: true,
            },
            {
                name: "version_key",
                type: "uint128",
                indexed: false,
            },
            {
                name: "init_target",
                type: "address",
                indexed: false,
            },
        ],
        anonymous: false,
    },
    {
        type: "event",
        name: "MinSupportedSet",
        inputs: [
            {
                name: "name",
                type: "string",
                indexed: true,
            },
            {
                name: "version_key",
                type: "uint128",
                indexed: false,
            },
        ],
        anonymous: false,
    },
    {
        type: "event",
        name: "ContractFrozenSet",
        inputs: [
            {
                name: "name",
                type: "string",
                indexed: true,
            },
            {
                name: "frozen",
                type: "bool",
                indexed: false,
            },
        ],
        anonymous: false,
    },
    {
        type: "event",
        name: "Upgraded",
        inputs: [
            {
                name: "implementation",
                type: "address",
                indexed: true,
            },
        ],
        anonymous: false,
    },
    {
        type: "event",
        name: "AdminChanged",
        inputs: [
            {
                name: "previous_admin",
                type: "address",
                indexed: false,
            },
            {
                name: "new_admin",
                type: "address",
                indexed: false,
            },
        ],
        anonymous: false,
    },
    {
        type: "event",
        name: "FrozenSet",
        inputs: [
            {
                name: "frozen",
                type: "bool",
                indexed: false,
            },
        ],
        anonymous: false,
    },
    {
        type: "error",
        name: "InvalidCalldata",
        inputs: [],
    },
    {
        type: "error",
        name: "CalldataTooLarge",
        inputs: [],
    },
    {
        type: "error",
        name: "NoSelector",
        inputs: [],
    },
    {
        type: "error",
        name: "UnknownSelector",
        inputs: [],
    },
    {
        type: "error",
        name: "NonPayableValueReceived",
        inputs: [],
    },
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

/** Deploy-time only: the proxy exposes no methods of its own. */
export const CONTRACTS_REGISTRY_PROXY_ABI: AbiEntry[] = REGISTRY_PROXY_ABI;
