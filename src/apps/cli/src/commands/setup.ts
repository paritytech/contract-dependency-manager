import { Command } from "commander";
import { spinner } from "../lib/ui";
import {
    createToolSteps,
    runToolchainSetup,
    type ToolStep,
    type ToolStepEvent,
} from "../lib/toolchain";

function eventDetail(event: ToolStepEvent): string {
    switch (event.status) {
        case "checking":
            return "checking";
        case "installing":
            return "installing";
        case "failed":
            return "failed";
        case "ok":
            return "ready";
    }
}

export async function runSetupWithUi(opts: {
    check?: boolean;
    cargoPvmContractRef?: string;
    heading?: boolean;
}): Promise<void> {
    if (opts.heading ?? true) {
        console.log("\x1b[1mCDM setup\x1b[0m\n");
    }

    let active:
        | {
              step: ToolStep;
              view: ReturnType<typeof spinner>;
          }
        | undefined;
    let failedStep: ToolStep | undefined;

    try {
        await runToolchainSetup({
            steps: createToolSteps({
                ref: opts.cargoPvmContractRef,
            }),
            onEvent: (event) => {
                if (active?.step !== event.step) {
                    active = {
                        step: event.step,
                        view: spinner(event.step.name, eventDetail(event)),
                    };
                    return;
                }

                active.view.update(eventDetail(event));
                if (event.status === "ok") {
                    active.view.succeed("ready");
                    active = undefined;
                } else if (event.status === "failed") {
                    failedStep = event.step;
                    active.view.fail("failed");
                    active = undefined;
                }
            },
            onData: () => {
                // Tool output is retained in thrown errors by the process runner.
            },
            install: !opts.check,
        });
    } catch (err) {
        if (active) {
            active.view.fail("failed");
        }
        console.error("");
        console.error(err instanceof Error ? err.message : String(err));
        if (failedStep?.manualHint) {
            console.error(`\nManual install: ${failedStep.manualHint}`);
        }
        process.exit(1);
    }

    console.log("\nCDM toolchain is ready.");
}

export const setupCommand = new Command("setup")
    .description("Install or repair CDM toolchain dependencies")
    .option("--check", "Only check dependencies; do not install missing tools")
    .option(
        "--cargo-pvm-contract-ref <ref>",
        "cargo-pvm-contract git branch, tag, or commit to install",
        process.env.CDM_CARGO_PVM_CONTRACT_REF ?? "main",
    )
    .action(
        async (opts: {
            check?: boolean;
            cargoPvmContractRef: string;
        }) => {
            await runSetupWithUi({
                check: opts.check,
                cargoPvmContractRef: opts.cargoPvmContractRef,
            });
        },
    );
