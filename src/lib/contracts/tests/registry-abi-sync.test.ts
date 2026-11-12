// Drift guard for the hand-embedded contract ABIs.
//
// `CONTRACTS_REGISTRY_ABI` / `CONTRACTS_EIP1967_PROXY_ABI` in
// `src/abi/registry.ts`, `CONTRACT_RESOLVER_ABI` in `src/abi/resolver.ts`,
// and `CREATE3_FACTORY_ABI` in `src/abi/create3-factory.ts` are hand-copied
// mirrors of the ABI arrays that `cargo pvm-contract build` writes to
// `target/release/*.abi.json`. This test deep-compares the
// constructor/function entries (name, input/output types and tuple
// structure, stateMutability) whenever the generated artifacts exist. Types,
// structure, order, and stateMutability are compared strictly;
// parameter/component NAMES are compared case-style-insensitively
// (snake_case normalized to camelCase) because the embedded ABI keeps the
// historical decode keys (`isSome`) where the generated JSON says `is_some`.
//
// The artifacts require the PolkaVM toolchain (`pnpm build:registry`): a
// local run without them skips, CI (which builds them before running this
// file) fails instead.

import { describe, test, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { AbiEntry, AbiParam } from "@parity/product-sdk-contracts";
import { CONTRACTS_REGISTRY_ABI, CONTRACTS_EIP1967_PROXY_ABI } from "../src/abi/registry";
import { CONTRACT_RESOLVER_ABI } from "../src/abi/resolver";
import { CREATE3_FACTORY_ABI } from "../src/abi/create3-factory";

const __dirname = dirname(fileURLToPath(import.meta.url));
const RELEASE_DIR = resolve(__dirname, "../../../../target/release");

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

/** Error + event entries, normalized, in ABI order. */
function nonCallableEntries(abi: AbiEntry[]): NormalizedEntry[] {
    return abi.filter((e) => e.type === "error" || e.type === "event").map(normalizeEntry);
}

function readGeneratedAbi(path: string): AbiEntry[] {
    // The registry artifacts wrap the array in `{ "abi": [...] }`; newer
    // cargo-pvm-contract builds (the create3 factory) emit the bare array.
    const parsed = JSON.parse(readFileSync(path, "utf8")) as { abi: AbiEntry[] } | AbiEntry[];
    return Array.isArray(parsed) ? parsed : parsed.abi;
}

const MIRRORS: { crate: string; abi: AbiEntry[]; frozen?: boolean }[] = [
    { crate: "contract-registry", abi: CONTRACTS_REGISTRY_ABI },
    { crate: "contract-eip1967-proxy", abi: CONTRACTS_EIP1967_PROXY_ABI },
    { crate: "contract-resolver", abi: CONTRACT_RESOLVER_ABI },
    // A frozen artifact `pnpm build:registry` never rebuilds, so its check
    // stays opportunistic.
    { crate: "create3-factory", abi: CREATE3_FACTORY_ABI, frozen: true },
];

for (const { crate, abi, frozen } of MIRRORS) {
    const artifact = resolve(RELEASE_DIR, `${crate}.abi.json`);
    const built = existsSync(artifact);

    describe(`${crate} ABI matches generated artifact`, () => {
        if (!built) {
            test.skipIf(!process.env.CI || frozen)("artifact is built", () => {
                throw new Error(`${artifact} is missing; run pnpm build:registry`);
            });
            return;
        }

        test("constructor/function entries are in sync", () => {
            expect(callableEntries(abi)).toEqual(callableEntries(readGeneratedAbi(artifact)));
        });

        test("error and event entries are in sync", () => {
            expect(nonCallableEntries(abi)).toEqual(nonCallableEntries(readGeneratedAbi(artifact)));
        });
    });
}
