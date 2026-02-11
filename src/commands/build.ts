import { Command } from "commander";
import { resolve } from "path";
import { execSync } from "child_process";
import { detectDeploymentOrder } from "../lib/detection.js";
import { CONTRACTS_REGISTRY_CRATE } from "../constants.js";
import { pvmContractBuild } from "../lib/deployer.js";

const build = new Command("build")
    .description("Build all contracts (requires CONTRACTS_REGISTRY_ADDR env var)")
    .option("--contracts <names...>", "Only build specific contracts")
    .option("--root <path>", "Workspace root directory", process.cwd());

type BuildOptions = {
    contracts?: string[];
    root: string;
};

build.action(async (opts: BuildOptions) => {
    const registry = process.env.CONTRACTS_REGISTRY_ADDR;
    if (!registry) {
        console.error("Error: CONTRACTS_REGISTRY_ADDR environment variable is required");
        console.error("Usage: CONTRACTS_REGISTRY_ADDR=0x1234... cdm build");
        process.exit(1);
    }

    const rootDir = resolve(opts.root);

    console.log("=== CDM Build ===\n");
    console.log(`Registry: ${registry}`);
    console.log(`Root: ${rootDir}\n`);

    // Always build the bootstrap registry first (no CDM needed)
    console.log(`Building ${CONTRACTS_REGISTRY_CRATE} (bootstrap)...`);
    pvmContractBuild(rootDir, CONTRACTS_REGISTRY_CRATE);

    const order = detectDeploymentOrder(rootDir);
    const contractsToBuild = opts.contracts ?? order.crateNames;

    console.log(`\nBuilding ${contractsToBuild.length} CDM contracts...\n`);

    for (const crateName of contractsToBuild) {
        console.log(`Building ${crateName}...`);
        pvmContractBuild(rootDir, crateName, registry);
    }

    console.log("\n=== Build Complete ===");
    console.log(`\nBuilt contracts:`);
    console.log(`  - ${CONTRACTS_REGISTRY_CRATE} -> target/${CONTRACTS_REGISTRY_CRATE}.release.polkavm`);
    for (const crateName of contractsToBuild) {
        console.log(`  - ${crateName} -> target/${crateName}.release.polkavm`);
    }
});

export const buildCommand = build;
