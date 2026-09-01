import { join, resolve } from "path";
import { execFile, execFileSync, spawn } from "child_process";
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { promisify } from "util";
import { getCargoMetadata, type CargoDependency, type CargoPackage } from "./detection";

const execFileAsync = promisify(execFile);

export interface BuildResult {
    crateName: string;
    success: boolean;
    stdout: string;
    stderr: string;
    durationMs: number;
}

export type BuildProgressCallback = (
    processed: number,
    total: number | undefined,
    currentCrate: string,
) => void;

/**
 * Build a single contract using `cargo pvm-contract build`.
 *
 * `registryAddress` is embedded into the contract via `CONTRACTS_REGISTRY_ADDR`
 * and must be resolved explicitly by the caller (CLI/pipeline) — there is no
 * implicit default, so an omitted address can never silently embed the wrong
 * network's registry.
 */
export function pvmContractBuild(
    rootDir: string,
    crateName: string,
    features: string | undefined,
    registryAddress: string,
): void {
    const manifestPath = resolve(rootDir, "Cargo.toml");
    const args = ["pvm-contract", "build", "--manifest-path", manifestPath, "-p", crateName];
    if (features) {
        args.push("--features", features);
    }
    const env: Record<string, string> = {
        ...(process.env as Record<string, string>),
        CONTRACTS_REGISTRY_ADDR: registryAddress,
    };
    execFileSync("cargo", args, { cwd: rootDir, stdio: "inherit", env });
}

/**
 * Build a single contract asynchronously with progress tracking.
 *
 * See {@link pvmContractBuild} for why `registryAddress` is required.
 */
export async function pvmContractBuildAsync(
    rootDir: string,
    crateName: string,
    onProgress: BuildProgressCallback | undefined,
    features: string | undefined,
    registryAddress: string,
): Promise<BuildResult> {
    const manifestPath = resolve(rootDir, "Cargo.toml");

    return new Promise((done) => {
        const startTime = Date.now();
        const args = [
            "pvm-contract",
            "build",
            "--manifest-path",
            manifestPath,
            "-p",
            crateName,
            "--message-format",
            "json,json-diagnostic-rendered-ansi",
        ];
        if (features) {
            args.push("--features", features);
        }
        const env: Record<string, string> = {
            ...(process.env as Record<string, string>),
            CONTRACTS_REGISTRY_ADDR: registryAddress,
        };

        let stdout = "";
        let stderr = "";
        let compilerMessages = "";
        let artifactsSeen = 0;
        let total: number | undefined;
        let stdoutLineBuffer = "";

        const child = spawn("cargo", args, {
            cwd: rootDir,
            env,
            stdio: ["pipe", "pipe", "pipe"],
        });

        const handleStdoutLine = (line: string) => {
            const trimmed = line.trim();
            if (!trimmed) return;
            try {
                const msg = JSON.parse(trimmed);
                const cpcBuildPlan =
                    msg.reason === "cargo-pvm-contract-build-plan" &&
                    msg.unit === "compiler-artifact";
                const legacyBuildPlan = msg.reason === "build-plan";
                if ((cpcBuildPlan || legacyBuildPlan) && typeof msg.total === "number") {
                    total = msg.total > 0 ? msg.total : undefined;
                    onProgress?.(artifactsSeen, total, crateName);
                } else if (msg.reason === "compiler-artifact") {
                    artifactsSeen++;
                    const name = msg.target?.name ?? "unknown";
                    onProgress?.(artifactsSeen, total, name);
                } else if (msg.reason === "compiler-message" && msg.message?.rendered) {
                    compilerMessages += msg.message.rendered;
                }
            } catch {
                // Not JSON, ignore
            }
        };

        child.stdout.on("data", (data: Buffer) => {
            const text = data.toString();
            stdout += text;
            stdoutLineBuffer += text;

            const lines = stdoutLineBuffer.split("\n");
            stdoutLineBuffer = lines.pop() ?? "";
            for (const line of lines) handleStdoutLine(line);
        });

        child.stderr.on("data", (data: Buffer) => {
            const text = data.toString();
            stderr += text;
        });

        child.on("close", (code) => {
            handleStdoutLine(stdoutLineBuffer);
            stdoutLineBuffer = "";

            const fullStderr = compilerMessages ? compilerMessages + stderr : stderr;
            done({
                crateName,
                success: code === 0,
                stdout,
                stderr: fullStderr,
                durationMs: Date.now() - startTime,
            });
        });

        child.on("error", (err) => {
            const fullStderr = compilerMessages ? compilerMessages + stderr : stderr;
            done({
                crateName,
                success: false,
                stdout,
                stderr: fullStderr + "\n" + err.message,
                durationMs: Date.now() - startTime,
            });
        });
    });
}

// ─── Initialization shim builds ──────────────────────────────────────────────

/** Serialize one resolved dependency row back into a Cargo.toml spec. */
function tomlDependency(dep: CargoDependency): string {
    const parts: string[] = [];
    if (dep.source?.startsWith("git+")) {
        const [url, query = ""] = dep.source.slice(4).split("#")[0].split("?");
        parts.push(`git = "${url}"`);
        for (const pair of query.split("&")) {
            const [key, value] = pair.split("=");
            if (["branch", "tag", "rev"].includes(key)) parts.push(`${key} = "${value}"`);
        }
    } else if (dep.path) {
        parts.push(`path = "${dep.path}"`);
    } else {
        parts.push(`version = "${dep.req ?? "*"}"`);
    }
    if (dep.rename) parts.push(`package = "${dep.name}"`);
    if (dep.features?.length) {
        parts.push(`features = [${dep.features.map((f) => `"${f}"`).join(", ")}]`);
    }
    if (dep.uses_default_features === false) parts.push("default-features = false");
    return `${dep.rename ?? dep.name} = { ${parts.join(", ")} }`;
}

/**
 * The generated manifest of an initialization's shim crate: a detached
 * one-bin package pointing straight at the `initializations/<version>.rs`
 * file, with edition and (normal) dependencies copied from the contract
 * crate so the file compiles against exactly what the contract compiles
 * against. This is what makes initializations manifest-free for users.
 */
export function generateInitializationManifest(
    pkg: CargoPackage,
    initSourcePath: string,
    shimName: string,
): string {
    const deps = pkg.dependencies.filter((dep) => dep.kind === null && !dep.optional);
    const abiGen = pkg.features["abi-gen"] ?? ["pvm-contract-sdk/abi-gen"];
    return [
        "# Generated by cdm — the build shim for one initialization. Do not edit.",
        "[workspace]",
        "",
        "[package]",
        `name = "${shimName}"`,
        'version = "0.0.0"',
        `edition = "${pkg.edition}"`,
        "publish = false",
        "",
        "[features]",
        `abi-gen = [${abiGen.map((f) => `"${f}"`).join(", ")}]`,
        "",
        "[[bin]]",
        `name = "${shimName}"`,
        `path = "${initSourcePath}"`,
        "",
        "[dependencies]",
        ...deps.map(tomlDependency),
        "",
    ].join("\n");
}

export interface RustInitializationBuild {
    pvmPath: string;
    abiPath: string;
}

/**
 * Build `initializations/<version>.rs` for `crateName` through a generated
 * shim crate under `target/cdm/init-build/` — the user creates the file and
 * nothing else. Returns the built `.polkavm` + `.abi.json` paths.
 */
export async function buildRustInitialization(
    rootDir: string,
    crateName: string,
    init: { version: string; sourcePath: string },
    registryAddress?: string,
): Promise<RustInitializationBuild> {
    const pkg = getCargoMetadata(rootDir).packages.find((entry) => entry.name === crateName);
    if (!pkg) throw new Error(`Crate ${crateName} not found in ${rootDir}'s cargo metadata`);

    const shimName = `${crateName.replace(/_/g, "-")}-init-${init.version.replace(/\./g, "-")}`;
    const shimDir = resolve(rootDir, "target/cdm/init-build", shimName);
    mkdirSync(shimDir, { recursive: true });
    writeFileSync(
        join(shimDir, "Cargo.toml"),
        generateInitializationManifest(pkg, resolve(init.sourcePath), shimName),
    );

    try {
        await execFileAsync(
            "cargo",
            ["pvm-contract", "build", "--manifest-path", join(shimDir, "Cargo.toml")],
            {
                cwd: rootDir,
                maxBuffer: 16 * 1024 * 1024,
                env: {
                    ...process.env,
                    ...(registryAddress ? { CONTRACTS_REGISTRY_ADDR: registryAddress } : {}),
                },
            },
        );
    } catch (err) {
        const stderr = (err as { stderr?: string }).stderr ?? String(err);
        throw new Error(
            `Failed to build initialization ${init.sourcePath}:\n${stderr.slice(-4000)}`,
        );
    }

    const pvmPath = join(shimDir, `target/release/${shimName}.polkavm`);
    if (!existsSync(pvmPath)) {
        throw new Error(`Initialization build produced no artifact at ${pvmPath}`);
    }
    return { pvmPath, abiPath: join(shimDir, `target/release/${shimName}.abi.json`) };
}

if (import.meta.vitest) {
    const { describe, expect, test } = import.meta.vitest;

    describe("generateInitializationManifest", () => {
        test("reproduces git, registry, and path dependency shapes", () => {
            const pkg = {
                name: "counter",
                edition: "2024",
                features: {},
                dependencies: [
                    {
                        name: "pvm-contract-sdk",
                        kind: null,
                        path: null,
                        source: "git+https://github.com/paritytech/cargo-pvm-contract?branch=main#abc123",
                        req: "*",
                        features: ["alloc"],
                        uses_default_features: true,
                    },
                    {
                        name: "picoalloc",
                        kind: null,
                        path: null,
                        source: "registry+https://github.com/rust-lang/crates.io-index",
                        req: "^5.2",
                        uses_default_features: false,
                    },
                    { name: "shared", kind: null, path: "/abs/shared", source: null },
                    { name: "devtool", kind: "dev", path: null, req: "^1" },
                ],
            } as unknown as CargoPackage;

            const manifest = generateInitializationManifest(
                pkg,
                "/proj/contracts/counter/initializations/0.1.0.rs",
                "counter-init-0-1-0",
            );
            expect(manifest).toContain(
                'pvm-contract-sdk = { git = "https://github.com/paritytech/cargo-pvm-contract", branch = "main", features = ["alloc"] }',
            );
            expect(manifest).toContain(
                'picoalloc = { version = "^5.2", default-features = false }',
            );
            expect(manifest).toContain('shared = { path = "/abs/shared" }');
            expect(manifest).not.toContain("devtool"); // dev deps are dropped
            expect(manifest).toContain('path = "/proj/contracts/counter/initializations/0.1.0.rs"');
            // The abi-gen feature is synthesized when the contract has none.
            expect(manifest).toContain('abi-gen = ["pvm-contract-sdk/abi-gen"]');
            expect(manifest).toContain("[workspace]");
        });

        test("mirrors the contract's own abi-gen feature when declared", () => {
            const pkg = {
                name: "c",
                edition: "2021",
                features: { "abi-gen": ["pvm-contract-sdk/abi-gen", "other/x"] },
                dependencies: [],
            } as unknown as CargoPackage;
            expect(generateInitializationManifest(pkg, "/x/0.1.0.rs", "c-init-0-1-0")).toContain(
                'abi-gen = ["pvm-contract-sdk/abi-gen", "other/x"]',
            );
        });
    });
}
