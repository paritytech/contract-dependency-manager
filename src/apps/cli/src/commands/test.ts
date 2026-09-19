import { Command } from "commander";
import { spawnSync } from "node:child_process";
import { readBuildManifest } from "@parity/cdm-builder";
import { ensurePpnInstalled, isLocalNetworkUp, waitForLocalNetwork } from "./network";
import { cdmInvocation } from "../lib/cdm-invocation";

/** Convention: vitest projects named this run the chain-dependent suite. */
const DEFAULT_VITEST_PROJECT = "contract";
/** Sentinel value for `--project` that disables filtering and runs every project. */
const ALL_PROJECTS = "all";

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
 *   →  Runs vitest, filtered to the project named "contract" by default.
 *      Pass `--project all` to run every vitest project instead.
 *
 * Skip flags exist for iterating on subsets:
 *   --skip-deploy   reuse the on-chain deployment from a previous run
 *   --skip-install  reuse cdm.json from a previous run
 *   --skip-vitest   only deploy + install, no tests
 *   --project NAME  vitest project to run; pass "all" to run them all
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
    .option(
        "--project <name>",
        `Vitest project to run; pass "${ALL_PROJECTS}" for every project`,
        DEFAULT_VITEST_PROJECT,
    )
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
                    "No CDM packages discovered. Did the build run? (Looked for target/cdm/build-manifest.json with cdmPackage entries.)",
                );
                process.exit(1);
            }
            const installArgs = ["install", "--name", opts.name, ...packages];
            if (opts.registryAddress) installArgs.push("--registry-address", opts.registryAddress);
            runCdm(installArgs);
        }

        if (!opts.skipVitest) {
            runVitest(opts.project);
        }
    });

type TestOptions = {
    name: string;
    suri?: string;
    registryAddress?: string;
    skipDeploy: boolean;
    skipInstall: boolean;
    skipVitest: boolean;
    project: string;
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
 * Read `target/cdm/build-manifest.json` to find this workspace's CDM packages.
 * Each contract carries the `cdmPackage` annotation declared by
 * `[package.metadata.cdm]` in its Cargo.toml.
 *
 * The manifest is written by the build phase; the per-crate
 * `*.release.cdm.json` files this used to walk no longer exist (removed by the
 * "flatten cdm manifest artifacts" refactor), so walking them silently yielded
 * zero packages and `cdm test` exited before running vitest.
 */
function discoverCdmPackages(rootDir: string): string[] {
    const manifest = readBuildManifest(rootDir);
    if (!manifest) return [];
    return manifest.contracts
        .filter((contract) => contract.name !== "contract-registry")
        .map((contract) => contract.cdmPackage)
        .filter((pkg): pkg is string => Boolean(pkg));
}

function runCdm(args: string[]): void {
    const { cmd, baseArgs } = cdmInvocation();
    const result = spawnSync(cmd, [...baseArgs, ...args], { stdio: "inherit" });
    if (result.status !== 0) process.exit(result.status ?? 1);
}

function runVitest(project: string): void {
    const args = ["--no-install", "vitest", "run"];
    if (project !== ALL_PROJECTS) args.push("--project", project);
    const result = spawnSync("npx", args, { stdio: "inherit" });
    if (result.error || result.status === null) {
        console.error("Failed to run vitest. Ensure it is installed in the workspace.");
        process.exit(1);
    }
    process.exit(result.status);
}

export const testCommand = test;
