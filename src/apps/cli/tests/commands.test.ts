import { describe, test, expect } from "vitest";
import { execSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = join(__dirname, "../src/cli.ts");
const packageJson = JSON.parse(readFileSync(join(__dirname, "../package.json"), "utf-8")) as {
    version: string;
};

describe("CLI commands", () => {
    test("cdm --version shows the package version", () => {
        const output = execSync(`bun run ${CLI} --version`).toString().trim();
        expect(output).toBe(packageJson.version);
    });

    test("cdm --help shows all commands", () => {
        const output = execSync(`bun run ${CLI} --help`).toString();
        expect(output).toContain("build");
        expect(output).toContain("deploy");
        expect(output).toContain("install");
        expect(output).toContain("template");
        expect(output).toContain("init");
        expect(output).toContain("account");
        expect(output).toContain("setup");
        expect(output).toContain("update");
    });

    test("cdm build --help shows options", () => {
        const output = execSync(`bun run ${CLI} build --help`).toString();
        expect(output).toContain("--contracts");
        expect(output).toContain("--root");
        expect(output).toContain("--features");
        expect(output).toContain("--registry-address");
    });

    test("cdm deploy --help shows options", () => {
        const output = execSync(`bun run ${CLI} deploy --help`).toString();
        expect(output).toContain("--suri");
        expect(output).toContain("--bootstrap");
        expect(output).toContain("--features");
        expect(output).toContain("--registry-address");
    });

    test("cdm install --help shows options", () => {
        const output = execSync(`bun run ${CLI} install --help`).toString();
        expect(output).toContain("--assethub-url");
        expect(output).toContain("--name");
        expect(output).toContain("--registry-address");
    });

    test("cdm setup --help shows options", () => {
        const output = execSync(`bun run ${CLI} setup --help`).toString();
        expect(output).toContain("--check");
        expect(output).toContain("--cargo-pvm-contract-ref");
    });

    test("cdm update --help shows options", () => {
        const output = execSync(`bun run ${CLI} update --help`).toString();
        expect(output).toContain("--tag");
        expect(output).toContain("--skip-setup");
        expect(output).toContain("--cargo-pvm-contract-ref");
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
