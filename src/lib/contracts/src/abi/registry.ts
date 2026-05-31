import type { AbiEntry } from "@parity/product-sdk-contracts";

/**
 * ABI for the ContractRegistry contract.
 *
 * Source of truth: `src/contracts/registry/lib.rs` compiled to PolkaVM; this array
 * mirrors the Solidity-ABI export produced by `cargo pvm-contract build`
 * (`target/contract-registry.release.abi.json`). Keep it bit-for-bit identical
 * to the on-chain metadata — editing this file by hand will desync it from
 * the registry deployed on every network.
 *
 * Previously exposed via the `@dotdm/descriptors` package (papi-generated
 * ink descriptor); embedding it here removes the papi codegen dependency for
 * the one fixed contract every CDM deploy touches.
 */
export const CONTRACTS_REGISTRY_ABI: AbiEntry[] = [
    {
        type: "constructor",
        inputs: [],
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
        name: "searchContractNames",
        inputs: [
            { name: "prefix", type: "string" },
            { name: "offset", type: "uint32" },
            { name: "limit", type: "uint32" },
        ],
        outputs: [
            {
                name: "",
                type: "tuple",
                components: [
                    { name: "names", type: "string[]" },
                    { name: "next_offset", type: "uint32" },
                    { name: "done", type: "bool" },
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
];
