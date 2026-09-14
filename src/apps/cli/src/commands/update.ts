import { Command } from "commander";
import { installCdmRelease } from "../lib/releases";
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
            // Tag resolution (--tag >> CDM_TAG >> latest) happens once inside
            // installCdmRelease; the resolved tag comes back in the result.
            const view = spinner(
                "cdm",
                opts.tag ? `installing ${opts.tag}` : "resolving release tag",
            );
            let result: Awaited<ReturnType<typeof installCdmRelease>>;
            try {
                result = await installCdmRelease({ tag: opts.tag });
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
