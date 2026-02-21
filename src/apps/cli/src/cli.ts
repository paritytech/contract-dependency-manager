#!/usr/bin/env node
import { Command } from "commander";
import { buildCommand } from "./commands/build.js";
import { deployCommand } from "./commands/deploy.js";
import { installCommand } from "./commands/install.js";
import { templateCommand } from "./commands/template.js";

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
