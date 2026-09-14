// Drift guard for the hand-embedded contract ABIs.
//
// `CONTRACTS_REGISTRY_ABI` / `CONTRACTS_REGISTRY_PROXY_ABI` in
// `src/abi/registry.ts` and `CREATE3_FACTORY_ABI` in
// `src/abi/create3-factory.ts` are hand-copied mirrors of the ABI arrays that
// `cargo pvm-contract build` writes to `target/release/*.abi.json`. This test
// deep-compares the constructor/function entries (name, input/output types
// and tuple structure, stateMutability) whenever the generated artifacts
// exist, closing the historical hand-copy desync risk. Types, structure,
// order, and stateMutability are compared strictly; parameter/component
// NAMES are compared case-style-insensitively (snake_case normalized to
// camelCase) because the embedded ABI keeps the historical decode keys
// (`isSome`) where the generated JSON says `is_some`.
//
// Skips cleanly when the artifacts are absent (they require the PolkaVM
// toolchain via `pnpm build:registry`), so plain `pnpm test` stays
// binary-independent.

import { describe, test, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { AbiEntry, AbiParam } from "@parity/product-sdk-contracts";
import { CONTRACTS_REGISTRY_ABI, CONTRACTS_REGISTRY_PROXY_ABI } from "../src/abi/registry";
import { CREATE3_FACTORY_ABI } from "../src/abi/create3-factory";

const __dirname = dirname(fileURLToPath(import.meta.url));
const RELEASE_DIR = resolve(__dirname, "../../../../target/release");
const IMPL_ABI_JSON = resolve(RELEASE_DIR, "contract-registry.abi.json");
const PROXY_ABI_JSON = resolve(RELEASE_DIR, "contract-registry-proxy.abi.json");
const CREATE3_FACTORY_ABI_JSON = resolve(RELEASE_DIR, "create3-factory.abi.json");

interface NormalizedParam {
    name: string;
    type: string;
    components?: NormalizedParam[];
}

interface NormalizedEntry {
    type: string;
    name?: string;
    stateMutability?: string;
    inputs: NormalizedParam[];
    outputs: NormalizedParam[];
}

/** `is_some` → `isSome`; leaves already-camelCase names untouched. */
function toCamelCase(name: string): string {
    return name.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());
}

function normalizeParam(param: AbiParam): NormalizedParam {
    const out: NormalizedParam = { name: toCamelCase(param.name ?? ""), type: param.type };
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

/** Constructor + function entries, normalized, in ABI order. */
function callableEntries(abi: AbiEntry[]): NormalizedEntry[] {
    return abi.filter((e) => e.type === "function" || e.type === "constructor").map(normalizeEntry);
}

function readGeneratedAbi(path: string): AbiEntry[] {
    // The registry artifacts wrap the array in `{ "abi": [...] }`; newer
    // cargo-pvm-contract builds (the create3 factory) emit the bare array.
    const parsed = JSON.parse(readFileSync(path, "utf8")) as { abi: AbiEntry[] } | AbiEntry[];
    return Array.isArray(parsed) ? parsed : parsed.abi;
}

/** Error + event entries, normalized, in ABI order. */
function nonCallableEntries(abi: AbiEntry[]): NormalizedEntry[] {
    return abi.filter((e) => e.type === "error" || e.type === "event").map(normalizeEntry);
}

describe.skipIf(!existsSync(IMPL_ABI_JSON))("registry ABI matches generated artifact", () => {
    test("constructor/function entries are in sync", () => {
        const generated = readGeneratedAbi(IMPL_ABI_JSON);
        expect(callableEntries(CONTRACTS_REGISTRY_ABI)).toEqual(callableEntries(generated));
    });

    test("error and event entries are in sync", () => {
        const generated = readGeneratedAbi(IMPL_ABI_JSON);
        expect(nonCallableEntries(CONTRACTS_REGISTRY_ABI)).toEqual(nonCallableEntries(generated));
    });
});

describe.skipIf(!existsSync(PROXY_ABI_JSON))("proxy ABI matches generated artifact", () => {
    test("all entries are in sync", () => {
        const generated = readGeneratedAbi(PROXY_ABI_JSON);
        expect(CONTRACTS_REGISTRY_PROXY_ABI.map(normalizeEntry)).toEqual(
            generated.map(normalizeEntry),
        );
    });
});

describe.skipIf(!existsSync(CREATE3_FACTORY_ABI_JSON))(
    "CREATE3 factory ABI matches generated artifact",
    () => {
        test("constructor/function entries are in sync", () => {
            const generated = readGeneratedAbi(CREATE3_FACTORY_ABI_JSON);
            expect(callableEntries(CREATE3_FACTORY_ABI)).toEqual(callableEntries(generated));
        });

        test("error and event entries are in sync", () => {
            const generated = readGeneratedAbi(CREATE3_FACTORY_ABI_JSON);
            expect(nonCallableEntries(CREATE3_FACTORY_ABI)).toEqual(nonCallableEntries(generated));
        });
    },
);
