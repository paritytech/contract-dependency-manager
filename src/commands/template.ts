import { Command } from "commander";
import { resolve, join, relative, dirname } from "path";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, statSync, copyFileSync } from "fs";

const template = new Command("template")
    .description("Scaffold a CDM example project with 3 contracts and TypeScript validation")
    .argument("[dir]", "Target directory (defaults to current directory)", ".");

template.action(async (dir: string) => {
    const targetDir = resolve(dir);

    console.log(`=== CDM Template ===\n`);
    console.log(`Scaffolding shared-counter project to: ${targetDir}\n`);

    // Find the templates directory
    // When running from source: relative to this file
    // When running as compiled binary: embedded in the binary
    const templateDir = findTemplateDir();

    if (!templateDir) {
        console.error("Error: Could not find template directory");
        console.error("Expected at: templates/shared-counter/");
        process.exit(1);
    }

    // Create target directory if it doesn't exist
    mkdirSync(targetDir, { recursive: true });

    // Check if directory is not empty
    const existingFiles = readdirSync(targetDir);
    if (existingFiles.length > 0 && existingFiles.some(f => f !== ".git")) {
        console.log("Warning: Target directory is not empty. Files may be overwritten.\n");
    }

    // Copy all template files
    const filesCopied = copyDir(templateDir, targetDir);

    console.log(`\nCopied ${filesCopied} files.\n`);
    console.log("=== Next steps ===\n");
    if (dir !== ".") {
        console.log(`  cd ${dir}`);
    }
    console.log("  # Install dependencies for the TypeScript validator:");
    console.log("  cd ts && bun install && cd ..");
    console.log("");
    console.log("  # Build all contracts:");
    console.log("  cdm build");
    console.log("");
    console.log("  # Deploy (bootstrap mode - deploys ContractRegistry first):");
    console.log("  cdm deploy --bootstrap ws://localhost:9944");
    console.log("");
    console.log("  # Run the TypeScript validation:");
    console.log("  cd ts && bun run src/validate.ts");
});

/**
 * Find the templates/shared-counter directory.
 * Walks up from the current file to find the project root.
 */
function findTemplateDir(): string | null {
    // Try relative to this source file
    const candidates = [
        resolve(import.meta.dir, "../../templates/shared-counter"),
        resolve(process.cwd(), "templates/shared-counter"),
        resolve(dirname(process.argv[1] || ""), "../templates/shared-counter"),
    ];

    for (const candidate of candidates) {
        if (existsSync(candidate)) {
            return candidate;
        }
    }
    return null;
}

/**
 * Recursively copy a directory.
 * Returns the number of files copied.
 */
function copyDir(src: string, dest: string): number {
    let count = 0;
    const entries = readdirSync(src, { withFileTypes: true });

    for (const entry of entries) {
        const srcPath = join(src, entry.name);
        const destPath = join(dest, entry.name);

        if (entry.isDirectory()) {
            mkdirSync(destPath, { recursive: true });
            count += copyDir(srcPath, destPath);
        } else {
            // Skip node_modules, target, etc.
            if (entry.name === ".DS_Store") continue;

            copyFileSync(srcPath, destPath);
            const relPath = relative(dest, destPath);
            console.log(`  ${relPath}`);
            count++;
        }
    }

    return count;
}

export const templateCommand = template;
