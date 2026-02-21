#!/usr/bin/env node

// TEMPORARY WORKAROUND: Filter out "Incompatible runtime entry" errors from the ink SDK's reviveProvider
// This just silences an annoying harmless error spammed by papi b/c of preview-net runtime
//
// The ink SDK's reviveProvider calls ReviveApi.trace_call on every contract
// query. When the chain's trace_call type signature doesn't match the SDK's
// bundled descriptors (common on preview-net), the SDK catches the error and
// logs it via console.error before returning { success: false }. Filter these
// out so they don't spam stderr — the actual query results are unaffected.
const _consoleError = console.error;
console.error = (...args: unknown[]) => {
    const first = args[0];
    if (first instanceof Error && first.message.startsWith("Incompatible runtime entry")) return;
    _consoleError(...args);
};

import { Command } from "commander";
import { buildCommand } from "./commands/build";
import { deployCommand } from "./commands/deploy";
import { installCommand } from "./commands/install";
import { templateCommand } from "./commands/template";

const program = new Command();

program
    .name("cdm")
    .description("Contract Dependency Manager for PVM smart contracts")
    .version("0.1.0");

program.addCommand(buildCommand);
program.addCommand(deployCommand);
program.addCommand(installCommand);
program.addCommand(templateCommand);

program.parse();
