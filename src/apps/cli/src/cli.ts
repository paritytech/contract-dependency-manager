#!/usr/bin/env node

import { Command } from "commander";
import { buildCommand } from "./commands/build";
import { deployCommand } from "./commands/deploy";
import { installCommand } from "./commands/install";
import { templateCommand } from "./commands/template";
import { initCommand } from "./commands/init";
import { accountCommand } from "./commands/account";

const program = new Command();

program
    .name("cdm")
    .description("Contract Dependency Manager for PVM smart contracts")
    .version("0.1.0");

program.addCommand(buildCommand);
program.addCommand(deployCommand);
program.addCommand(installCommand);
program.addCommand(templateCommand);
program.addCommand(initCommand);
program.addCommand(accountCommand);

// bun --compile quirk: when run with no user args, argv[2] is set to the
// program name (the argv[0] used to invoke the binary), which commander then
// treats as an unknown subcommand.
let args = process.argv.slice(2);
if (args.length === 1 && args[0] === program.name()) args = [];
program.parse(args, { from: "user" });
