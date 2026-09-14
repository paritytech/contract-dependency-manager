import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const script = resolve("src/lib/scripts/deploy-frontend.sh");
let fixture: string;
let log: string;

beforeEach(() => {
    fixture = mkdtempSync(join(tmpdir(), "cdm-deploy-test-"));
    log = join(fixture, "calls.jsonl");
    for (const command of ["npm", "pnpm", "polkadot-app-deploy"]) {
        writeFileSync(
            join(fixture, command),
            `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.TEST_LOG, JSON.stringify({ command: ${JSON.stringify(command)}, args }) + '\\n');
if (args[0] === '--version') console.log('polkadot-app-deploy v' + (process.env.TEST_VERSION || '0.16.1'));
if (${JSON.stringify(command)} === process.env.TEST_FAIL) process.exit(7);
`,
            { mode: 0o755 },
        );
    }
});
afterEach(() => rmSync(fixture, { recursive: true, force: true }));

function run(args: string[], overrides: Record<string, string> = {}) {
    return spawnSync("bash", [script, ...args], {
        encoding: "utf8",
        env: {
            PATH: `${fixture}:${process.env.PATH}`,
            HOME: fixture,
            TEST_LOG: log,
            ...overrides,
        },
    });
}
function calls() {
    try {
        return readFileSync(log, "utf8")
            .trim()
            .split("\n")
            .map((line) => JSON.parse(line) as { command: string; args: string[] });
    } catch {
        return [];
    }
}

describe("frontend deployment wrapper", () => {
    it.each([
        ["paseo-next-v2", "contracts.paseo"],
        ["devnet", "contracts.dot"],
    ])("previews %s without credentials or subprocesses", (environment, domain) => {
        const result = run(["--dry-run"], { APP_DEPLOY_ENV: environment });
        expect(result.status).toBe(0);
        expect(result.stdout).toContain(`Domain: ${domain}`);
        expect(calls()).toEqual([]);
    });
    it.each(["summit", "w3s", " devnet", "DEVNET"])(
        "rejects unsupported target %s before doing work",
        (environment) => {
            expect(run(["test-only-mnemonic"], { APP_DEPLOY_ENV: environment }).status).toBe(1);
            expect(calls()).toEqual([]);
        },
    );
    it("installs the pinned CLI, builds, then deploys with the explicit direct signer", () => {
        const result = run(["test-only-mnemonic", "--tag", "frontend"]);
        expect(result.status).toBe(0);
        expect(calls()).toEqual([
            { command: "npm", args: ["install", "-g", "@parity/polkadot-app-deploy@0.16.1"] },
            { command: "polkadot-app-deploy", args: ["--version"] },
            { command: "pnpm", args: ["turbo", "build", "--filter=@parity/cdm-frontend"] },
            {
                command: "polkadot-app-deploy",
                args: [
                    "--env",
                    "paseo-next-v2",
                    "--mnemonic",
                    "test-only-mnemonic",
                    resolve("src/apps/frontend/dist"),
                    "contracts.paseo",
                    "--tag",
                    "frontend",
                ],
            },
        ]);
    });
    it("uses the devnet domain and supports a preinstalled pinned binary", () => {
        expect(
            run(["test-only-mnemonic"], { APP_DEPLOY_ENV: "devnet", SKIP_APP_DEPLOY_INSTALL: "1" })
                .status,
        ).toBe(0);
        expect(calls().some((call) => call.command === "npm")).toBe(false);
        expect(calls().at(-1)?.args).toContain("contracts.dot");
    });
    it("normalizes an equals tag to the CLI's two-argument grammar", () => {
        expect(run(["test-only-mnemonic", "--tag=frontend", "--js-merkle"]).status).toBe(0);
        expect(calls().at(-1)?.args.slice(-3)).toEqual(["--tag", "frontend", "--js-merkle"]);
    });
    it("rejects a mismatched installed version before building", () => {
        expect(
            run(["test-only-mnemonic"], { SKIP_APP_DEPLOY_INSTALL: "1", TEST_VERSION: "0.10.0" })
                .status,
        ).toBe(1);
        expect(calls()).toHaveLength(1);
    });
    it.each(["DOTNS_RPC", "DOTNS_KEY_URI", "PAD_ENV_FILE", "BULLETIN_RPC", "IPFS_CID"])(
        "rejects inherited %s without exposing it",
        (key) => {
            const result = run(["test-only-mnemonic"], { [key]: "sensitive-test-value" });
            expect(result.status).toBe(1);
            expect(result.stderr).not.toContain("sensitive-test-value");
            expect(calls()).toEqual([]);
        },
    );
    it.each([
        "--env",
        "--env=devnet",
        "--mnemonic=other",
        "--suri=//Alice",
        "--config=other.json",
        "--rpc=other",
        "--environment-file=other.json",
        "--contract=other",
        "--derivation-path=//other",
    ])("rejects conflicting option %s", (option) => {
        expect(run(["test-only-mnemonic", option]).status).toBe(1);
        expect(calls()).toEqual([]);
    });
    it("does not publish after a build failure", () => {
        expect(run(["test-only-mnemonic"], { TEST_FAIL: "pnpm" }).status).toBe(7);
        expect(calls().at(-1)?.command).toBe("pnpm");
    });
    it("prints help successfully and rejects missing credentials", () => {
        expect(run(["--help"]).status).toBe(0);
        expect(run([]).status).toBe(1);
        expect(run([""]).status).toBe(1);
        expect(calls()).toEqual([]);
    });
    it("is valid bash", () => {
        expect(() => execFileSync("bash", ["-n", script])).not.toThrow();
    });
});
