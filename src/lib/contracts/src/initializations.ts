import { existsSync, readdirSync } from "fs";
import { basename, join } from "path";
import { keyToSemver, semverToKey } from "./proxy";

/**
 * Initializations: version-addressed contracts that run exactly once, inside
 * the name's per-name proxy storage, in the same transaction that publishes
 * their version.
 *
 * A contract project declares them under an `initializations/` directory next
 * to the contract source — `initializations/1.3.0.rs` (or `.sol`) runs when
 * version 1.3.0 is published. Publishing a version with no matching file is a
 * plain publish; a file for an already-published version is inert forever.
 * This module owns the shared plumbing: strict version-addressed filename
 * parsing, matching a publish against the file set, and the storage-layout
 * guard that refuses to deploy an initialization whose layout drifted from
 * the contract it initializes.
 */

/** Directory name that holds a contract's initializations. */
export const INITIALIZATIONS_DIR = "initializations";

/** One version-addressed initialization source file. */
export interface InitializationFile {
    /** Canonical `X.Y.Z` (normalized — `01.2.3.rs` parses but is an error). */
    version: string;
    /** Packed semver key of `version`. */
    key: bigint;
    /** Absolute path to the source file. */
    path: string;
}

/**
 * List a contract's initialization files: every `<dir>/initializations/*.{ext}`
 * with a strict `X.Y.Z` basename. Files with other extensions (readmes, etc.)
 * are ignored; a file with the language's extension but a malformed or
 * duplicate version is a configuration error worth failing the whole run for.
 *
 * This is the Rust projection of the one addressing rule — an initialization
 * is addressed by (contract, version), and for Rust the crate names the
 * contract, so the version files sit directly under the crate's
 * `initializations/`. Solidity's projection nests a per-contract directory
 * instead (see `solidity.ts`), scanned with
 * {@link listVersionAddressedFiles} directly.
 */
export function listInitializationFiles(
    contractDir: string,
    extension: ".rs" | ".sol",
): InitializationFile[] {
    return listVersionAddressedFiles(join(contractDir, INITIALIZATIONS_DIR), extension);
}

/**
 * Scan one directory (non-recursively) for strict `X.Y.Z{ext}` version files.
 * The per-contract scope: for Rust this is `<crate>/initializations/`, for
 * Solidity `initializations/<ContractName>/`.
 */
export function listVersionAddressedFiles(
    dir: string,
    extension: ".rs" | ".sol",
): InitializationFile[] {
    if (!existsSync(dir)) return [];

    const files: InitializationFile[] = [];
    const byVersion = new Map<string, string>();
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
        a.name.localeCompare(b.name),
    )) {
        if (!entry.isFile() || !entry.name.endsWith(extension)) continue;
        const raw = basename(entry.name, extension);
        let key: bigint;
        try {
            key = semverToKey(raw);
        } catch {
            throw new Error(
                `Malformed initialization filename "${entry.name}" in ${dir} — ` +
                    `initializations are version-addressed: name the file exactly ` +
                    `"X.Y.Z${extension}" for the version it initializes.`,
            );
        }
        const version = keyToSemver(key);
        if (raw !== version) {
            throw new Error(
                `Malformed initialization filename "${entry.name}" in ${dir} — ` +
                    `use the canonical "${version}${extension}".`,
            );
        }
        // Canonical-only spellings make same-version duplicates impossible
        // within one directory, but keep the guard for defense in depth.
        const previous = byVersion.get(version);
        if (previous) {
            throw new Error(
                `Duplicate initialization for version ${version} in ${dir}: ` +
                    `${previous} and ${entry.name}.`,
            );
        }
        byVersion.set(version, entry.name);
        files.push({ version, key, path: join(dir, entry.name) });
    }
    return files;
}

/** How a publish at `publishKey` relates to a contract's initialization files. */
export interface InitializationMatch {
    /** The file addressed to exactly the version being published, if any. */
    match?: InitializationFile;
    /**
     * Files addressed to versions HIGHER than the one being published —
     * likely a typo or a forgotten version bump, worth a warning. Files for
     * versions at or below the published one are inert by design and are not
     * reported.
     */
    orphans: InitializationFile[];
}

/** Split `files` into the one that fires at `publishKey` and future-dated orphans. */
export function matchInitialization(
    files: InitializationFile[],
    publishKey: bigint,
): InitializationMatch {
    return {
        match: files.find((file) => file.key === publishKey),
        orphans: files.filter((file) => file.key > publishKey),
    };
}

// ─── Storage-layout guard ────────────────────────────────────────────────────

/** One solc-format storage layout row (Rust artifacts emit the same shape). */
interface StorageLayoutEntry {
    label?: unknown;
    offset?: unknown;
    slot?: unknown;
    type?: unknown;
}

export type LayoutComparison =
    | { status: "match" }
    | { status: "mismatch"; problems: string[] }
    /** No layout data on one or both sides — verification impossible. */
    | { status: "unverifiable"; reason: string };

function layoutEntries(layout: unknown): StorageLayoutEntry[] | undefined {
    if (!layout || typeof layout !== "object" || Array.isArray(layout)) return undefined;
    const storage = (layout as { storage?: unknown }).storage;
    return Array.isArray(storage) ? (storage as StorageLayoutEntry[]) : undefined;
}

function describeEntry(entry: StorageLayoutEntry): string {
    return `${String(entry.label ?? "<unnamed>")} (slot ${String(entry.slot)}, offset ${String(
        entry.offset,
    )}, ${String(entry.type)})`;
}

/**
 * Compare the implementation's storage layout against its initialization's.
 * Placement is what matters — `slot`, `offset`, and `type` must agree row by
 * row; labels are decode-side names only (a Rust wrapper field may differ),
 * so they appear in problems but never fail the comparison alone.
 *
 * Both layouts absent (or malformed) → `unverifiable`; the caller must warn
 * loudly rather than proceed silently.
 */
export function compareStorageLayouts(implLayout: unknown, initLayout: unknown): LayoutComparison {
    const impl = layoutEntries(implLayout);
    const init = layoutEntries(initLayout);
    if (!impl && !init) {
        return { status: "unverifiable", reason: "neither artifact carries a storage layout" };
    }
    if (!impl) {
        return {
            status: "unverifiable",
            reason: "the implementation artifact carries no storage layout",
        };
    }
    if (!init) {
        return {
            status: "unverifiable",
            reason: "the initialization artifact carries no storage layout",
        };
    }

    const problems: string[] = [];
    if (impl.length !== init.length) {
        problems.push(
            `the implementation declares ${impl.length} storage field(s), ` +
                `the initialization ${init.length}`,
        );
    }
    for (let i = 0; i < Math.min(impl.length, init.length); i++) {
        const a = impl[i];
        const b = init[i];
        if (
            String(a.slot) !== String(b.slot) ||
            Number(a.offset ?? 0) !== Number(b.offset ?? 0) ||
            String(a.type) !== String(b.type)
        ) {
            problems.push(
                `field ${i}: implementation has ${describeEntry(a)}, ` +
                    `initialization has ${describeEntry(b)}`,
            );
        }
    }
    return problems.length > 0 ? { status: "mismatch", problems } : { status: "match" };
}

// ─── In-source tests ─────────────────────────────────────────────────────────

if (import.meta.vitest) {
    const { afterEach, describe, expect, it } = import.meta.vitest;
    const { mkdtempSync, mkdirSync, rmSync, writeFileSync } = await import("fs");
    const { tmpdir } = await import("os");
    const { packVersionKey } = await import("./proxy");

    let tmpRoot: string | null = null;

    function makeContractDir(files: string[]): string {
        tmpRoot = mkdtempSync(join(tmpdir(), "cdm-initializations-test-"));
        const dir = join(tmpRoot, INITIALIZATIONS_DIR);
        mkdirSync(dir);
        for (const name of files) writeFileSync(join(dir, name), "// initialization\n");
        return tmpRoot;
    }

    afterEach(() => {
        if (tmpRoot) rmSync(tmpRoot, { recursive: true, force: true });
        tmpRoot = null;
    });

    describe("listInitializationFiles", () => {
        it("returns an empty list when the directory does not exist", () => {
            tmpRoot = mkdtempSync(join(tmpdir(), "cdm-initializations-test-"));
            expect(listInitializationFiles(tmpRoot, ".rs")).toEqual([]);
        });

        it("parses version-addressed filenames and ignores other extensions", () => {
            const dir = makeContractDir(["0.1.0.rs", "1.2.3.rs", "README.md"]);
            const files = listInitializationFiles(dir, ".rs");
            expect(files.map((f) => f.version)).toEqual(["0.1.0", "1.2.3"]);
            expect(files[1].key).toBe(packVersionKey(1, 2, 3));
            expect(files[0].path.endsWith("initializations/0.1.0.rs")).toBe(true);
        });

        it("errors on malformed filenames", () => {
            const dir = makeContractDir(["1.2.rs"]);
            expect(() => listInitializationFiles(dir, ".rs")).toThrow(/version-addressed/);
        });

        it("errors on non-canonical version spellings", () => {
            const dir = makeContractDir(["01.2.3.sol"]);
            expect(() => listInitializationFiles(dir, ".sol")).toThrow(/canonical "1\.2\.3\.sol"/);
        });

        it("rejects the v-prefix spelling", () => {
            const dir = makeContractDir(["v1.2.3.rs"]);
            expect(() => listInitializationFiles(dir, ".rs")).toThrow(/canonical "1\.2\.3\.rs"/);
        });
    });

    describe("matchInitialization", () => {
        const files = [
            { version: "0.1.0", key: packVersionKey(0, 1, 0), path: "/x/0.1.0.rs" },
            { version: "0.2.0", key: packVersionKey(0, 2, 0), path: "/x/0.2.0.rs" },
            { version: "0.3.0", key: packVersionKey(0, 3, 0), path: "/x/0.3.0.rs" },
        ];

        it("matches the exact published version and flags higher versions as orphans", () => {
            const { match, orphans } = matchInitialization(files, packVersionKey(0, 2, 0));
            expect(match?.version).toBe("0.2.0");
            expect(orphans.map((f) => f.version)).toEqual(["0.3.0"]);
        });

        it("treats files at or below the published version as inert, not orphans", () => {
            const { match, orphans } = matchInitialization(files, packVersionKey(0, 4, 0));
            expect(match).toBeUndefined();
            expect(orphans).toEqual([]);
        });
    });

    describe("compareStorageLayouts", () => {
        const layout = (rows: Array<[string, number | string, number, string]>) => ({
            storage: rows.map(([label, slot, offset, type]) => ({
                label,
                slot: String(slot),
                offset,
                type,
            })),
        });

        it("matches identical placements even when labels differ", () => {
            const impl = layout([
                ["s.count", 0, 0, "uint32"],
                ["s.owner", 0, 4, "address"],
            ]);
            const init = layout([
                ["storage.count", 0, 0, "uint32"],
                ["storage.owner", 0, 4, "address"],
            ]);
            expect(compareStorageLayouts(impl, init)).toEqual({ status: "match" });
        });

        it("flags slot, offset, and type drift", () => {
            const impl = layout([["count", 0, 0, "uint32"]]);
            const init = layout([["count", 0, 0, "uint64"]]);
            const result = compareStorageLayouts(impl, init);
            expect(result.status).toBe("mismatch");
            if (result.status === "mismatch") {
                expect(result.problems[0]).toContain("uint32");
                expect(result.problems[0]).toContain("uint64");
            }
        });

        it("flags differing field counts", () => {
            const impl = layout([["count", 0, 0, "uint32"]]);
            const init = layout([
                ["count", 0, 0, "uint32"],
                ["extra", 1, 0, "uint256"],
            ]);
            const result = compareStorageLayouts(impl, init);
            expect(result.status).toBe("mismatch");
            if (result.status === "mismatch") {
                expect(result.problems[0]).toContain("1 storage field");
            }
        });

        it("reports missing layout data as unverifiable, naming the side", () => {
            const impl = layout([["count", 0, 0, "uint32"]]);
            expect(compareStorageLayouts(impl, undefined)).toEqual({
                status: "unverifiable",
                reason: "the initialization artifact carries no storage layout",
            });
            expect(compareStorageLayouts(undefined, impl)).toEqual({
                status: "unverifiable",
                reason: "the implementation artifact carries no storage layout",
            });
            expect(compareStorageLayouts(undefined, undefined).status).toBe("unverifiable");
        });
    });
}
