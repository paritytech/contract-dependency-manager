import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import { join, relative, resolve } from "path";
import { blake2b } from "@noble/hashes/blake2.js";
import type { ContractInfo } from "./detection";
import { collectLocalSoliditySources } from "./solidity";

/**
 * Deterministic digest over a contract's SOURCE inputs, published in the
 * metadata as `source_hash` so `cdm deploy` can warn when an `up-to-date`
 * crate's local sources no longer match what was published (the classic
 * edit-the-code-forget-to-bump mistake).
 *
 * Deliberately a source hash, NOT a bytecode hash: PolkaVM output is
 * sensitive to the rustc / cargo-pvm-contract / SDK-revision combination, so
 * a bytecode comparison would fire on every toolchain skew across a team.
 * Hashing the inputs instead is toolchain-independent by construction.
 */

interface SourceFile {
    /** Digest key — root-relative, `/`-separated, so renames change the hash. */
    relPath: string;
    absPath: string;
}

function normalizePath(path: string): string {
    return path.replace(/\\/g, "/");
}

function bytesToHex(bytes: Uint8Array): string {
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Fold a file set into one digest: files sorted by `relPath` (so collection
 * order never matters), each contributing `blake2b-256(relPath \0 content)` —
 * the per-file pre-hash keeps file boundaries unambiguous in the outer hash.
 */
function hashFileSet(files: SourceFile[]): string | undefined {
    if (files.length === 0) return undefined;
    const outer = blake2b.create({ dkLen: 32 });
    const sorted = [...files].sort((a, b) => (a.relPath < b.relPath ? -1 : 1));
    for (const file of sorted) {
        const inner = blake2b.create({ dkLen: 32 });
        inner.update(new TextEncoder().encode(`${file.relPath}\0`));
        inner.update(readFileSync(file.absPath));
        outer.update(inner.digest());
    }
    return `0x${bytesToHex(outer.digest())}`;
}

function walkFiles(dir: string): string[] {
    const out: string[] = [];
    for (const name of readdirSync(dir)) {
        const abs = join(dir, name);
        const stat = statSync(abs);
        if (stat.isDirectory()) out.push(...walkFiles(abs));
        else if (stat.isFile()) out.push(abs);
    }
    return out;
}

/**
 * A contract's source hash, or `undefined` when its inputs can't be resolved
 * or read. Best-effort by design — a missing hash must never break a build,
 * publish, or deploy; the metadata simply omits `source_hash`.
 *
 * File sets:
 *  - Rust crates: the crate's `Cargo.toml` plus every file under its `src/`,
 *    recursively. Paths are hashed crate-relative, so a crate can move within
 *    the workspace without changing its digest.
 *  - Solidity targets: the target's source file plus every relatively-imported
 *    local `.sol` file ({@link collectLocalSoliditySources}), hashed
 *    project-root-relative. Remapped/library imports are not followed.
 */
export function computeSourceHash(rootDir: string, contract: ContractInfo): string | undefined {
    try {
        if (contract.toolchain === "foundry" || contract.toolchain === "hardhat") {
            const sourcePath = (contract as { sourcePath?: string }).sourcePath;
            if (!sourcePath) return undefined;
            return hashFileSet(
                collectLocalSoliditySources(rootDir, sourcePath).map((absPath) => ({
                    absPath,
                    relPath: normalizePath(relative(rootDir, absPath)),
                })),
            );
        }

        const crateDir = contract.path;
        if (!crateDir) return undefined;
        const files: SourceFile[] = [];
        const manifestPath = join(crateDir, "Cargo.toml");
        if (existsSync(manifestPath)) {
            files.push({ absPath: manifestPath, relPath: "Cargo.toml" });
        }
        const srcDir = join(crateDir, "src");
        if (existsSync(srcDir)) {
            for (const absPath of walkFiles(srcDir)) {
                files.push({ absPath, relPath: normalizePath(relative(crateDir, absPath)) });
            }
        }
        return hashFileSet(files);
    } catch {
        // Unreadable inputs (races, permissions, exotic layouts) publish no
        // hash rather than failing the pipeline.
        return undefined;
    }
}

if (import.meta.vitest) {
    const { describe, test, expect } = import.meta.vitest;
    const { mkdtempSync, mkdirSync, writeFileSync, renameSync, rmSync } = await import("fs");
    const { tmpdir } = await import("os");

    function makeCrate(files: Record<string, string>): { root: string; contract: ContractInfo } {
        const root = mkdtempSync(join(tmpdir(), "cdm-source-hash-"));
        const crateDir = join(root, "crates", "counter");
        for (const [rel, content] of Object.entries(files)) {
            const abs = join(crateDir, rel);
            mkdirSync(resolve(abs, ".."), { recursive: true });
            writeFileSync(abs, content);
        }
        return {
            root,
            contract: {
                name: "counter",
                version: "0.1.0",
                cdmPackage: "@example/counter",
                description: null,
                authors: [],
                homepage: null,
                repository: null,
                readmePath: null,
                path: crateDir,
                dependsOnCrates: [],
            },
        };
    }

    const crateFiles = {
        "Cargo.toml": '[package]\nname = "counter"\nversion = "0.1.0"\n',
        "src/main.rs": "fn main() {}\n",
        "src/lib/util.rs": "pub fn util() {}\n",
    };

    describe("computeSourceHash", () => {
        test("is deterministic and independent of file write order", () => {
            const a = makeCrate(crateFiles);
            const reversed = Object.fromEntries(Object.entries(crateFiles).reverse());
            const b = makeCrate(reversed);
            try {
                const hashA = computeSourceHash(a.root, a.contract);
                const hashB = computeSourceHash(b.root, b.contract);
                expect(hashA).toMatch(/^0x[0-9a-f]{64}$/);
                expect(hashA).toBe(hashB);
                // Same digest on recompute from the same tree.
                expect(computeSourceHash(a.root, a.contract)).toBe(hashA);
            } finally {
                rmSync(a.root, { recursive: true, force: true });
                rmSync(b.root, { recursive: true, force: true });
            }
        });

        test("changes when any source file's content changes", () => {
            const a = makeCrate(crateFiles);
            try {
                const before = computeSourceHash(a.root, a.contract);
                writeFileSync(join(a.contract.path, "src/main.rs"), "fn main() { /* edited */ }\n");
                expect(computeSourceHash(a.root, a.contract)).not.toBe(before);
            } finally {
                rmSync(a.root, { recursive: true, force: true });
            }
        });

        test("changes when a file is renamed, even with identical content", () => {
            const a = makeCrate(crateFiles);
            try {
                const before = computeSourceHash(a.root, a.contract);
                renameSync(
                    join(a.contract.path, "src/lib/util.rs"),
                    join(a.contract.path, "src/lib/helpers.rs"),
                );
                expect(computeSourceHash(a.root, a.contract)).not.toBe(before);
            } finally {
                rmSync(a.root, { recursive: true, force: true });
            }
        });

        test("is stable across crate directory moves (paths hashed crate-relative)", () => {
            const a = makeCrate(crateFiles);
            const b = makeCrate(crateFiles);
            try {
                const movedDir = join(b.root, "elsewhere", "counter");
                mkdirSync(resolve(movedDir, ".."), { recursive: true });
                renameSync(b.contract.path, movedDir);
                expect(computeSourceHash(b.root, { ...b.contract, path: movedDir })).toBe(
                    computeSourceHash(a.root, a.contract),
                );
            } finally {
                rmSync(a.root, { recursive: true, force: true });
                rmSync(b.root, { recursive: true, force: true });
            }
        });

        test("returns undefined when the crate has no readable sources", () => {
            const a = makeCrate(crateFiles);
            try {
                expect(
                    computeSourceHash(a.root, { ...a.contract, path: join(a.root, "missing") }),
                ).toBeUndefined();
                expect(computeSourceHash(a.root, { ...a.contract, path: "" })).toBeUndefined();
            } finally {
                rmSync(a.root, { recursive: true, force: true });
            }
        });

        test("hashes a Solidity target's source and its relative imports", () => {
            const root = mkdtempSync(join(tmpdir(), "cdm-source-hash-sol-"));
            const write = (rel: string, content: string) => {
                const abs = join(root, rel);
                mkdirSync(resolve(abs, ".."), { recursive: true });
                writeFileSync(abs, content);
            };
            const solContract = (): ContractInfo & { sourcePath: string } => ({
                name: "Counter",
                toolchain: "foundry",
                cdmPackage: "@example/counter",
                description: null,
                authors: [],
                homepage: null,
                repository: null,
                readmePath: null,
                path: join(root, "src"),
                dependsOnCrates: [],
                sourcePath: join(root, "src", "Counter.sol"),
            });
            try {
                write("src/Counter.sol", 'import "./lib/Math.sol";\ncontract Counter {}\n');
                write("src/lib/Math.sol", "library Math {}\n");
                const before = computeSourceHash(root, solContract());
                expect(before).toMatch(/^0x[0-9a-f]{64}$/);
                // Editing a transitively-imported file changes the digest.
                write("src/lib/Math.sol", "library Math { uint256 constant ONE = 1; }\n");
                expect(computeSourceHash(root, solContract())).not.toBe(before);
            } finally {
                rmSync(root, { recursive: true, force: true });
            }
        });
    });
}
