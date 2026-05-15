import { spawn } from "child_process";
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
    contractName?: string;
    sourceName?: string;
    abi?: unknown;
    bytecode?: unknown;
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

function extractContractNames(source: string): string[] {
    const withoutComments = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    const names = new Set<string>();
    const re = /\bcontract\s+([A-Za-z_][A-Za-z0-9_]*)/g;
    let match: RegExpExecArray | null;
    while ((match = re.exec(withoutComments))) {
        const prefix = withoutComments.slice(Math.max(0, match.index - 16), match.index);
        if (/\babstract\s+$/.test(prefix)) continue;
        names.add(match[1]);
    }
    return [...names].sort();
}

function readFoundrySourceDirs(rootDir: string): string[] {
    const foundryTomlPath = resolve(rootDir, "foundry.toml");
    const dirs = new Set(["contracts", "src"]);

    if (existsSync(foundryTomlPath)) {
        const content = readFileSync(foundryTomlPath, "utf-8");
        const match = content.match(/^\s*src\s*=\s*["']([^"']+)["']/m);
        if (match?.[1]) dirs.add(match[1]);
    }

    return [...dirs].map((dir) => resolve(rootDir, dir)).filter((dir) => existsSync(dir));
}

function sourceDirsForToolchain(rootDir: string, toolchain: SolidityToolchain): string[] {
    if (toolchain === "foundry") return readFoundrySourceDirs(rootDir);
    const contractsDir = resolve(rootDir, "contracts");
    return existsSync(contractsDir) ? [contractsDir] : [];
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
            for (const contractName of extractContractNames(source)) {
                targets.push({
                    name: contractName,
                    displayName: contractName,
                    toolchain,
                    cdmPackage: null,
                    description: meta.description,
                    authors: meta.authors,
                    homepage: meta.homepage,
                    repository: meta.repository,
                    readmePath: findProjectReadme(rootDir),
                    path: dirname(sourcePath),
                    dependsOnCrates: [],
                    sourcePath,
                    contractName,
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

function collectJsonFiles(dir: string, out: string[] = []): string[] {
    if (!existsSync(dir)) return out;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
            collectJsonFiles(full, out);
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

function scanFoundryArtifacts(
    rootDir: string,
): Map<string, { artifactPath: string; artifact: SolidityArtifactJson; bytecode: string }> {
    const artifacts = new Map<
        string,
        { artifactPath: string; artifact: SolidityArtifactJson; bytecode: string }
    >();
    const outDir = resolve(rootDir, "out");
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
            artifacts.set(artifactContractName(artifactPath, artifact), {
                artifactPath,
                artifact,
                bytecode,
            });
        }
    }

    return artifacts;
}

function scanHardhatArtifacts(
    rootDir: string,
): Map<string, { artifactPath: string; artifact: SolidityArtifactJson; bytecode: string }> {
    const artifacts = new Map<
        string,
        { artifactPath: string; artifact: SolidityArtifactJson; bytecode: string }
    >();
    const artifactsDir = resolve(rootDir, "artifacts", "contracts");
    if (!existsSync(artifactsDir)) return artifacts;

    for (const artifactPath of collectJsonFiles(artifactsDir)) {
        const artifact = readJson(artifactPath);
        if (!artifact) continue;
        const bytecode = extractHardhatBytecode(artifact);
        if (!bytecode) continue;
        artifacts.set(artifactContractName(artifactPath, artifact), {
            artifactPath,
            artifact,
            bytecode,
        });
    }

    return artifacts;
}

function scanArtifacts(
    rootDir: string,
    toolchain: SolidityToolchain,
): Map<string, { artifactPath: string; artifact: SolidityArtifactJson; bytecode: string }> {
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

function makeTargetFromArtifact(
    rootDir: string,
    toolchain: SolidityToolchain,
    contractName: string,
    artifactPath: string,
): SolidityBuildTarget {
    const meta = readPackageMetadata(rootDir);
    const sourcePath = resolve(
        rootDir,
        (readJson(artifactPath)?.sourceName as string | undefined) ?? "",
    );
    return {
        name: contractName,
        displayName: contractName,
        toolchain,
        cdmPackage: null,
        description: meta.description,
        authors: meta.authors,
        homepage: meta.homepage,
        repository: meta.repository,
        readmePath: findProjectReadme(rootDir),
        path: existsSync(sourcePath) ? dirname(sourcePath) : rootDir,
        dependsOnCrates: [],
        sourcePath: existsSync(sourcePath) ? sourcePath : artifactPath,
        contractName,
    };
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
    const artifactMap = scanArtifacts(rootDir, toolchain);
    const byName = new Map(targets.map((target) => [target.contractName, target]));
    const artifacts: SolidityBuildArtifact[] = [];

    for (const [contractName, found] of artifactMap) {
        const target =
            byName.get(contractName) ??
            makeTargetFromArtifact(rootDir, toolchain, contractName, found.artifactPath);
        const normalized = writeNormalizedBytecode(
            rootDir,
            toolchain,
            contractName,
            found.bytecode,
        );
        artifacts.push({
            target,
            bytecodePath: normalized.path,
            artifactPath: found.artifactPath,
            abiPath: found.artifactPath,
            bytecodeSize: normalized.size,
            durationMs,
        });
    }

    const builtNames = new Set(artifacts.map((artifact) => artifact.target.contractName));
    const missing = targets.filter((target) => !builtNames.has(target.contractName));
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

        test("detects hardhat contracts from contracts dir", () => {
            const root = makeProject();
            mkdirSync(join(root, "contracts"), { recursive: true });
            writeFileSync(join(root, "hardhat.config.ts"), "export default {};\n");
            writeFileSync(join(root, "contracts", "Counter.sol"), "contract CounterA {}\n");

            const [target] = detectSolidityBuildTargets(root);

            expect(target?.name).toBe("CounterA");
            expect(target?.toolchain).toBe("hardhat");
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
