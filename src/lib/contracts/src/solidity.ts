import { spawn, spawnSync } from "child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "fs";
import { basename, dirname, join, relative, resolve } from "path";
import type { AbiEntry } from "./deployer";
import type { ContractInfo, ContractToolchain } from "./detection";

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
            if (!SOLIDITY_SKIP_DIRS.has(entry.name)) {
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
}

const CDM_NATSPEC_RE = /@custom:cdm\s+(@[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)+)/;

function blankBlockComments(source: string): string {
    return source.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, " "));
}

function precedingCdmPackage(source: string, declarationIndex: number): string | null {
    const before = source.slice(0, declarationIndex).replace(/\s*$/g, "");
    const lineComment = before.match(/(?:^|\n)(?:\s*\/\/\/[^\n]*\n?)+$/);
    const blockComment = before.match(/\/\*\*[\s\S]*?\*\/$/);
    return (lineComment?.[0] ?? blockComment?.[0])?.match(CDM_NATSPEC_RE)?.[1] ?? null;
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
        definitions.set(contractName, {
            contractName,
            cdmPackage: precedingCdmPackage(source, declarationIndex),
        });
    }
    return [...definitions.values()].sort((a, b) => a.contractName.localeCompare(b.contractName));
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
                targets.push({
                    name: definition.cdmPackage ?? definition.contractName,
                    displayName: definition.cdmPackage ?? definition.contractName,
                    toolchain,
                    cdmPackage: definition.cdmPackage,
                    description: meta.description,
                    authors: meta.authors,
                    homepage: meta.homepage,
                    repository: meta.repository,
                    readmePath: findProjectReadme(rootDir),
                    path: dirname(sourcePath),
                    dependsOnCrates: [],
                    sourcePath,
                    contractName: definition.contractName,
                });
            }
        }
    }

    return dedupeTargets(targets);
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

function findProjectReadme(rootDir: string): string | null {
    for (const name of ["README.md", "README.txt", "README", "readme.md"]) {
        const p = resolve(rootDir, name);
        if (existsSync(p)) return p;
    }
    return null;
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

function targetSourceName(rootDir: string, target: SolidityBuildTarget): string {
    return normalizePathForMatch(relative(rootDir, target.sourcePath));
}

function artifactMatchesTarget(
    rootDir: string,
    artifact: ScannedSolidityArtifact,
    target: SolidityBuildTarget,
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
    return (
        typeof artifact._format === "string" &&
        artifact._format.startsWith("hh-resolc-artifact-") &&
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
    const command =
        toolchain === "foundry"
            ? { cmd: "forge", args: ["build", "--resolc"] }
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
                JSON.stringify({
                    _format: "hh-resolc-artifact-1",
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
