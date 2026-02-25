import { describe, test, expect } from "vitest";
import { execSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = join(__dirname, "../src/cli.ts");

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
        expect(output).toContain("--registry-address");
        expect(output).toContain("--assethub-url");
    });

    test("cdm template scaffolds project", () => {
        const tmpDir = mkdtempSync(join(tmpdir(), "cdm-test-"));
        try {
            execSync(`bun run ${CLI} template shared-counter ${tmpDir}`, {
                stdio: "pipe",
            });

            expect(existsSync(join(tmpDir, "Cargo.toml"))).toBe(true);
            expect(existsSync(join(tmpDir, "contracts/counter/lib.rs"))).toBe(true);
            expect(existsSync(join(tmpDir, "contracts/counter-writer/lib.rs"))).toBe(true);
            expect(existsSync(join(tmpDir, "contracts/counter-reader/lib.rs"))).toBe(true);
            expect(existsSync(join(tmpDir, "package.json"))).toBe(true);
            expect(existsSync(join(tmpDir, "src/index.ts"))).toBe(true);
        } finally {
            rmSync(tmpDir, { recursive: true, force: true });
        }
    });
});
