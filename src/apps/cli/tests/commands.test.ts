import { describe, test, expect } from "bun:test";
import { execSync } from "child_process";
import { existsSync, mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const CLI = join(import.meta.dir, "../src/cli.ts");

describe("CLI commands", () => {
    test("cdm --help shows all 4 commands", () => {
        const output = execSync(`bun run ${CLI} --help`).toString();
        expect(output).toContain("build");
        expect(output).toContain("deploy");
        expect(output).toContain("install");
        expect(output).toContain("template");
    });

    test("cdm build --help shows options", () => {
        const output = execSync(`bun run ${CLI} build --help`).toString();
        expect(output).toContain("--contracts");
        expect(output).toContain("--root");
    });

    test("cdm deploy --help shows options", () => {
        const output = execSync(`bun run ${CLI} deploy --help`).toString();
        expect(output).toContain("--suri");
        expect(output).toContain("--bootstrap");
        expect(output).toContain("--bootstrap");
    });

    test("cdm install --help shows options", () => {
        const output = execSync(`bun run ${CLI} install --help`).toString();
        expect(output).toContain("--registry");
        expect(output).toContain("--url");
    });

    test("cdm template scaffolds project", () => {
        const tmpDir = mkdtempSync(join(tmpdir(), "cdm-test-"));
        try {
            execSync(`bun run ${CLI} template shared-counter ${tmpDir}`, { stdio: "pipe" });

            expect(existsSync(join(tmpDir, "Cargo.toml"))).toBe(true);
            expect(existsSync(join(tmpDir, "contracts/counter/lib.rs"))).toBe(true);
            expect(existsSync(join(tmpDir, "contracts/counter-writer/lib.rs"))).toBe(true);
            expect(existsSync(join(tmpDir, "contracts/counter-reader/lib.rs"))).toBe(true);
            expect(existsSync(join(tmpDir, "ts/package.json"))).toBe(true);
            expect(existsSync(join(tmpDir, "ts/src/validate.ts"))).toBe(true);
        } finally {
            rmSync(tmpDir, { recursive: true, force: true });
        }
    });
});
