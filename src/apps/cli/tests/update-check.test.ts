import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
    compareCdmVersions,
    formatUpdateWarning,
    readUpdateCheckCache,
    writeUpdateCheckCache,
} from "../src/lib/update-check";

describe("compareCdmVersions", () => {
    test("equal versions are current", () => {
        expect(compareCdmVersions("0.9.0", "v0.9.0")).toBe("current");
    });

    test("ahead of latest is current", () => {
        expect(compareCdmVersions("1.0.0", "v0.9.0")).toBe("current");
        expect(compareCdmVersions("0.9.1", "v0.9.0")).toBe("current");
    });

    test("patch and minor bumps are behind", () => {
        expect(compareCdmVersions("0.9.0", "v0.9.1")).toBe("behind");
        expect(compareCdmVersions("0.9.0", "v0.10.0")).toBe("behind");
    });

    test("major bump is major-behind", () => {
        expect(compareCdmVersions("0.9.0", "v1.0.0")).toBe("major-behind");
        expect(compareCdmVersions("1.2.3", "v3.0.0")).toBe("major-behind");
    });

    test("unparsable versions are treated as current", () => {
        expect(compareCdmVersions("dev", "v1.0.0")).toBe("current");
        expect(compareCdmVersions("0.9.0", "cdm-cli-dev-pr-58")).toBe("current");
    });
});

describe("formatUpdateWarning", () => {
    test("returns nothing when up to date", () => {
        expect(formatUpdateWarning("0.9.0", "v0.9.0")).toBeUndefined();
    });

    test("points at cdm update when behind", () => {
        const warning = formatUpdateWarning("0.9.0", "v0.9.1");
        expect(warning).toContain("v0.9.1");
        expect(warning).toContain("cdm update");
        expect(warning).not.toContain("stale");
    });

    test("warns about a stale registry when a major version behind", () => {
        const warning = formatUpdateWarning("0.9.0", "v1.0.0");
        expect(warning).toContain("MAJOR");
        expect(warning).toContain("stale CDM registry");
        expect(warning).toContain("cdm update");
    });
});

describe("update-check cache", () => {
    let dir: string | undefined;

    afterEach(() => {
        if (dir) rmSync(dir, { recursive: true, force: true });
        dir = undefined;
    });

    test("round-trips through the cache file", () => {
        dir = mkdtempSync(join(tmpdir(), "cdm-update-check-"));
        const path = join(dir, "nested", "update-check.json");
        expect(readUpdateCheckCache(path)).toBeUndefined();

        writeUpdateCheckCache({ latestTag: "v0.9.0", checkedAt: 1234 }, path);
        expect(readUpdateCheckCache(path)).toEqual({ latestTag: "v0.9.0", checkedAt: 1234 });
    });

    test("ignores corrupt cache contents", () => {
        dir = mkdtempSync(join(tmpdir(), "cdm-update-check-"));
        const path = join(dir, "update-check.json");
        writeUpdateCheckCache({ latestTag: "v0.9.0", checkedAt: 1234 }, path);
        expect(readUpdateCheckCache(path)).toBeDefined();

        writeFileSync(path, "not json");
        expect(readUpdateCheckCache(path)).toBeUndefined();
    });
});
