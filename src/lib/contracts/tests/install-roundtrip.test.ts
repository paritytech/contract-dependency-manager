import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { saveContract, getContractDir } from "../src/store";

// Inlined to avoid pulling deployer.ts (which transitively imports @dotdm/env
// and @dotdm/utils — workspace packages whose dist/ isn't built in a fresh
// checkout). These mirror the AbiEntry/Metadata shapes in src/deployer.ts.
interface AbiParam {
    name: string;
    type: string;
    components?: AbiParam[];
}
interface AbiEntry {
    type: string;
    name?: string;
    inputs: AbiParam[];
    outputs?: AbiParam[];
    stateMutability?: string;
    anonymous?: boolean;
}
interface Metadata {
    publish_block: number;
    published_at: string;
    description: string;
    readme: string;
    authors: string[];
    homepage: string;
    repository: string;
    abi: AbiEntry[];
}

// Representative ABI exercising the new SDK's (bool, T) tuple result shape:
// tuple types in inputs/outputs, nested components, and an event entry.
const sampleAbi: AbiEntry[] = [
    {
        type: "constructor",
        name: "new",
        inputs: [{ name: "owner", type: "address" }],
        outputs: [],
        stateMutability: "payable",
    },
    {
        type: "function",
        name: "get",
        inputs: [],
        outputs: [{ name: "", type: "(bool,u32)" }],
        stateMutability: "view",
    },
    {
        type: "function",
        name: "set_with_meta",
        inputs: [
            { name: "value", type: "(bool,u128)" },
            {
                name: "meta",
                type: "tuple",
                components: [
                    { name: "ok", type: "bool" },
                    { name: "payload", type: "(bool,string)" },
                ],
            },
        ],
        outputs: [{ name: "", type: "(bool,Result<u32,Error>)" }],
        stateMutability: "nonpayable",
    },
    {
        type: "event",
        name: "Set",
        inputs: [{ name: "by", type: "address" }],
        anonymous: false,
    },
];

const sampleMetadata: Metadata = {
    publish_block: 42,
    published_at: "2026-05-14T00:00:00Z",
    description: "Round-trip fixture",
    readme: "# Hi",
    authors: ["alice"],
    homepage: "https://example.com",
    repository: "https://example.com/repo",
    abi: sampleAbi,
};

describe("install round-trip preserves new-shape ABI", () => {
    let cdmRoot: string;
    let prevCdmRoot: string | undefined;

    beforeEach(() => {
        cdmRoot = mkdtempSync(resolve(tmpdir(), "cdm-install-roundtrip-"));
        prevCdmRoot = process.env.CDM_ROOT;
        process.env.CDM_ROOT = cdmRoot;
    });

    afterEach(() => {
        if (prevCdmRoot === undefined) delete process.env.CDM_ROOT;
        else process.env.CDM_ROOT = prevCdmRoot;
        rmSync(cdmRoot, { recursive: true, force: true });
    });

    test("publish encode is structurally identical after decode", () => {
        // Mirrors publisher.ts: JSON.stringify(metadata) + UTF-8 encode → bytes go
        // through Bulletin → identical bytes come back via the IPFS gateway.
        const encoded = new TextEncoder().encode(JSON.stringify(sampleMetadata));
        const decoded = new TextDecoder().decode(encoded);
        const parsed = JSON.parse(decoded);
        expect(parsed).toEqual(sampleMetadata);
    });

    test("install fetch → save → re-read preserves ABI structurally", () => {
        // Mirrors install-pipeline.ts: (await ipfs.fetch(cid)).json() then saveContract.
        const encoded = new TextEncoder().encode(JSON.stringify(sampleMetadata));
        const fetched = JSON.parse(new TextDecoder().decode(encoded)) as Record<string, unknown>;
        const fetchedAbi = fetched.abi as AbiEntry[];

        const savedPath = saveContract({
            library: "round_trip_fixture",
            version: 0,
            abi: fetchedAbi,
            metadata: fetched,
            address: "0x0000000000000000000000000000000000000001",
            metadataCid: "bafy-test-cid",
        });

        expect(savedPath).toBe(getContractDir("round_trip_fixture", 0));

        const rereadAbi = JSON.parse(readFileSync(resolve(savedPath, "abi.json"), "utf-8"));
        expect(rereadAbi).toEqual(sampleAbi);

        const rereadMeta = JSON.parse(readFileSync(resolve(savedPath, "metadata.json"), "utf-8"));
        expect(rereadMeta).toEqual(sampleMetadata);

        const info = JSON.parse(readFileSync(resolve(savedPath, "info.json"), "utf-8"));
        expect(info).toEqual({
            name: "round_trip_fixture",
            version: 0,
            address: "0x0000000000000000000000000000000000000001",
            metadataCid: "bafy-test-cid",
        });
    });
});
