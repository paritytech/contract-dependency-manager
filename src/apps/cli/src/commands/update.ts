import { Command } from "commander";
import { installCdmRelease, selectReleaseTag } from "../lib/releases";
import { spinner } from "../lib/ui";
import { runSetupWithUi } from "./setup";

export const updateCommand = new Command("update")
    .description("Update the CDM CLI binary")
    .option("--tag <tag>", "GitHub release tag to install")
    .option("--skip-setup", "Do not run toolchain setup after updating")
    .option(
        "--cargo-pvm-contract-ref <ref>",
        "cargo-pvm-contract git branch, tag, or commit to install during setup",
        process.env.CDM_CARGO_PVM_CONTRACT_REF ?? "main",
    )
    .action(
        async (opts: {
            tag?: string;
            skipSetup?: boolean;
            cargoPvmContractRef: string;
        }) => {
            const tag = selectReleaseTag(opts.tag, process.env.CDM_TAG, process.env.VERSION);
            const view = spinner("cdm", tag ? `installing ${tag}` : "resolving latest release");
            let result: Awaited<ReturnType<typeof installCdmRelease>>;
            try {
                result = await installCdmRelease({ tag });
                view.succeed(`${result.tag} -> ${result.binPath}`);
            } catch (err) {
                view.fail("failed");
                console.error("");
                console.error(err instanceof Error ? err.message : String(err));
                process.exit(1);
            }

            if (!opts.skipSetup) {
                console.log("\nSetting up CDM dependencies...");
                await runSetupWithUi({
                    cargoPvmContractRef: opts.cargoPvmContractRef,
                });
            }

            console.log(`\nUpdated ${result.asset}.`);
        },
    );
