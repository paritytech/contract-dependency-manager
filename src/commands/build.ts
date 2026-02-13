import { Command } from "commander";
import { resolve } from "path";
import { execSync } from "child_process";
import { detectDeploymentOrder } from "../lib/detection.js";
import { pvmContractBuild } from "../lib/deployer.js";

const build = new Command("build")
    .description(
        "Build all contracts (requires CONTRACTS_REGISTRY_ADDR env var)",
    )
    .option("--contracts <names...>", "Only build specific contracts")
    .option("--root <path>", "Workspace root directory", process.cwd());

type BuildOptions = {
    contracts?: string[];
    root: string;
};

build.action(async (opts: BuildOptions) => {
    const registry = process.env.CONTRACTS_REGISTRY_ADDR;
    if (!registry) {
        console.warn(
            "Warning: CONTRACTS_REGISTRY_ADDR not set, defaulting to zero address",
        );
    }

    const rootDir = resolve(opts.root);

    console.log("=== CDM Build ===\n");
    console.log(`Registry: ${registry}`);
    console.log(`Root: ${rootDir}\n`);

    const order = detectDeploymentOrder(rootDir);
    const contractsToBuild = opts.contracts ?? order.crateNames;

    console.log(`Building ${contractsToBuild.length} contracts...\n`);

    for (const crateName of contractsToBuild) {
        console.log(`Building ${crateName}...`);
        pvmContractBuild(rootDir, crateName, registry);
    }

    console.log("\n=== Build Complete ===");
    console.log(`\nBuilt contracts:`);
    for (const crateName of contractsToBuild) {
        console.log(`  - ${crateName} -> target/${crateName}.release.polkavm`);
    }
});

export const buildCommand = build;
