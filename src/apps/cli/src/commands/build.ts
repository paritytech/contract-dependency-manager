import { Command } from "commander";
import { resolve } from "path";
import { runBuildWithUI } from "../lib/ui";

const build = new Command("build")
    .description("Build all contracts")
    .option("--contracts <names...>", "Only build specific contracts")
    .option("--features <features>", "Cargo feature flags to pass to the build")
    .option("--root <path>", "Workspace root directory", process.cwd());

type BuildOptions = {
    contracts?: string[];
    features?: string;
    root: string;
};

build.action(async (opts: BuildOptions) => {
    const rootDir = resolve(opts.root);
    console.log(`Root: ${rootDir}\n`);

    const { result } = await runBuildWithUI({
        rootDir,
        contracts: opts.contracts,
        features: opts.features,
    });

    if (!result.success) {
        process.exit(1);
    }
});

export const buildCommand = build;
