import { exec } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir, platform } from "node:os";
import { resolve } from "node:path";
import { runShell } from "./process";
import { cdmHome, releaseAssetName } from "./releases";

export { releaseAssetName };

function run(cmd: string): Promise<string> {
    return new Promise((resolve, reject) => {
        exec(cmd, { shell: "bash" }, (err, stdout) => {
            if (err) reject(err);
            else resolve(stdout);
        });
    });
}

function sudo(): string {
    return typeof process.getuid === "function" && process.getuid() === 0 ? "" : "sudo ";
}

export function prependPath(dir: string): void {
    const segments = (process.env.PATH ?? "").split(":").filter(Boolean);
    if (segments.includes(dir)) return;
    process.env.PATH = process.env.PATH ? `${dir}:${process.env.PATH}` : dir;
}

export async function commandExists(cmd: string): Promise<boolean> {
    if (!/^[a-zA-Z0-9_-]+$/.test(cmd)) {
        throw new Error(`Invalid command name: ${cmd}`);
    }
    try {
        await run(`command -v ${cmd}`);
        return true;
    } catch {
        return false;
    }
}

async function hasRustNightly(): Promise<boolean> {
    try {
        return (await run("rustup toolchain list")).includes("nightly");
    } catch {
        return false;
    }
}

async function hasRustSrc(): Promise<boolean> {
    try {
        return (await run("rustup component list --toolchain nightly")).includes(
            "rust-src (installed)",
        );
    } catch {
        return false;
    }
}

export async function hasCargoPvmContract(): Promise<boolean> {
    if (!(await commandExists("cargo"))) return false;
    try {
        await run("cargo pvm-contract build --help");
        return true;
    } catch {
        return false;
    }
}

export interface ToolStep {
    name: string;
    check: () => Promise<boolean>;
    install: (onData?: (line: string) => void) => Promise<void>;
    manualHint?: string;
}

const DEFAULT_CARGO_PVM_CONTRACT_REPO = "https://github.com/paritytech/cargo-pvm-contract.git";
const DEFAULT_CARGO_PVM_CONTRACT_REF = "main";

interface CargoPvmContractOptions {
    ref?: string;
}

interface ResolvedCargoPvmContractOptions {
    repo: string;
    ref: string;
}

interface CargoPvmContractStamp {
    repo: string;
    ref: string;
    revision: string;
    installedAt: string;
}

function cargoPvmContractStampPath(): string {
    return resolve(cdmHome(), "toolchain", "cargo-pvm-contract.json");
}

function quoteShell(value: string): string {
    return `'${value.replace(/'/g, "'\\''")}'`;
}

function readCargoPvmContractStamp(): CargoPvmContractStamp | null {
    const path = cargoPvmContractStampPath();
    if (!existsSync(path)) return null;
    try {
        return JSON.parse(readFileSync(path, "utf8")) as CargoPvmContractStamp;
    } catch {
        return null;
    }
}

async function resolveCargoPvmContractRevision(repo: string, ref: string): Promise<string> {
    if (/^[0-9a-f]{7,40}$/i.test(ref)) return ref;

    const patterns = [`refs/heads/${ref}`, `refs/tags/${ref}^{}`, `refs/tags/${ref}`, ref];
    const output = await run(
        `git ls-remote ${quoteShell(repo)} ${patterns.map(quoteShell).join(" ")}`,
    );
    const lines = output
        .trim()
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
    if (lines.length === 0) {
        throw new Error(`Could not resolve cargo-pvm-contract ref "${ref}" from ${repo}`);
    }

    const preferred =
        lines.find((line) => line.endsWith(`refs/heads/${ref}`)) ??
        lines.find((line) => line.endsWith(`refs/tags/${ref}^{}`)) ??
        lines[0];
    return preferred.split(/\s+/)[0];
}

async function hasCurrentCargoPvmContract(opts: ResolvedCargoPvmContractOptions): Promise<boolean> {
    if (!(await hasCargoPvmContract())) return false;

    const stamp = readCargoPvmContractStamp();
    if (!stamp || stamp.repo !== opts.repo || stamp.ref !== opts.ref) return false;

    const latestRevision = await resolveCargoPvmContractRevision(opts.repo, opts.ref);
    return stamp.revision.startsWith(latestRevision) || latestRevision.startsWith(stamp.revision);
}

function cargoPvmContractInstallScript(opts: ResolvedCargoPvmContractOptions): string {
    const repo = quoteShell(opts.repo);
    const ref = quoteShell(opts.ref);
    const stampPath = quoteShell(cargoPvmContractStampPath());
    const stampRepo = JSON.stringify(opts.repo);
    const stampRef = JSON.stringify(opts.ref);

    return `
set -euo pipefail
tmp_dir="$(mktemp -d)"
cleanup() {
    rm -rf "$tmp_dir"
}
trap cleanup EXIT
git init -q "$tmp_dir"
git -C "$tmp_dir" remote add origin ${repo}
git -C "$tmp_dir" fetch -q --depth 1 origin ${ref}
git -C "$tmp_dir" checkout -q FETCH_HEAD
revision="$(git -C "$tmp_dir" rev-parse HEAD)"
host_target="$(rustc -vV | awk '/^host:/ { print $2 }')"
cargo install --force --locked --target "$host_target" --path "$tmp_dir/crates/cargo-pvm-contract"
mkdir -p "$(dirname ${stampPath})"
cat > ${stampPath} <<JSON
{
  "repo": ${stampRepo},
  "ref": ${stampRef},
  "revision": "$revision",
  "installedAt": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
}
JSON
`.trim();
}

export function createToolSteps(opts: CargoPvmContractOptions = {}): ToolStep[] {
    const cargoPvmContract = {
        repo: DEFAULT_CARGO_PVM_CONTRACT_REPO,
        ref: opts.ref ?? process.env.CDM_CARGO_PVM_CONTRACT_REF ?? DEFAULT_CARGO_PVM_CONTRACT_REF,
    };

    return [
        {
            name: "git",
            check: () => commandExists("git"),
            install: async (onData) => {
                if (platform() === "darwin" && (await commandExists("brew"))) {
                    await runShell("brew install git", onData);
                } else if (platform() === "linux" && (await commandExists("apt"))) {
                    await runShell(`${sudo()}apt update && ${sudo()}apt install -y git`, onData);
                } else {
                    throw new Error("Cannot install git automatically on this platform.");
                }
            },
            manualHint: "Install git from https://git-scm.com/downloads",
        },
        {
            name: "curl",
            check: () => commandExists("curl"),
            install: async (onData) => {
                if (platform() === "darwin" && (await commandExists("brew"))) {
                    await runShell("brew install curl", onData);
                } else if (platform() === "linux" && (await commandExists("apt"))) {
                    await runShell(`${sudo()}apt update && ${sudo()}apt install -y curl`, onData);
                } else {
                    throw new Error("Cannot install curl automatically on this platform.");
                }
            },
            manualHint: "Install curl from https://curl.se/download.html",
        },
        {
            name: "C linker (cc)",
            check: () => commandExists("cc"),
            install: async (onData) => {
                if (platform() === "linux" && (await commandExists("apt"))) {
                    await runShell(
                        `${sudo()}apt update && ${sudo()}apt install -y build-essential`,
                        onData,
                    );
                } else {
                    throw new Error("Cannot install a C toolchain automatically on this platform.");
                }
            },
            manualHint:
                "Debian/Ubuntu: sudo apt install -y build-essential; macOS: xcode-select --install",
        },
        {
            name: "rustup",
            check: () => commandExists("rustup"),
            install: async (onData) => {
                await runShell(
                    'curl --proto "=https" --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y',
                    onData,
                    { description: "rustup installer" },
                );
                prependPath(resolve(process.env.CARGO_HOME ?? `${homedir()}/.cargo`, "bin"));
            },
            manualHint: "Install rustup from https://rustup.rs",
        },
        {
            name: "Rust nightly",
            check: hasRustNightly,
            install: (onData) => runShell("rustup toolchain install nightly", onData),
        },
        {
            name: "rust-src",
            check: hasRustSrc,
            install: (onData) =>
                runShell("rustup component add rust-src --toolchain nightly", onData),
        },
        {
            name: "cargo-pvm-contract",
            check: () => hasCurrentCargoPvmContract(cargoPvmContract),
            install: (onData) =>
                runShell(cargoPvmContractInstallScript(cargoPvmContract), onData, {
                    description: `cargo install cargo-pvm-contract from ${cargoPvmContract.ref}`,
                    failurePrefix: "cargo-pvm-contract build failed",
                }),
            manualHint: `Install cargo-pvm-contract from ${cargoPvmContract.repo} at ${cargoPvmContract.ref}`,
        },
    ];
}

export const TOOL_STEPS: ToolStep[] = createToolSteps();

export type ToolStepStatus = "checking" | "installing" | "ok" | "failed";

export interface ToolStepEvent {
    step: ToolStep;
    status: ToolStepStatus;
    message?: string;
}

export async function runToolchainSetup(
    opts: {
        steps?: readonly ToolStep[];
        install?: boolean;
        onEvent?: (event: ToolStepEvent) => void;
        onData?: (line: string) => void;
    } = {},
): Promise<void> {
    const steps = opts.steps ?? TOOL_STEPS;
    const install = opts.install ?? true;

    for (const step of steps) {
        opts.onEvent?.({ step, status: "checking" });
        if (await step.check()) {
            opts.onEvent?.({ step, status: "ok" });
            continue;
        }

        if (!install) {
            opts.onEvent?.({ step, status: "failed", message: "missing" });
            throw new Error(`Missing dependency: ${step.name}`);
        }

        opts.onEvent?.({ step, status: "installing" });
        try {
            await step.install(opts.onData);
            opts.onEvent?.({ step, status: "ok" });
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            opts.onEvent?.({ step, status: "failed", message });
            throw err;
        }
    }
}
