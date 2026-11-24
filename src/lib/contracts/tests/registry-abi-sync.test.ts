// Drift guard for the hand-embedded registry and resolver ABIs.
//
// `CONTRACTS_REGISTRY_ABI` in `src/abi/registry.ts` and `CONTRACT_RESOLVER_ABI`
// in `src/abi/resolver.ts` are hand-copied mirrors of the ABIs forge writes
// for `Registry.sol` and `Resolver.sol`. This test compares every entry
// (kind, name, input/output types and tuple structure, parameter names,
// stateMutability) whenever the artifacts exist. Names are compared
// case-style-insensitively (snake_case normalized to camelCase): the mirrors
// keep `version_key`-style decode keys that their consumers read. Order is
// not compared: solc sorts its ABI, the mirrors keep reading order.
//
// The artifacts require forge (`pnpm build:registry`): a local run without
// them skips, CI (which builds them before running this file) fails instead.

import { describe, test, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { AbiEntry, AbiParam } from "@parity/product-sdk-contracts";
import { CONTRACTS_REGISTRY_ABI } from "../src/abi/registry";
import { CONTRACT_RESOLVER_ABI } from "../src/abi/resolver";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(__dirname, "../../../../src/contract/solidity/out");

/**
 * Component names the Solidity source cannot spell, mapped to the names the
 * mirrors keep for their consumers.
 */
const SOLIDITY_NAMES: Record<string, string> = { addr: "address", isSealed: "sealed" };

interface NormalizedParam {
    name: string;
    type: string;
    indexed?: boolean;
    components?: NormalizedParam[];
}

interface NormalizedEntry {
    type: string;
    name?: string;
    stateMutability?: string;
    inputs: NormalizedParam[];
    outputs: NormalizedParam[];
}

type Param = AbiParam & { indexed?: boolean };

/** `is_some` → `isSome`; leaves already-camelCase names untouched. */
function toCamelCase(name: string): string {
    return name.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());
}

function normalizeParam(param: Param): NormalizedParam {
    const name = param.name ?? "";
    const out: NormalizedParam = {
        name: toCamelCase(SOLIDITY_NAMES[name] ?? name),
        type: param.type,
    };
    if (param.indexed !== undefined) out.indexed = param.indexed;
    if (param.components) out.components = param.components.map(normalizeParam);
    return out;
}

function normalizeEntry(entry: AbiEntry): NormalizedEntry {
    return {
        type: entry.type,
        name: entry.name,
        stateMutability: entry.stateMutability,
        inputs: (entry.inputs ?? []).map(normalizeParam),
        outputs: (entry.outputs ?? []).map(normalizeParam),
    };
}

/** Every entry, normalized and in one canonical order. */
function entries(abi: AbiEntry[]): NormalizedEntry[] {
    const key = (entry: NormalizedEntry) =>
        `${entry.type}:${entry.name ?? ""}(${entry.inputs.map((input) => input.type).join(",")})`;
    return abi.map(normalizeEntry).sort((a, b) => key(a).localeCompare(key(b)));
}

const MIRRORS: { contract: string; abi: AbiEntry[] }[] = [
    { contract: "Registry", abi: CONTRACTS_REGISTRY_ABI },
    { contract: "Resolver", abi: CONTRACT_RESOLVER_ABI },
];

for (const { contract, abi } of MIRRORS) {
    const artifact = resolve(OUT_DIR, `${contract}.sol/${contract}.json`);

    describe(`${contract} ABI matches forge's artifact`, () => {
        if (!existsSync(artifact)) {
            test.skipIf(!process.env.CI)("artifact is built", () => {
                throw new Error(`${artifact} is missing; run pnpm build:registry`);
            });
            return;
        }

        test("every entry is in sync", () => {
            const built = (JSON.parse(readFileSync(artifact, "utf8")) as { abi: AbiEntry[] }).abi;
            expect(entries(abi)).toEqual(entries(built));
        });
    });
}
