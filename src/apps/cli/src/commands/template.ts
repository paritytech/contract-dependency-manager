import { Command } from "commander";
import { resolve, dirname, basename } from "path";
import { mkdirSync, readdirSync, writeFileSync } from "fs";
import { TEMPLATES } from "../generated/templates";

const template = new Command("template")
    .description("Scaffold a CDM example project from a template")
    .argument("[name]", "Template name")
    .argument("[dir]", "Target directory (defaults to ./<template-name>)");

template.action(async (name: string | undefined, dir: string | undefined) => {
    if (name === "." && dir === undefined) {
        const inferredName = basename(process.cwd());
        if (TEMPLATES[inferredName]) {
            name = inferredName;
            dir = ".";
        } else {
            console.error(`Error: Cannot infer template from current directory "${inferredName}".`);
            console.log("Use: cdm template <name> .");
            console.log("\nAvailable templates:");
            for (const key of Object.keys(TEMPLATES)) {
                console.log(`  ${key}`);
            }
            process.exit(1);
        }
    }

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

    const targetArg = dir ?? name;
    const targetDir = resolve(targetArg);

    console.log(`=== CDM Template ===\n`);
    console.log(`Scaffolding ${name} project to: ${targetDir}\n`);

    mkdirSync(targetDir, { recursive: true });

    const existingFiles = readdirSync(targetDir);
    if (existingFiles.length > 0 && existingFiles.some((f) => f !== ".git")) {
        console.log("Warning: Target directory is not empty. Files may be overwritten.\n");
    }

    const BINARY_PREFIX = "base64:";
    let filesWritten = 0;
    for (const [filePath, content] of Object.entries(tmpl.files)) {
        const fullPath = resolve(targetDir, filePath);
        mkdirSync(dirname(fullPath), { recursive: true });
        if (content.startsWith(BINARY_PREFIX)) {
            writeFileSync(fullPath, Buffer.from(content.slice(BINARY_PREFIX.length), "base64"));
        } else {
            writeFileSync(fullPath, content);
        }
        console.log(`  ${filePath}`);
        filesWritten++;
    }

    console.log(`\nCopied ${filesWritten} files.\n`);
    console.log("=== Next steps ===\n");
    if (targetArg !== ".") {
        console.log(`  cd ${targetArg}`);
    }
    console.log("  # Initialize dev account for deploying to paseo:");
    console.log("  cdm init");
    console.log("");
    console.log("  # Map your newly generated paseo deployment account:");
    console.log("  cdm account map -n paseo");
    console.log("");
    console.log("  # Deploy to Paseo:");
    console.log("  cdm deploy -n paseo");
});

export const templateCommand = template;
