import { existsSync, readdirSync } from "fs";
import { basename, join } from "path";
import { keyToSemver, semverToKey } from "./proxy";

/**
 * Initializations: version-addressed contracts (`initializations/1.3.0.rs|.sol`)
 * that run exactly once, in the proxy's storage, inside the publish of their
 * version. Filename parsing, publish matching, and the storage-layout guard.
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

/** `<contractDir>/initializations/X.Y.Z{ext}`. */
export function listInitializationFiles(
    contractDir: string,
    extension: ".rs" | ".sol",
): InitializationFile[] {
    return listVersionAddressedFiles(join(contractDir, INITIALIZATIONS_DIR), extension);
}

/**
 * Strict `X.Y.Z{ext}` files directly in `dir`; other extensions are ignored,
 * a malformed version with the right extension throws.
 */
export function listVersionAddressedFiles(
    dir: string,
    extension: ".rs" | ".sol",
): InitializationFile[] {
    if (!existsSync(dir)) return [];

    const files: InitializationFile[] = [];
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
        a.name.localeCompare(b.name),
    )) {
        if (!entry.isFile() || !entry.name.endsWith(extension)) continue;
        const raw = basename(entry.name, extension);
        // Canonical spelling only, so a version cannot appear twice.
        let key: bigint | undefined;
        try {
            key = semverToKey(raw);
        } catch {}
        if (key === undefined || raw !== keyToSemver(key)) {
            throw new Error(
                `Malformed initialization filename "${entry.name}" in ${dir} — ` +
                    `initializations are version-addressed: "X.Y.Z${extension}".`,
            );
        }
        files.push({ version: raw, key, path: join(dir, entry.name) });
    }
    return files;
}

/** How a publish at `publishKey` relates to a contract's initialization files. */
export interface InitializationMatch {
    /** The file addressed to exactly the version being published, if any. */
    match?: InitializationFile;
    /** Files addressed above the published version (likely a forgotten bump); lower ones are inert. */
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

/** `slot`, `offset`, and `type` must agree row by row; labels never fail the comparison. */
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

        it("errors on malformed or non-canonical filenames", () => {
            for (const name of ["1.2.rs", "01.2.3.rs", "v1.2.3.rs"]) {
                const dir = makeContractDir([name]);
                expect(() => listInitializationFiles(dir, ".rs")).toThrow(/version-addressed/);
                rmSync(dir, { recursive: true, force: true });
                tmpRoot = null;
            }
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
