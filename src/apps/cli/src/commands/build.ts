import { Command } from "commander";
import { resolve } from "path";
import { runPipelineWithUI } from "../lib/ui";

const build = new Command("build")
    .description("Build all contracts")
    .option("--contracts <names...>", "Only build specific contracts")
    .option("--root <path>", "Workspace root directory", process.cwd());

type BuildOptions = {
    contracts?: string[];
    root: string;
};

build.action(async (opts: BuildOptions) => {
    const rootDir = resolve(opts.root);
    console.log(`Root: ${rootDir}\n`);

    const result = await runPipelineWithUI({
        rootDir,
        contractFilter: opts.contracts,
    });

    if (!result.success) {
        process.exit(1);
    }
});

export const buildCommand = build;
