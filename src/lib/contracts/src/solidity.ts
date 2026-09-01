import { spawn, spawnSync } from "child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "fs";
import { basename, dirname, join, relative, resolve } from "path";
import type { AbiEntry } from "./deployer";
import { findNamedMarkdown, findReadme } from "./detection";
import type { ContractInfo, ContractInitialization, ContractToolchain } from "./detection";
import { INITIALIZATIONS_DIR, listVersionAddressedFiles } from "./initializations";
import { solidityLibraryFromImportPath } from "./solidity-imports";

export type SolidityToolchain = Extract<ContractToolchain, "foundry" | "hardhat">;

const HARDHAT_CONFIGS = [
    "hardhat.config.ts",
    "hardhat.config.js",
    "hardhat.config.cjs",
    "hardhat.config.mjs",
];

const SOLIDITY_SKIP_DIRS = new Set([
    ".cdm",
    ".git",
    ".turbo",
    "artifacts",
    "broadcast",
    "cache",
    "dist",
    "lib",
    "node_modules",
    "out",
    "target",
    "typechain",
    "typechain-types",
]);

/**
 * Source scanning additionally skips `initializations/`: initialization
 * contracts are never regular deploy targets — they get built by the
 * toolchain like any other source and wired in by the deploy pipeline.
 */
const SOLIDITY_SOURCE_SKIP_DIRS = new Set([...SOLIDITY_SKIP_DIRS, INITIALIZATIONS_DIR]);

export interface SolidityBuildTarget extends ContractInfo {
    toolchain: SolidityToolchain;
    sourcePath: string;
    contractName: string;
}

export interface SolidityBuildArtifact {
    target: SolidityBuildTarget;
    bytecodePath: string;
    artifactPath: string;
    abiPath: string;
    bytecodeSize: number;
    durationMs: number;
}

interface CommandResult {
    success: boolean;
    stdout: string;
    stderr: string;
    durationMs: number;
    error?: string;
}

interface SolidityArtifactJson {
    _format?: unknown;
    contractName?: string;
    sourceName?: string;
    ast?: {
        absolutePath?: unknown;
    };
    abi?: unknown;
    bytecode?: unknown;
}

interface FoundryConfigJson {
    out?: unknown;
    src?: unknown;
    remappings?: unknown;
}

interface ScannedSolidityArtifact {
    contractName: string;
    sourceName: string | null;
    artifactPath: string;
    artifact: SolidityArtifactJson;
    bytecode: string;
}

export interface BuildSolidityToolchainOptions {
    /**
     * Reuse existing toolchain artifacts on disk instead of spawning forge or
     * hardhat. Useful for callers that already compiled in a separate phase.
     */
    skipBuild?: boolean;
    /** Receives stdout/stderr chunks from the toolchain command. */
    onData?: (line: string) => void;
}

export function hasFoundryProject(rootDir: string): boolean {
    return existsSync(resolve(rootDir, "foundry.toml"));
}

export function hasHardhatProject(rootDir: string): boolean {
    return HARDHAT_CONFIGS.some((name) => existsSync(resolve(rootDir, name)));
}

function readPackageMetadata(
    rootDir: string,
): Pick<ContractInfo, "description" | "authors" | "homepage" | "repository"> {
    const packageJsonPath = resolve(rootDir, "package.json");
    if (!existsSync(packageJsonPath)) {
        return { description: null, authors: [], homepage: null, repository: null };
    }

    try {
        const pkg = JSON.parse(readFileSync(packageJsonPath, "utf-8")) as {
            description?: unknown;
            author?: unknown;
            authors?: unknown;
            homepage?: unknown;
            repository?: unknown;
        };
        const authors: string[] = [];
        if (typeof pkg.author === "string") authors.push(pkg.author);
        if (Array.isArray(pkg.authors)) {
            authors.push(
                ...pkg.authors.filter((author): author is string => typeof author === "string"),
            );
        }

        let repository: string | null = null;
        if (typeof pkg.repository === "string") {
            repository = pkg.repository;
        } else if (
            pkg.repository &&
            typeof pkg.repository === "object" &&
            "url" in pkg.repository &&
            typeof pkg.repository.url === "string"
        ) {
            repository = pkg.repository.url;
        }

        return {
            description: typeof pkg.description === "string" ? pkg.description : null,
            authors,
            homepage: typeof pkg.homepage === "string" ? pkg.homepage : null,
            repository,
        };
    } catch {
        return { description: null, authors: [], homepage: null, repository: null };
    }
}

function collectSolidityFiles(dir: string, out: string[] = []): string[] {
    if (!existsSync(dir)) return out;

    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) {
            if (!SOLIDITY_SOURCE_SKIP_DIRS.has(entry.name)) {
                collectSolidityFiles(join(dir, entry.name), out);
            }
        } else if (entry.isFile() && entry.name.endsWith(".sol")) {
            out.push(join(dir, entry.name));
        }
    }

    return out;
}

interface SolidityContractDefinition {
    contractName: string;
    cdmPackage: string | null;
    version: string | null;
    description: string | null;
    authors: string[];
    homepage: string | null;
    repository: string | null;
}

/**
 * `@custom:cdm @org/name[:X.Y.Z]` — the CDM package name, optionally suffixed
 * with the publish version (same colon convention as `cdm i @org/name:1.2.1`;
 * package names can never contain `:`). The version is captured loosely here —
 * semver validation stays centralized in the deploy pipeline.
 */
const CDM_NATSPEC_RE = /@custom:cdm\s+(@[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)+)(?::(\S+))?/;

function blankBlockComments(source: string): string {
    return source.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, " "));
}

function blankComments(source: string): string {
    return blankBlockComments(source).replace(/\/\/[^\n]*/g, (comment) =>
        comment.replace(/[^\n]/g, " "),
    );
}

function precedingNatSpecComment(source: string, declarationIndex: number): string | null {
    const before = source.slice(0, declarationIndex).replace(/\s*$/g, "");
    const lineComment = before.match(/(?:^|\n)(?:\s*\/\/\/[^\n]*\n?)+$/);
    const blockComment = before.match(/\/\*\*[\s\S]*?\*\/$/);
    return lineComment?.[0] ?? blockComment?.[0] ?? null;
}

function normalizeNatSpecComment(comment: string): string[] {
    return comment
        .split(/\r?\n/)
        .map((line) =>
            line
                .replace(/^\s*\/\/\/\s?/, "")
                .replace(/^\s*\/\*\*\s?/, "")
                .replace(/\s*\*\/\s*$/, "")
                .replace(/^\s*\*\s?/, "")
                .trim(),
        )
        .filter((line) => line.length > 0);
}

function parseNatSpecTags(comment: string | null): Map<string, string[]> {
    const tags = new Map<string, string[]>();
    if (!comment) return tags;

    let currentTag: string | null = null;
    for (const line of normalizeNatSpecComment(comment)) {
        const match = line.match(/^@([A-Za-z][A-Za-z0-9_-]*(?::[A-Za-z0-9_-]+)?)\s*(.*)$/);
        if (match) {
            currentTag = match[1];
            const value = match[2].trim();
            if (!tags.has(currentTag)) tags.set(currentTag, []);
            if (value) tags.get(currentTag)!.push(value);
            continue;
        }

        if (currentTag) {
            const values = tags.get(currentTag)!;
            const last = values[values.length - 1];
            if (last === undefined) {
                values.push(line);
            } else {
                values[values.length - 1] = `${last} ${line}`;
            }
        }
    }

    return tags;
}

function firstNatSpecValue(tags: Map<string, string[]>, names: string[]): string | null {
    for (const name of names) {
        const value = tags.get(name)?.find((entry) => entry.trim().length > 0);
        if (value) return value;
    }
    return null;
}

function parsePrecedingNatSpec(source: string, declarationIndex: number) {
    const comment = precedingNatSpecComment(source, declarationIndex);
    const tags = parseNatSpecTags(comment);
    const cdmTag = comment?.match(CDM_NATSPEC_RE);
    return {
        cdmPackage: cdmTag?.[1] ?? null,
        version: cdmTag?.[2] ?? null,
        description: firstNatSpecValue(tags, ["custom:description", "notice", "dev"]),
        authors: [...(tags.get("author") ?? []), ...(tags.get("custom:author") ?? [])].filter(
            (author) => author.trim().length > 0,
        ),
        homepage: firstNatSpecValue(tags, ["custom:homepage"]),
        repository: firstNatSpecValue(tags, ["custom:repository", "custom:repo"]),
    };
}

function extractContractDefinitions(source: string): SolidityContractDefinition[] {
    const scanSource = blankBlockComments(source);
    const definitions = new Map<string, SolidityContractDefinition>();
    const re = /(^|\n)\s*(abstract\s+)?contract\s+([A-Za-z_][A-Za-z0-9_]*)\b/g;
    let match: RegExpExecArray | null;
    while ((match = re.exec(scanSource))) {
        if (match[2]) continue;
        const contractName = match[3];
        const declarationIndex = match.index + match[0].lastIndexOf("contract");
        const natSpec = parsePrecedingNatSpec(source, declarationIndex);
        definitions.set(contractName, {
            contractName,
            ...natSpec,
        });
    }
    return [...definitions.values()].sort((a, b) => a.contractName.localeCompare(b.contractName));
}

function extractImportSpecifiers(source: string): string[] {
    const scanSource = blankComments(source);
    const imports: string[] = [];
    const re = /\bimport\s+(?:[^"';]*?\s+from\s+)?["']([^"']+)["']\s*;/g;
    let match: RegExpExecArray | null;
    while ((match = re.exec(scanSource))) {
        imports.push(match[1]);
    }
    return imports;
}

function normalizeForImportMatch(path: string): string {
    return path.replace(/\\/g, "/");
}

function resolveImportPath(rootDir: string, sourcePath: string, specifier: string): string {
    if (specifier.startsWith(".")) return resolve(dirname(sourcePath), specifier);
    if (specifier.startsWith("/")) return resolve(rootDir, `.${specifier}`);
    return resolve(rootDir, specifier);
}

interface SolidityImportRemapping {
    prefix: string;
    target: string;
}

function parseSolidityImportRemapping(value: unknown): SolidityImportRemapping | null {
    if (typeof value !== "string") return null;
    const eq = value.indexOf("=");
    if (eq <= 0) return null;

    // Foundry supports optional context prefixes (`context:prefix=target`).
    // CDM import matching only needs the actual import prefix.
    const rawPrefix = value.slice(0, eq);
    const contextSep = rawPrefix.lastIndexOf(":");
    const prefix = normalizeForImportMatch(
        contextSep >= 0 ? rawPrefix.slice(contextSep + 1) : rawPrefix,
    );
    const target = normalizeForImportMatch(value.slice(eq + 1));

    return prefix && target ? { prefix, target } : null;
}

function readSolidityImportRemappingsFromText(text: string): SolidityImportRemapping[] {
    return text
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith("#"))
        .map(parseSolidityImportRemapping)
        .filter((entry): entry is SolidityImportRemapping => entry !== null);
}

function readFoundryImportRemappings(rootDir: string): SolidityImportRemapping[] {
    const configRemappings = readFoundryConfig(rootDir)?.remappings;
    if (Array.isArray(configRemappings)) {
        const remappings = configRemappings
            .map(parseSolidityImportRemapping)
            .filter((entry): entry is SolidityImportRemapping => entry !== null);
        if (remappings.length > 0) return remappings;
    }

    const remappingsTxtPath = resolve(rootDir, "remappings.txt");
    if (existsSync(remappingsTxtPath)) {
        const remappings = readSolidityImportRemappingsFromText(
            readFileSync(remappingsTxtPath, "utf-8"),
        );
        if (remappings.length > 0) return remappings;
    }

    return [];
}

function resolveRemappedImport(
    rootDir: string,
    specifier: string,
    remappings: SolidityImportRemapping[],
): string | null {
    const normalized = normalizeForImportMatch(specifier);
    const match = remappings
        .filter((remapping) => normalized.startsWith(remapping.prefix))
        .sort((a, b) => b.prefix.length - a.prefix.length)[0];
    if (!match) return null;

    const suffix = normalized.slice(match.prefix.length);
    const separator = match.target.endsWith("/") || suffix.startsWith("/") || !suffix ? "" : "/";
    const mapped = `${match.target}${separator}${suffix}`;
    return mapped.startsWith("/") ? resolve(mapped) : resolve(rootDir, mapped);
}

function isWithinGeneratedCdmSolidity(rootDir: string, path: string): boolean {
    const rel = normalizeForImportMatch(relative(rootDir, path));
    return rel === ".cdm/solidity" || rel.startsWith(".cdm/solidity/");
}

function collectCdmImportPackages(
    rootDir: string,
    sourcePath: string,
    resolveImport: (sourcePath: string, specifier: string) => string | null,
    visited: Set<string> = new Set(),
): Set<string> {
    const packages = new Set<string>();
    if (visited.has(sourcePath) || !existsSync(sourcePath)) return packages;
    visited.add(sourcePath);

    const source = readFileSync(sourcePath, "utf-8");
    for (const specifier of extractImportSpecifiers(source)) {
        const resolved =
            resolveImport(sourcePath, specifier) ??
            resolveImportPath(rootDir, sourcePath, specifier);
        const rootRelative = normalizeForImportMatch(relative(rootDir, resolved));
        const library =
            solidityLibraryFromImportPath(rootRelative) ?? solidityLibraryFromImportPath(specifier);
        if (library) {
            packages.add(library);
            continue;
        }

        if (
            specifier.endsWith(".sol") &&
            existsSync(resolved) &&
            !isWithinGeneratedCdmSolidity(rootDir, resolved)
        ) {
            for (const nested of collectCdmImportPackages(
                rootDir,
                resolved,
                resolveImport,
                visited,
            )) {
                packages.add(nested);
            }
        }
    }

    return packages;
}

function attachSolidityDependencies(
    rootDir: string,
    targets: SolidityBuildTarget[],
): SolidityBuildTarget[] {
    const localPackageToTarget = new Map<string, string>();
    const importRemappingsByToolchain: Record<SolidityToolchain, SolidityImportRemapping[]> = {
        foundry: readFoundryImportRemappings(rootDir),
        hardhat: [],
    };
    for (const target of targets) {
        if (target.cdmPackage) localPackageToTarget.set(target.cdmPackage, target.name);
    }

    return targets.map((target) => {
        const importRemappings = importRemappingsByToolchain[target.toolchain];
        const resolveImport = (_sourcePath: string, specifier: string) =>
            resolveRemappedImport(rootDir, specifier, importRemappings);
        const deps = [...collectCdmImportPackages(rootDir, target.sourcePath, resolveImport)]
            .map((pkg) => localPackageToTarget.get(pkg))
            .filter((name): name is string => Boolean(name) && name !== target.name);

        return {
            ...target,
            dependsOnCrates: [...new Set(deps)].sort(),
        };
    });
}

/** `contract X is A, B(...) {` declarations with their inheritance lists. */
function extractInheritingContracts(source: string): Array<{ name: string; bases: string[] }> {
    const scanSource = blankComments(source);
    const out: Array<{ name: string; bases: string[] }> = [];
    const re = /(^|\n)\s*contract\s+([A-Za-z_][A-Za-z0-9_]*)\s+is\s+([^{]+)\{/g;
    let match: RegExpExecArray | null;
    while ((match = re.exec(scanSource))) {
        const bases = match[3]
            .split(",")
            .map((base) => base.trim().replace(/\(.*$/, "").trim())
            .filter((base) => base.length > 0);
        out.push({ name: match[2], bases });
    }
    return out;
}

/**
 * Attach each target's initializations. An initialization is addressed by
 * (contract, version); the Solidity projection is
 * `initializations/<ContractName>/<version>.sol` — the DIRECTORY names the
 * contract (the router), and the file's initialization contract must inherit
 * it (validation — inheriting is also what guarantees the shared storage
 * layout). The per-contract subdirectory is mandatory even for
 * single-contract projects: a flat form would plant a rename trap the day a
 * second contract appears.
 */
function attachSolidityInitializations(targets: SolidityBuildTarget[]): SolidityBuildTarget[] {
    const targetsByDir = new Map<string, SolidityBuildTarget[]>();
    for (const target of targets) {
        const dir = dirname(target.sourcePath);
        targetsByDir.set(dir, [...(targetsByDir.get(dir) ?? []), target]);
    }

    const initsByTarget = new Map<SolidityBuildTarget, ContractInitialization[]>();
    for (const [dir, dirTargets] of targetsByDir) {
        const initializationsDir = join(dir, INITIALIZATIONS_DIR);
        if (!existsSync(initializationsDir)) continue;
        const byName = new Map(dirTargets.map((target) => [target.contractName, target]));

        for (const entry of readdirSync(initializationsDir, { withFileTypes: true }).sort((a, b) =>
            a.name.localeCompare(b.name),
        )) {
            // A version file sitting flat in initializations/ predates the
            // per-contract layout — teach the convention instead of guessing.
            if (entry.isFile() && entry.name.endsWith(".sol")) {
                throw new Error(
                    `Initialization ${join(initializationsDir, entry.name)} sits directly in ` +
                        `${INITIALIZATIONS_DIR}/ — Solidity initializations are addressed by ` +
                        `(contract, version): move it to ` +
                        `${INITIALIZATIONS_DIR}/<ContractName>/${entry.name}, where ` +
                        `<ContractName> is the contract it initializes.`,
                );
            }
            if (!entry.isDirectory()) continue;

            const target = byName.get(entry.name);
            if (!target) {
                throw new Error(
                    `${join(initializationsDir, entry.name)} does not name a CDM contract — ` +
                        `initialization directories must match a contract declared in ${dir}` +
                        (byName.size > 0 ? ` (${[...byName.keys()].join(", ")})` : "") +
                        `.`,
                );
            }

            const contractDir = join(initializationsDir, entry.name);
            const initializations: ContractInitialization[] = [];
            for (const file of listVersionAddressedFiles(contractDir, ".sol")) {
                const source = readFileSync(file.path, "utf-8");
                const inheritors = extractInheritingContracts(source).filter((contract) =>
                    contract.bases.includes(target.contractName),
                );
                if (inheritors.length === 0) {
                    throw new Error(
                        `${file.path} must contain a contract inheriting ` +
                            `${target.contractName} — inheriting the contract it initializes ` +
                            `is what gives an initialization the same storage layout.`,
                    );
                }
                if (inheritors.length > 1) {
                    throw new Error(
                        `${file.path} declares multiple contracts inheriting ` +
                            `${target.contractName} (${inheritors
                                .map((contract) => contract.name)
                                .join(", ")}) — an initialization file declares exactly one.`,
                    );
                }
                initializations.push({
                    version: file.version,
                    sourcePath: file.path,
                    contractName: inheritors[0].name,
                });
            }
            if (initializations.length > 0) {
                initsByTarget.set(target, initializations);
            }
        }
    }

    return targets.map((target) => {
        const initializations = initsByTarget.get(target);
        return initializations ? { ...target, initializations } : target;
    });
}

function readFoundrySourceDirs(rootDir: string): string[] {
    const config = readFoundryConfig(rootDir);
    const dirs = new Set(["contracts", "src"]);

    if (typeof config?.src === "string") dirs.add(config.src);

    const foundryTomlPath = resolve(rootDir, "foundry.toml");
    if (existsSync(foundryTomlPath)) {
        const content = readFileSync(foundryTomlPath, "utf-8");
        const match = content.match(/^\s*src\s*=\s*["']([^"']+)["']/m);
        if (match?.[1]) dirs.add(match[1]);
    }

    return [...dirs].map((dir) => resolve(rootDir, dir)).filter((dir) => existsSync(dir));
}

function readHardhatPathSetting(rootDir: string, key: "artifacts" | "sources"): string | null {
    for (const name of HARDHAT_CONFIGS) {
        const configPath = resolve(rootDir, name);
        if (!existsSync(configPath)) continue;
        const content = readFileSync(configPath, "utf-8");
        const match = content.match(
            new RegExp(`\\bpaths\\s*:\\s*{[\\s\\S]*?\\b${key}\\s*:\\s*["']([^"']+)["']`),
        );
        if (match?.[1]) return match[1];
    }
    return null;
}

function readHardhatSourceDirs(rootDir: string): string[] {
    const dirs = new Set(["contracts"]);
    const configured = readHardhatPathSetting(rootDir, "sources");
    if (configured) dirs.add(configured);
    const existing = [...dirs].map((dir) => resolve(rootDir, dir)).filter((dir) => existsSync(dir));
    return existing.length > 0 ? existing : [rootDir];
}

function sourceDirsForToolchain(rootDir: string, toolchain: SolidityToolchain): string[] {
    if (toolchain === "foundry") return readFoundrySourceDirs(rootDir);
    return readHardhatSourceDirs(rootDir);
}

export function detectSolidityBuildTargets(rootDir: string): SolidityBuildTarget[] {
    const meta = readPackageMetadata(rootDir);
    const targets: SolidityBuildTarget[] = [];

    const toolchains: SolidityToolchain[] = [];
    if (hasFoundryProject(rootDir)) toolchains.push("foundry");
    if (hasHardhatProject(rootDir)) toolchains.push("hardhat");

    for (const toolchain of toolchains) {
        for (const sourcePath of sourceDirsForToolchain(rootDir, toolchain).flatMap((dir) =>
            collectSolidityFiles(dir),
        )) {
            const source = readFileSync(sourcePath, "utf-8");
            for (const definition of extractContractDefinitions(source)) {
                const sourceDir = dirname(sourcePath);
                targets.push({
                    name: definition.cdmPackage ?? definition.contractName,
                    displayName: definition.cdmPackage ?? definition.contractName,
                    toolchain,
                    version: definition.version ?? undefined,
                    cdmPackage: definition.cdmPackage,
                    description: definition.description ?? meta.description,
                    authors: definition.authors.length > 0 ? definition.authors : meta.authors,
                    homepage: definition.homepage ?? meta.homepage,
                    repository: definition.repository ?? meta.repository,
                    readmePath:
                        findNamedMarkdown(sourceDir, definition.contractName) ??
                        findReadme(rootDir),
                    path: sourceDir,
                    dependsOnCrates: [],
                    sourcePath,
                    contractName: definition.contractName,
                });
            }
        }
    }

    return attachSolidityInitializations(
        attachSolidityDependencies(rootDir, dedupeTargets(targets)),
    );
}

function dedupeTargets(targets: SolidityBuildTarget[]): SolidityBuildTarget[] {
    const seen = new Set<string>();
    return targets.filter((target) => {
        const key = `${target.toolchain}:${target.contractName}:${target.sourcePath}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

function emitData(onData: ((line: string) => void) | undefined, chunk: string) {
    if (!onData) return;
    for (const line of chunk.split(/\r?\n/)) {
        if (line) onData(line);
    }
}

function runCommand(
    cmd: string,
    args: string[],
    cwd: string,
    onData?: (line: string) => void,
): Promise<CommandResult> {
    return new Promise((done) => {
        const start = Date.now();
        const child = spawn(cmd, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
        let stdout = "";
        let stderr = "";

        child.stdout.on("data", (data: Buffer) => {
            const chunk = data.toString();
            stdout += chunk;
            emitData(onData, chunk);
        });
        child.stderr.on("data", (data: Buffer) => {
            const chunk = data.toString();
            stderr += chunk;
            emitData(onData, chunk);
        });
        child.on("error", (err) => {
            done({
                success: false,
                stdout,
                stderr,
                durationMs: Date.now() - start,
                error: err.message,
            });
        });
        child.on("close", (code) => {
            done({
                success: code === 0,
                stdout,
                stderr,
                durationMs: Date.now() - start,
            });
        });
    });
}

function runCommandSyncJson(cmd: string, args: string[], cwd: string): unknown | null {
    const result = spawnSync(cmd, args, {
        cwd,
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "pipe"],
    });
    if (result.status !== 0 || !result.stdout) return null;
    try {
        return JSON.parse(result.stdout) as unknown;
    } catch {
        return null;
    }
}

function readFoundryConfig(rootDir: string): FoundryConfigJson | null {
    const config = runCommandSyncJson("forge", ["config", "--json"], rootDir);
    return config && typeof config === "object" ? (config as FoundryConfigJson) : null;
}

export function resolveFoundryOutDir(rootDir: string): string {
    const out = readFoundryConfig(rootDir)?.out;
    return resolve(rootDir, typeof out === "string" && out ? out : "out");
}

export function resolveHardhatArtifactsDir(rootDir: string): string {
    return resolve(rootDir, readHardhatPathSetting(rootDir, "artifacts") ?? "artifacts");
}

function readJson(path: string): SolidityArtifactJson | null {
    try {
        return JSON.parse(readFileSync(path, "utf-8")) as SolidityArtifactJson;
    } catch {
        return null;
    }
}

export function extractFoundryBytecode(artifactJson: unknown): string | null {
    if (typeof artifactJson !== "object" || artifactJson === null) return null;
    const bytecode = (artifactJson as { bytecode?: unknown }).bytecode;
    if (typeof bytecode !== "object" || bytecode === null) return null;
    const hex = (bytecode as { object?: unknown }).object;
    if (typeof hex !== "string") return null;
    if (hex === "" || hex === "0x") return null;
    return hex;
}

export function extractHardhatBytecode(artifactJson: unknown): string | null {
    if (typeof artifactJson !== "object" || artifactJson === null) return null;
    const hex = (artifactJson as { bytecode?: unknown }).bytecode;
    if (typeof hex !== "string") return null;
    if (hex === "" || hex === "0x") return null;
    return hex;
}

export function hexToBytes(hex: string): Uint8Array {
    const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
    if (clean.length % 2 !== 0) {
        throw new Error(`invalid hex string (odd length): ${hex.slice(0, 20)}...`);
    }
    const bytes = new Uint8Array(clean.length / 2);
    for (let i = 0; i < bytes.length; i++) {
        bytes[i] = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16);
    }
    return bytes;
}

function artifactContractName(path: string, artifact: SolidityArtifactJson): string {
    if (typeof artifact.contractName === "string" && artifact.contractName) {
        return artifact.contractName;
    }
    return basename(path, ".json");
}

function normalizePathForMatch(path: string): string {
    return path.replace(/\\/g, "/");
}

function artifactSourceName(artifact: SolidityArtifactJson): string | null {
    if (typeof artifact.sourceName === "string" && artifact.sourceName) {
        return normalizePathForMatch(artifact.sourceName);
    }
    if (typeof artifact.ast?.absolutePath === "string" && artifact.ast.absolutePath) {
        return normalizePathForMatch(artifact.ast.absolutePath);
    }
    return null;
}

function targetSourceName(
    rootDir: string,
    target: Pick<SolidityBuildTarget, "sourcePath">,
): string {
    return normalizePathForMatch(relative(rootDir, target.sourcePath));
}

function artifactMatchesTarget(
    rootDir: string,
    artifact: ScannedSolidityArtifact,
    target: Pick<SolidityBuildTarget, "contractName" | "sourcePath">,
): boolean {
    if (artifact.contractName !== target.contractName) return false;
    if (!artifact.sourceName) return true;

    const artifactSource = normalizePathForMatch(artifact.sourceName);
    const targetRelative = targetSourceName(rootDir, target);
    if (artifactSource === targetRelative) return true;

    return (
        normalizePathForMatch(resolve(rootDir, artifactSource)) ===
        normalizePathForMatch(target.sourcePath)
    );
}

function findArtifactForTarget(
    rootDir: string,
    artifacts: ScannedSolidityArtifact[],
    target: SolidityBuildTarget,
): ScannedSolidityArtifact | null {
    const matches = artifacts.filter((artifact) =>
        artifactMatchesTarget(rootDir, artifact, target),
    );
    if (matches.length === 0) return null;
    if (matches.length > 1) {
        throw new Error(
            `Multiple ${target.toolchain} artifacts matched ${targetSourceName(rootDir, target)}:${target.contractName}`,
        );
    }
    return matches[0];
}

function collectJsonFiles(
    dir: string,
    out: string[] = [],
    skipDirs: ReadonlySet<string> | null = null,
): string[] {
    if (!existsSync(dir)) return out;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
            if (!skipDirs?.has(entry.name)) {
                collectJsonFiles(full, out, skipDirs);
            }
        } else if (
            entry.isFile() &&
            entry.name.endsWith(".json") &&
            !entry.name.endsWith(".dbg.json")
        ) {
            out.push(full);
        }
    }
    return out;
}

function isHardhatArtifact(artifact: SolidityArtifactJson): boolean {
    // "hh-sol-artifact-" is upstream hardhat's format — what
    // @parity/hardhat-polkadot emits in EVM mode (`polkadot: { target: "evm" }`
    // or no polkadot flag). "hh-resolc-artifact-" is its resolc/PolkaVM mode.
    return (
        typeof artifact._format === "string" &&
        (artifact._format.startsWith("hh-sol-artifact-") ||
            artifact._format.startsWith("hh-resolc-artifact-")) &&
        typeof artifact.contractName === "string" &&
        typeof artifact.sourceName === "string" &&
        artifact.sourceName.endsWith(".sol") &&
        Array.isArray(artifact.abi)
    );
}

function scanFoundryArtifacts(rootDir: string): ScannedSolidityArtifact[] {
    const artifacts: ScannedSolidityArtifact[] = [];
    const outDir = resolveFoundryOutDir(rootDir);
    if (!existsSync(outDir)) return artifacts;

    for (const entry of readdirSync(outDir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        if (!entry.name.endsWith(".sol")) continue;
        if (entry.name.endsWith(".t.sol") || entry.name.endsWith(".s.sol")) continue;

        const dir = join(outDir, entry.name);
        for (const artifactPath of collectJsonFiles(dir)) {
            const artifact = readJson(artifactPath);
            if (!artifact) continue;
            const bytecode = extractFoundryBytecode(artifact);
            if (!bytecode) continue;
            artifacts.push({
                contractName: artifactContractName(artifactPath, artifact),
                sourceName: artifactSourceName(artifact),
                artifactPath,
                artifact,
                bytecode,
            });
        }
    }

    return artifacts;
}

function scanHardhatArtifacts(rootDir: string): ScannedSolidityArtifact[] {
    const artifacts: ScannedSolidityArtifact[] = [];
    const artifactsDir = resolveHardhatArtifactsDir(rootDir);
    const contractsDir = resolve(artifactsDir, "contracts");
    const scanDirs = existsSync(contractsDir)
        ? [contractsDir]
        : existsSync(artifactsDir)
          ? [artifactsDir]
          : [];

    for (const scanDir of scanDirs) {
        for (const artifactPath of collectJsonFiles(scanDir)) {
            const artifact = readJson(artifactPath);
            if (!artifact || !isHardhatArtifact(artifact)) continue;
            const bytecode = extractHardhatBytecode(artifact);
            if (!bytecode) continue;
            artifacts.push({
                contractName: artifactContractName(artifactPath, artifact),
                sourceName: artifactSourceName(artifact),
                artifactPath,
                artifact,
                bytecode,
            });
        }
    }

    if (artifacts.length === 0) {
        for (const artifactPath of collectJsonFiles(rootDir, [], SOLIDITY_SKIP_DIRS)) {
            const artifact = readJson(artifactPath);
            if (!artifact || !isHardhatArtifact(artifact)) continue;
            const bytecode = extractHardhatBytecode(artifact);
            if (!bytecode) continue;
            artifacts.push({
                contractName: artifactContractName(artifactPath, artifact),
                sourceName: artifactSourceName(artifact),
                artifactPath,
                artifact,
                bytecode,
            });
        }
    }

    return artifacts;
}

function scanArtifacts(rootDir: string, toolchain: SolidityToolchain): ScannedSolidityArtifact[] {
    return toolchain === "foundry" ? scanFoundryArtifacts(rootDir) : scanHardhatArtifacts(rootDir);
}

function normalizedBytecodePath(
    rootDir: string,
    toolchain: SolidityToolchain,
    name: string,
): string {
    const safeName = name.replace(/[^A-Za-z0-9_.-]/g, "_");
    return resolve(rootDir, "target", "cdm", toolchain, `${safeName}.polkavm`);
}

function writeNormalizedBytecode(
    rootDir: string,
    toolchain: SolidityToolchain,
    name: string,
    hex: string,
): { path: string; size: number } {
    const bytes = hexToBytes(hex);
    const path = normalizedBytecodePath(rootDir, toolchain, name);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, bytes);
    return { path, size: bytes.length };
}

export async function buildSolidityToolchain(
    rootDir: string,
    toolchain: SolidityToolchain,
    targets: SolidityBuildTarget[],
    options: BuildSolidityToolchainOptions = {},
): Promise<{
    result: CommandResult;
    artifacts: SolidityBuildArtifact[];
    missing: SolidityBuildTarget[];
}> {
    // Solidity contracts target pallet-revive's EVM backend: plain upstream
    // builds producing EVM bytecode (no resolc). The chain distinguishes EVM
    // initcode from PolkaVM blobs by magic bytes at upload, so the deploy
    // path is shared.
    const command =
        toolchain === "foundry"
            ? { cmd: "forge", args: ["build"] }
            : { cmd: "npx", args: ["hardhat", "compile"] };

    const result = options.skipBuild
        ? { success: true, stdout: "", stderr: "", durationMs: 0 }
        : await runCommand(command.cmd, command.args, rootDir, options.onData);
    if (!result.success) return { result, artifacts: [], missing: targets };

    const durationMs = result.durationMs;
    const scannedArtifacts = scanArtifacts(rootDir, toolchain);
    const artifacts: SolidityBuildArtifact[] = [];
    const missing: SolidityBuildTarget[] = [];

    for (const target of targets) {
        const found = findArtifactForTarget(rootDir, scannedArtifacts, target);
        if (!found) {
            missing.push(target);
            continue;
        }
        const normalized = writeNormalizedBytecode(rootDir, toolchain, target.name, found.bytecode);
        artifacts.push({
            target,
            bytecodePath: normalized.path,
            artifactPath: found.artifactPath,
            abiPath: found.artifactPath,
            bytecodeSize: normalized.size,
            durationMs,
        });
    }

    return { result, artifacts, missing };
}

/** A deployable initialization artifact selected from the toolchain's output. */
export interface SolidityInitializationArtifact {
    /** Normalized raw-bytecode blob (same shape the deployer consumes). */
    bytecodePath: string;
    /** The toolchain artifact JSON — carries the ABI and storage layout. */
    artifactPath: string;
    bytecodeSize: number;
}

/**
 * Select the toolchain artifact for one initialization contract. Foundry and
 * hardhat compile everything in-project, so the initialization is already
 * built by the time its contract's build succeeds — this just picks the right
 * artifact (by the initialization's contract name + source path) and writes
 * the normalized bytecode blob under `normalizedName`.
 */
export function findSolidityInitializationArtifact(
    rootDir: string,
    toolchain: SolidityToolchain,
    init: { contractName?: string; sourcePath: string },
    normalizedName: string,
): SolidityInitializationArtifact {
    if (!init.contractName) {
        throw new Error(`Initialization ${init.sourcePath} has no contract name`);
    }
    const matches = scanArtifacts(rootDir, toolchain).filter((artifact) =>
        artifactMatchesTarget(rootDir, artifact, {
            contractName: init.contractName!,
            sourcePath: init.sourcePath,
        }),
    );
    if (matches.length === 0) {
        throw new Error(
            `No ${toolchain} artifact found for initialization ` +
                `${targetSourceName(rootDir, init)}:${init.contractName} — did the build run?`,
        );
    }
    if (matches.length > 1) {
        throw new Error(
            `Multiple ${toolchain} artifacts matched initialization ` +
                `${targetSourceName(rootDir, init)}:${init.contractName}`,
        );
    }
    const found = matches[0];
    const normalized = writeNormalizedBytecode(rootDir, toolchain, normalizedName, found.bytecode);
    return {
        bytecodePath: normalized.path,
        artifactPath: found.artifactPath,
        bytecodeSize: normalized.size,
    };
}

export function hasBuildableSolidityProject(rootDir: string): boolean {
    return hasFoundryProject(rootDir) || hasHardhatProject(rootDir);
}

export function readSolidityAbi(artifactPath: string): AbiEntry[] {
    const artifact = readJson(artifactPath);
    return Array.isArray(artifact?.abi) ? (artifact.abi as AbiEntry[]) : [];
}

export function artifactDisplayPath(rootDir: string, path: string): string {
    return relative(rootDir, path);
}

export function bytecodeSize(path: string): number {
    return statSync(path).size;
}

if (import.meta.vitest) {
    const { afterEach, describe, expect, test } = import.meta.vitest;
    const { mkdtempSync, rmSync } = await import("fs");
    const { tmpdir } = await import("os");

    let tmpRoot: string | null = null;

    function makeProject(): string {
        tmpRoot = mkdtempSync(join(tmpdir(), "cdm-solidity-test-"));
        return tmpRoot;
    }

    afterEach(() => {
        if (tmpRoot) rmSync(tmpRoot, { recursive: true, force: true });
        tmpRoot = null;
    });

    describe("solidity build helpers", () => {
        test("detects foundry contracts from configured source dirs", () => {
            const root = makeProject();
            mkdirSync(join(root, "contracts"), { recursive: true });
            writeFileSync(join(root, "foundry.toml"), 'src = "contracts"\n');
            writeFileSync(
                join(root, "contracts", "Counter.sol"),
                `
                // abstract contract Ignored {}
                abstract contract BaseCounter {}
                contract CounterA {}
                contract CounterB {}
                `,
            );

            const targets = detectSolidityBuildTargets(root);

            expect(targets.map((target) => target.name).sort()).toEqual(["CounterA", "CounterB"]);
            expect(targets.every((target) => target.toolchain === "foundry")).toBe(true);
        });

        test("detects CDM package names from NatSpec", () => {
            const root = makeProject();
            mkdirSync(join(root, "contracts"), { recursive: true });
            writeFileSync(join(root, "foundry.toml"), 'src = "contracts"\n');
            writeFileSync(
                join(root, "contracts", "Counters.sol"),
                `
                /// @title Counter A
                /// @custom:cdm @example/counter-a
                contract CounterA {}

                /**
                 * @custom:cdm @example/counter-b
                 */
                contract CounterB {}
                `,
            );

            const targets = detectSolidityBuildTargets(root);

            expect(targets.map((target) => [target.contractName, target.cdmPackage])).toEqual([
                ["CounterA", "@example/counter-a"],
                ["CounterB", "@example/counter-b"],
            ]);
            expect(targets.map((target) => target.name)).toEqual([
                "@example/counter-a",
                "@example/counter-b",
            ]);
        });

        test("parses the version suffix from @custom:cdm @org/name:X.Y.Z", () => {
            const root = makeProject();
            mkdirSync(join(root, "contracts"), { recursive: true });
            writeFileSync(join(root, "foundry.toml"), 'src = "contracts"\n');
            writeFileSync(
                join(root, "contracts", "Counters.sol"),
                `
                /// @custom:cdm @example/counter-a:1.2.3
                contract CounterA {}

                /**
                 * @custom:cdm @example/counter-b:4.5.6
                 */
                contract CounterB {}

                /// @custom:cdm @example/counter-c
                contract CounterC {}
                `,
            );

            const targets = detectSolidityBuildTargets(root);
            const byName = new Map(targets.map((target) => [target.contractName, target]));

            // The suffix never leaks into the package name.
            expect(byName.get("CounterA")?.cdmPackage).toBe("@example/counter-a");
            expect(byName.get("CounterA")?.version).toBe("1.2.3");
            expect(byName.get("CounterB")?.cdmPackage).toBe("@example/counter-b");
            expect(byName.get("CounterB")?.version).toBe("4.5.6");
            // A tag without the suffix still detects — just with no version.
            expect(byName.get("CounterC")?.cdmPackage).toBe("@example/counter-c");
            expect(byName.get("CounterC")?.version).toBeUndefined();
        });

        test("uses contract NatSpec metadata before project package metadata", () => {
            const root = makeProject();
            mkdirSync(join(root, "contracts"), { recursive: true });
            writeFileSync(join(root, "foundry.toml"), 'src = "contracts"\n');
            writeFileSync(
                join(root, "package.json"),
                JSON.stringify({
                    description: "Project description",
                    authors: ["Project Author"],
                    homepage: "https://example.com/project",
                    repository: "https://example.com/project.git",
                }),
            );
            writeFileSync(
                join(root, "contracts", "Counter.sol"),
                `
                /**
                 * @custom:cdm @example/counter-a
                 * @notice Contract description.
                 * Continued description.
                 * @author Contract Author
                 * @custom:homepage https://example.com/counter
                 * @custom:repository https://example.com/counter.git
                 */
                contract CounterA {}

                contract CounterB {}
                `,
            );

            const targets = detectSolidityBuildTargets(root);
            const byName = new Map(targets.map((target) => [target.contractName, target]));

            expect(byName.get("CounterA")?.description).toBe(
                "Contract description. Continued description.",
            );
            expect(byName.get("CounterA")?.authors).toEqual(["Contract Author"]);
            expect(byName.get("CounterA")?.homepage).toBe("https://example.com/counter");
            expect(byName.get("CounterA")?.repository).toBe("https://example.com/counter.git");
            expect(byName.get("CounterB")?.description).toBe("Project description");
            expect(byName.get("CounterB")?.authors).toEqual(["Project Author"]);
            expect(byName.get("CounterB")?.homepage).toBe("https://example.com/project");
            expect(byName.get("CounterB")?.repository).toBe("https://example.com/project.git");
        });

        test("prefers contract-name markdown next to source before root readme", () => {
            const root = makeProject();
            mkdirSync(join(root, "contracts"), { recursive: true });
            writeFileSync(join(root, "foundry.toml"), 'src = "contracts"\n');
            writeFileSync(join(root, "README.md"), "root docs");
            writeFileSync(join(root, "contracts", "CountttterA.md"), "contract docs");
            writeFileSync(
                join(root, "contracts", "CounterA.sol"),
                `
                contract CountttterA {}
                contract CounterB {}
                `,
            );

            const targets = detectSolidityBuildTargets(root);
            const byName = new Map(targets.map((target) => [target.contractName, target]));

            expect(byName.get("CountttterA")?.readmePath).toBe(
                join(root, "contracts", "CountttterA.md"),
            );
            expect(byName.get("CounterB")?.readmePath).toBe(join(root, "README.md"));
        });

        test("leaves Solidity readme empty when no contract or root readme exists", () => {
            const root = makeProject();
            mkdirSync(join(root, "contracts"), { recursive: true });
            writeFileSync(join(root, "foundry.toml"), 'src = "contracts"\n');
            writeFileSync(join(root, "contracts", "Counter.sol"), "contract CounterA {}\n");

            const [target] = detectSolidityBuildTargets(root);

            expect(target?.readmePath).toBeNull();
        });

        test("detects local Solidity CDM dependencies from generated imports", () => {
            const root = makeProject();
            mkdirSync(join(root, "contracts"), { recursive: true });
            writeFileSync(join(root, "foundry.toml"), 'src = "contracts"\n');
            writeFileSync(
                join(root, "contracts", "CounterA.sol"),
                "/// @custom:cdm @example/counter-a\ncontract CounterA {}\n",
            );
            writeFileSync(
                join(root, "contracts", "CounterB.sol"),
                `
                import "../.cdm/solidity/example/counter-a.sol";
                /// @custom:cdm @example/counter-b
                contract CounterB {}
                `,
            );

            const targets = detectSolidityBuildTargets(root);
            const byName = new Map(targets.map((target) => [target.name, target]));

            expect(byName.get("@example/counter-a")?.dependsOnCrates).toEqual([]);
            expect(byName.get("@example/counter-b")?.dependsOnCrates).toEqual([
                "@example/counter-a",
            ]);
        });

        test("detects local Solidity CDM dependencies through foundry remappings", () => {
            const root = makeProject();
            mkdirSync(join(root, "contracts"), { recursive: true });
            writeFileSync(join(root, "foundry.toml"), 'src = "contracts"\n');
            writeFileSync(join(root, "remappings.txt"), "@cdm/=.cdm/solidity/\n");
            writeFileSync(
                join(root, "contracts", "CounterA.sol"),
                "/// @custom:cdm @example/counter-a\ncontract CounterA {}\n",
            );
            writeFileSync(
                join(root, "contracts", "CounterB.sol"),
                `
                import "@cdm/example/counter-a.sol";
                /// @custom:cdm @example/counter-b
                contract CounterB {}
                `,
            );

            const targets = detectSolidityBuildTargets(root);
            const byName = new Map(targets.map((target) => [target.name, target]));

            expect(byName.get("@example/counter-a")?.dependsOnCrates).toEqual([]);
            expect(byName.get("@example/counter-b")?.dependsOnCrates).toEqual([
                "@example/counter-a",
            ]);
        });

        test("detects hardhat contracts from contracts dir", () => {
            const root = makeProject();
            mkdirSync(join(root, "contracts"), { recursive: true });
            writeFileSync(join(root, "hardhat.config.ts"), "export default {};\n");
            writeFileSync(join(root, "contracts", "Counter.sol"), "contract CounterA {}\n");

            const [target] = detectSolidityBuildTargets(root);

            expect(target?.name).toBe("CounterA");
            expect(target?.toolchain).toBe("hardhat");
        });

        test("detects hardhat contracts from configured sources dir", () => {
            const root = makeProject();
            mkdirSync(join(root, "src"), { recursive: true });
            writeFileSync(
                join(root, "hardhat.config.ts"),
                'export default { paths: { sources: "src" } };\n',
            );
            writeFileSync(join(root, "src", "Counter.sol"), "contract CounterA {}\n");

            const [target] = detectSolidityBuildTargets(root);

            expect(target?.name).toBe("CounterA");
            expect(target?.sourcePath).toBe(join(root, "src", "Counter.sol"));
        });

        test("reads hardhat artifacts from configured artifacts dir", async () => {
            const root = makeProject();
            mkdirSync(join(root, "src"), { recursive: true });
            mkdirSync(join(root, "build-artifacts", "src", "Counter.sol"), { recursive: true });
            writeFileSync(
                join(root, "hardhat.config.ts"),
                'export default { paths: { sources: "src", artifacts: "build-artifacts" } };\n',
            );
            writeFileSync(join(root, "src", "Counter.sol"), "contract CounterA {}\n");
            writeFileSync(
                join(root, "build-artifacts", "src", "Counter.sol", "CounterA.json"),
                // Upstream hardhat format — what EVM-mode compiles emit.
                JSON.stringify({
                    _format: "hh-sol-artifact-1",
                    contractName: "CounterA",
                    sourceName: "src/Counter.sol",
                    abi: [],
                    bytecode: "0x0102",
                }),
            );
            writeFileSync(
                join(root, "build-artifacts", "src", "Counter.sol", "Unrelated.json"),
                JSON.stringify({
                    _format: "not-a-hardhat-polkadot-artifact",
                    contractName: "Unrelated",
                    sourceName: "src/Counter.sol",
                    abi: [],
                    bytecode: "0x0304",
                }),
            );

            const targets = detectSolidityBuildTargets(root);
            const { artifacts, missing } = await buildSolidityToolchain(root, "hardhat", targets, {
                skipBuild: true,
            });

            expect(missing).toEqual([]);
            expect(artifacts).toHaveLength(1);
            expect(artifacts[0].artifactPath).toBe(
                join(root, "build-artifacts", "src", "Counter.sol", "CounterA.json"),
            );
            expect([...readFileSync(artifacts[0].bytecodePath)]).toEqual([1, 2]);
        });

        test("matches hardhat artifacts by source file and contract name", async () => {
            const root = makeProject();
            mkdirSync(join(root, "src", "a"), { recursive: true });
            mkdirSync(join(root, "src", "b"), { recursive: true });
            mkdirSync(join(root, "artifacts", "src", "a", "Counter.sol"), { recursive: true });
            mkdirSync(join(root, "artifacts", "src", "b", "Counter.sol"), { recursive: true });
            writeFileSync(
                join(root, "hardhat.config.ts"),
                'export default { paths: { sources: "src" } };\n',
            );
            writeFileSync(
                join(root, "src", "a", "Counter.sol"),
                "/// @custom:cdm @example/a-counter\ncontract Counter {}\n",
            );
            writeFileSync(
                join(root, "src", "b", "Counter.sol"),
                "/// @custom:cdm @example/b-counter\ncontract Counter {}\n",
            );
            writeFileSync(
                join(root, "artifacts", "src", "a", "Counter.sol", "Counter.json"),
                JSON.stringify({
                    _format: "hh-resolc-artifact-1",
                    contractName: "Counter",
                    sourceName: "src/a/Counter.sol",
                    abi: [],
                    bytecode: "0x0a",
                }),
            );
            writeFileSync(
                join(root, "artifacts", "src", "b", "Counter.sol", "Counter.json"),
                JSON.stringify({
                    _format: "hh-resolc-artifact-1",
                    contractName: "Counter",
                    sourceName: "src/b/Counter.sol",
                    abi: [],
                    bytecode: "0x0b",
                }),
            );

            const targets = detectSolidityBuildTargets(root);
            const { artifacts, missing } = await buildSolidityToolchain(root, "hardhat", targets, {
                skipBuild: true,
            });
            const byPackage = new Map(
                artifacts.map((artifact) => [artifact.target.name, artifact]),
            );

            expect(missing).toEqual([]);
            expect(byPackage.get("@example/a-counter")?.artifactPath).toBe(
                join(root, "artifacts", "src", "a", "Counter.sol", "Counter.json"),
            );
            expect(byPackage.get("@example/b-counter")?.artifactPath).toBe(
                join(root, "artifacts", "src", "b", "Counter.sol", "Counter.json"),
            );
            expect([...readFileSync(byPackage.get("@example/a-counter")!.bytecodePath)]).toEqual([
                10,
            ]);
            expect([...readFileSync(byPackage.get("@example/b-counter")!.bytecodePath)]).toEqual([
                11,
            ]);
        });

        test("routes initializations by directory name without treating them as targets", () => {
            const root = makeProject();
            mkdirSync(join(root, "contracts", "initializations", "CounterA"), {
                recursive: true,
            });
            writeFileSync(join(root, "foundry.toml"), 'src = "contracts"\n');
            writeFileSync(
                join(root, "contracts", "Counters.sol"),
                `
                /// @custom:cdm @example/counter-a:0.2.0
                contract CounterA {}
                /// @custom:cdm @example/counter-b:0.1.0
                contract CounterB {}
                `,
            );
            writeFileSync(
                join(root, "contracts", "initializations", "CounterA", "0.2.0.sol"),
                `
                import "../../Counters.sol";
                contract Init_0_2_0 is CounterA {
                    function initialize(uint128 from, address owner) external {}
                }
                `,
            );

            const targets = detectSolidityBuildTargets(root);
            const byName = new Map(targets.map((target) => [target.contractName, target]));

            // The initialization contract is never a deploy target.
            expect(targets.map((target) => target.contractName).sort()).toEqual([
                "CounterA",
                "CounterB",
            ]);
            // The directory name routes the file to CounterA only.
            expect(byName.get("CounterA")?.initializations).toEqual([
                {
                    version: "0.2.0",
                    sourcePath: join(root, "contracts", "initializations", "CounterA", "0.2.0.sol"),
                    contractName: "Init_0_2_0",
                },
            ]);
            expect(byName.get("CounterB")?.initializations).toBeUndefined();
        });

        test("errors when the initialization does not inherit its directory's contract", () => {
            const root = makeProject();
            mkdirSync(join(root, "contracts", "initializations", "Counter"), {
                recursive: true,
            });
            writeFileSync(join(root, "foundry.toml"), 'src = "contracts"\n');
            writeFileSync(
                join(root, "contracts", "Counter.sol"),
                "/// @custom:cdm @example/counter\ncontract Counter {}\n",
            );
            writeFileSync(
                join(root, "contracts", "initializations", "Counter", "0.1.0.sol"),
                "contract Standalone { function initialize(uint128, address) external {} }\n",
            );

            expect(() => detectSolidityBuildTargets(root)).toThrow(
                /0\.1\.0\.sol must contain a contract inheriting Counter/,
            );
        });

        test("errors on a version file sitting flat in initializations/", () => {
            const root = makeProject();
            mkdirSync(join(root, "contracts", "initializations"), { recursive: true });
            writeFileSync(join(root, "foundry.toml"), 'src = "contracts"\n');
            writeFileSync(
                join(root, "contracts", "Counter.sol"),
                "/// @custom:cdm @example/counter\ncontract Counter {}\n",
            );
            writeFileSync(
                join(root, "contracts", "initializations", "0.1.0.sol"),
                'import "../Counter.sol";\ncontract Init_0_1_0 is Counter {}\n',
            );

            // The flat form is never accepted — the error teaches the
            // per-contract layout instead of guessing a route.
            expect(() => detectSolidityBuildTargets(root)).toThrow(
                /move it to initializations\/<ContractName>\/0\.1\.0\.sol/,
            );
        });

        test("errors when an initialization directory names no CDM contract", () => {
            const root = makeProject();
            mkdirSync(join(root, "contracts", "initializations", "CountrA"), {
                recursive: true,
            });
            writeFileSync(join(root, "foundry.toml"), 'src = "contracts"\n');
            writeFileSync(
                join(root, "contracts", "Counter.sol"),
                "/// @custom:cdm @example/counter\ncontract Counter {}\n",
            );
            writeFileSync(
                join(root, "contracts", "initializations", "CountrA", "0.1.0.sol"),
                'import "../../Counter.sol";\ncontract Init_0_1_0 is Counter {}\n',
            );

            expect(() => detectSolidityBuildTargets(root)).toThrow(
                /CountrA does not name a CDM contract.*\(Counter\)/,
            );
        });

        test("selects the initialization artifact by contract name and source path", () => {
            const root = makeProject();
            const initDir = join("contracts", "initializations", "Counter");
            mkdirSync(join(root, initDir), { recursive: true });
            mkdirSync(join(root, "artifacts", initDir, "0.1.0.sol"), {
                recursive: true,
            });
            writeFileSync(join(root, "hardhat.config.ts"), "export default {};\n");
            writeFileSync(join(root, initDir, "0.1.0.sol"), "contract Init_0_1_0 is Counter {}\n");
            writeFileSync(
                join(root, "artifacts", initDir, "0.1.0.sol", "Init_0_1_0.json"),
                JSON.stringify({
                    _format: "hh-sol-artifact-1",
                    contractName: "Init_0_1_0",
                    sourceName: "contracts/initializations/Counter/0.1.0.sol",
                    abi: [],
                    bytecode: "0x0ab1",
                }),
            );

            const artifact = findSolidityInitializationArtifact(
                root,
                "hardhat",
                {
                    contractName: "Init_0_1_0",
                    sourcePath: join(root, initDir, "0.1.0.sol"),
                },
                "counter-init-0.1.0",
            );
            expect([...readFileSync(artifact.bytecodePath)]).toEqual([0x0a, 0xb1]);
            expect(artifact.artifactPath.endsWith("Init_0_1_0.json")).toBe(true);

            expect(() =>
                findSolidityInitializationArtifact(
                    root,
                    "hardhat",
                    {
                        contractName: "Init_9_9_9",
                        sourcePath: join(root, initDir, "9.9.9.sol"),
                    },
                    "counter-init-9.9.9",
                ),
            ).toThrow(/No hardhat artifact/);
        });

        test("extracts deployable bytecode from foundry and hardhat artifacts", () => {
            expect(extractFoundryBytecode({ bytecode: { object: "0x0102" } })).toBe("0x0102");
            expect(extractFoundryBytecode({ bytecode: { object: "0x" } })).toBeNull();
            expect(extractHardhatBytecode({ bytecode: "0x0304" })).toBe("0x0304");
            expect(extractHardhatBytecode({ bytecode: "0x" })).toBeNull();
        });

        test("converts hex bytecode into bytes", () => {
            expect([...hexToBytes("0x000f10")]).toEqual([0, 15, 16]);
            expect(() => hexToBytes("0x123")).toThrow("odd length");
        });
    });
}
