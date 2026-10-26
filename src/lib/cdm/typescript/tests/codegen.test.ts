import { describe, test, expect } from "vitest";
import { generateContractTypes as productSdkContractTypes } from "@parity/product-sdk-contracts/codegen";
import { generateContractTypes, generateContractsAugmentation } from "../src/codegen";
import type { AbiEntry } from "../src/types";

const LIBRARY = "@example/blobs";

const ABI: AbiEntry[] = [
    {
        type: "function",
        name: "store",
        inputs: [
            { name: "data", type: "bytes" },
            { name: "tag", type: "bytes4" },
            { name: "chunks", type: "bytes[]" },
            {
                name: "meta",
                type: "tuple",
                components: [
                    { name: "hash", type: "bytes32" },
                    { name: "blob", type: "bytes" },
                ],
            },
        ],
        outputs: [],
        stateMutability: "nonpayable",
    },
    {
        type: "function",
        name: "load",
        inputs: [{ name: "id", type: "uint256" }],
        outputs: [{ name: "", type: "bytes" }],
        stateMutability: "view",
    },
    {
        type: "function",
        name: "pair",
        inputs: [],
        outputs: [
            { name: "", type: "bytes" },
            { name: "owner", type: "address" },
        ],
        stateMutability: "view",
    },
];

const CONTRACTS = [{ library: LIBRARY, abi: ABI }];

const methodLine = (src: string, name: string) =>
    src.split("\n").find((line) => line.trim().startsWith(`${name}:`));

describe("codegen bytes mapping", () => {
    test("bytes -> HexString and bytesN -> SizedHex<N>, as viem/product-sdk expect", () => {
        const src = generateContractTypes(CONTRACTS);

        expect(methodLine(src, "store")?.trim()).toBe(
            "store: { args: [data: HexString, tag: SizedHex<4>, chunks: HexString[], " +
                "meta: { hash: SizedHex<32>; blob: HexString }]; response: undefined };",
        );
        expect(methodLine(src, "load")?.trim()).toBe(
            "load: { args: [id: bigint]; response: HexString };",
        );
        expect(methodLine(src, "pair")?.trim()).toBe(
            "pair: { args: []; response: { _0: HexString; owner: HexString } };",
        );
        expect(src).not.toContain("Uint8Array");
    });

    test("both augmentations use the same mapping", () => {
        const cdm = generateContractTypes(CONTRACTS);
        const productSdk = generateContractsAugmentation(CONTRACTS);

        expect(cdm).toContain('declare module "@parity/cdm-codegen"');
        expect(cdm).toContain("interface CdmContracts {");
        expect(productSdk).toContain('declare module "@parity/product-sdk-contracts"');
        expect(productSdk).toContain("interface Contracts {");
        for (const name of ["store", "load", "pair"]) {
            expect(methodLine(productSdk, name)).toBe(methodLine(cdm, name));
        }
    });

    test("the product-sdk augmentation matches product-sdk's own codegen", () => {
        // Same output apart from the header comment's dash.
        const body = (src: string) => src.split("\n").slice(1).join("\n");

        expect(body(generateContractsAugmentation(CONTRACTS))).toBe(
            body(productSdkContractTypes(CONTRACTS as never)),
        );
    });
});
