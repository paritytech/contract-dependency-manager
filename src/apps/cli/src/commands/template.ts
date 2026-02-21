import { Command } from "commander";
import { resolve, dirname } from "path";
import { mkdirSync, readdirSync, writeFileSync } from "fs";
import { TEMPLATES } from "../generated/templates.js";

const template = new Command("template")
    .description("Scaffold a CDM example project from a template")
    .argument("[name]", "Template name")
    .argument("[dir]", "Target directory (defaults to current directory)", ".");

template.action(async (name: string | undefined, dir: string) => {
    if (!name) {
        console.log("Available templates:");
        for (const key of Object.keys(TEMPLATES)) {
            console.log(`  ${key}`);
        }
        console.log("");
        console.log("Usage: cdm template <name> [dir]");
        return;
    }

    const tmpl = TEMPLATES[name];
    if (!tmpl) {
        console.error(`Error: Unknown template "${name}"`);
        console.log("\nAvailable templates:");
        for (const key of Object.keys(TEMPLATES)) {
            console.log(`  ${key}`);
        }
        process.exit(1);
    }

    const targetDir = resolve(dir);

    console.log(`=== CDM Template ===\n`);
    console.log(`Scaffolding ${name} project to: ${targetDir}\n`);

    mkdirSync(targetDir, { recursive: true });

    const existingFiles = readdirSync(targetDir);
    if (existingFiles.length > 0 && existingFiles.some((f) => f !== ".git")) {
        console.log(
            "Warning: Target directory is not empty. Files may be overwritten.\n",
        );
    }

    let filesWritten = 0;
    for (const [filePath, content] of Object.entries(tmpl.files)) {
        const fullPath = resolve(targetDir, filePath);
        mkdirSync(dirname(fullPath), { recursive: true });
        writeFileSync(fullPath, content);
        console.log(`  ${filePath}`);
        filesWritten++;
    }

    console.log(`\nCopied ${filesWritten} files.\n`);
    console.log("=== Next steps ===\n");
    if (dir !== ".") {
        console.log(`  cd ${dir}`);
    }
    console.log("  # Build all contracts:");
    console.log("  cdm build");
    console.log("");
    console.log(
        "  # Deploy (bootstrap mode - deploys ContractRegistry first):",
    );
    console.log("  cdm deploy --bootstrap ws://localhost:9944");
});

export const templateCommand = template;
