#!/usr/bin/env node

// WORKAROUND: papi throws "Incompatible runtime entry" errors on preview-net
// because ReviveApi.trace_call doesn't match bundled descriptors. These are
// harmless noise — filter them from stderr so they don't spam the terminal.
const _stderrWrite = process.stderr.write.bind(process.stderr);
// @ts-ignore — overriding for filtering
process.stderr.write = (chunk: any, ...args: any[]) => {
    const str = typeof chunk === "string" ? chunk : chunk instanceof Buffer ? chunk.toString() : "";
    if (str.includes("Incompatible runtime entry")) return true;
    return _stderrWrite(chunk, ...args);
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
