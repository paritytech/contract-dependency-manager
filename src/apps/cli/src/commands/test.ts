import { Command } from "commander";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { ensurePpnInstalled, isLocalNetworkUp, waitForLocalNetwork } from "./network";

/**
 * `cdm test` — auto-orchestrates a deploy + install + vitest cycle against the
 * local Product Preview Network.
 *
 * Zero-config happy path:
 *   $ cdm test
 *   →  Starts PPN if it's not already up (installs it on first ever run).
 *   →  Auto-bootstraps ContractRegistry if the local chain doesn't have one
 *      yet (this is handled inside `cdm deploy -n local`, not here).
 *   →  Builds + deploys workspace contracts.
 *   →  Installs ABIs into cdm.json so vitest can import them via
 *      `@parity/product-sdk-contracts.ContractManager`.
 *   →  Runs vitest.
 *
 * Skip flags exist for iterating on subsets:
 *   --skip-deploy   reuse the on-chain deployment from a previous run
 *   --skip-install  reuse cdm.json from a previous run
 *   --skip-vitest   only deploy + install, no tests
 */
const test = new Command("test")
    .description("Deploy contracts to a local network, install ABIs into cdm.json, and run vitest.")
    .option("-n, --name <name>", "Chain preset name", "local")
    .option("--suri <uri>", "Secret URI for signing")
    .option("--registry-address <address>", "Override the registry address (default: chain preset)")
    .option(
        "--skip-deploy",
        "Skip the deploy step (use existing on-chain contracts + cached cdm.json)",
        false,
    )
    .option("--skip-install", "Skip the install step (use cached cdm.json)", false)
    .option("--skip-vitest", "Only deploy + install, don't run tests", false)
    .option("--no-auto-network", "Don't auto-start the local network if it isn't up (fail instead)")
    .action(async (opts: TestOptions) => {
        const rootDir = process.cwd();

        if (opts.name === "local" && opts.autoNetwork !== false) {
            await ensureLocalNetworkUp();
        }

        if (!opts.skipDeploy) {
            const deployArgs = ["deploy", "--name", opts.name];
            if (opts.suri) deployArgs.push("--suri", opts.suri);
            if (opts.registryAddress) deployArgs.push("--registry-address", opts.registryAddress);
            runCdm(deployArgs);
        }

        if (!opts.skipInstall) {
            const packages = discoverCdmPackages(rootDir);
            if (packages.length === 0) {
                console.error(
                    "No CDM packages discovered in target/. Did the deploy run? (Looked for target/*.release.cdm.json with a cdmPackage field.)",
                );
                process.exit(1);
            }
            const installArgs = ["install", "--name", opts.name, ...packages];
            if (opts.registryAddress) installArgs.push("--registry-address", opts.registryAddress);
            runCdm(installArgs);
        }

        if (!opts.skipVitest) {
            runVitest();
        }
    });

type TestOptions = {
    name: string;
    suri?: string;
    registryAddress?: string;
    skipDeploy: boolean;
    skipInstall: boolean;
    skipVitest: boolean;
    autoNetwork?: boolean;
};

async function ensureLocalNetworkUp(): Promise<void> {
    if (await isLocalNetworkUp()) return;
    await ensurePpnInstalled();
    console.log(
        "Local network is not running — starting PPN (this may take ~60s on first boot)...",
    );
    runCdm(["network", "start"]);
    const ready = await waitForLocalNetwork(120_000);
    if (!ready) {
        console.error("PPN didn't become ready in time. Inspect logs with: cdm network logs");
        process.exit(1);
    }
}

/**
 * Walk `target/*.release.cdm.json` to find this workspace's CDM packages.
 * Each per-crate cdm.json carries the `cdmPackage` annotation embedded by
 * `#[pvm::contract(cdm = "@org/name")]`.
 */
function discoverCdmPackages(rootDir: string): string[] {
    const targetDir = resolve(rootDir, "target");
    if (!existsSync(targetDir)) return [];
    const packages: string[] = [];
    for (const file of readdirSync(targetDir)) {
        const m = file.match(/^(.+)\.release\.cdm\.json$/);
        if (!m || m[1] === "contract-registry") continue;
        try {
            const meta = JSON.parse(readFileSync(resolve(targetDir, file), "utf-8")) as {
                cdmPackage?: string;
            };
            if (meta.cdmPackage) packages.push(meta.cdmPackage);
        } catch {
            // skip malformed
        }
    }
    return packages;
}

function runCdm(args: string[]): void {
    const { cmd, baseArgs } = cdmInvocation();
    const result = spawnSync(cmd, [...baseArgs, ...args], { stdio: "inherit" });
    if (result.status !== 0) process.exit(result.status ?? 1);
}

function runVitest(): void {
    const result = spawnSync("npx", ["--no-install", "vitest", "run"], { stdio: "inherit" });
    if (result.error || result.status === null) {
        console.error("Failed to run vitest. Ensure it is installed in the workspace.");
        process.exit(1);
    }
    process.exit(result.status);
}

// Re-invoke the cdm binary that's running this process. In compiled mode
// `process.execPath` is the cdm binary; in dev mode it's bun and argv[1] is
// the cli.ts entry script.
function cdmInvocation(): { cmd: string; baseArgs: string[] } {
    const entry = process.argv[1];
    const isDev = entry?.endsWith(".ts") === true;
    return isDev
        ? { cmd: process.execPath, baseArgs: [entry!] }
        : { cmd: process.execPath, baseArgs: [] };
}

export const testCommand = test;
