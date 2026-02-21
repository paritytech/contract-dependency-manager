import { Command } from "commander";
import { resolve } from "path";
import { runPipelineWithUI } from "../lib/ui.js";

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
        console.warn("Warning: CONTRACTS_REGISTRY_ADDR not set, defaulting to zero address");
    }

    const rootDir = resolve(opts.root);
    console.log(`Registry: ${registry ?? "0x0 (default)"}`);
    console.log(`Root: ${rootDir}\n`);

    const result = await runPipelineWithUI({
        rootDir,
        registryAddr: registry,
        contractFilter: opts.contracts,
    });

    if (!result.success) {
        process.exit(1);
    }
});

export const buildCommand = build;
