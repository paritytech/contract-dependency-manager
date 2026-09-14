#!/usr/bin/env node

import { Command } from "commander";
import { buildCommand } from "./commands/build";
import { deployCommand } from "./commands/deploy";
import { installCommand } from "./commands/install";
import { templateCommand } from "./commands/template";
import { initCommand } from "./commands/init";
import { accountCommand } from "./commands/account";
import { setupCommand } from "./commands/setup";
import { updateCommand } from "./commands/update";
import { updateCheckCommand } from "./commands/update-check";
import { scheduleUpdateCheck, UPDATE_CHECK_COMMAND, warnIfOutdated } from "./lib/update-check";
import packageJson from "../package.json";

const program = new Command();

program
    .name("cdm")
    .description("Contract Dependency Manager for PVM smart contracts")
    .version(packageJson.version);

program.hook("preAction", (_thisCommand, actionCommand) => {
    const name = actionCommand.name();
    if (name === "update" || name === UPDATE_CHECK_COMMAND) return;
    warnIfOutdated(packageJson.version);
    scheduleUpdateCheck();
});

program.addCommand(buildCommand);
program.addCommand(deployCommand);
program.addCommand(installCommand);
program.addCommand(templateCommand);
program.addCommand(initCommand);
program.addCommand(accountCommand);
program.addCommand(setupCommand);
program.addCommand(updateCommand);
program.addCommand(updateCheckCommand, { hidden: true });

// bun --compile quirk: when run with no user args, argv[2] is set to the
// program name (the argv[0] used to invoke the binary), which commander then
// treats as an unknown subcommand.
let args = process.argv.slice(2);
if (args.length === 1 && args[0] === program.name()) args = [];
program.parse(args, { from: "user" });
