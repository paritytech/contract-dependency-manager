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

/** Run a command, returning its stdout or null if it exits non-zero. */
async function tryRun(cmd: string): Promise<string | null> {
    try {
        return await run(cmd);
    } catch {
        return null;
    }
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
    return (await tryRun(`command -v ${cmd}`)) !== null;
}

/** Install a system package via Homebrew (macOS) or apt (Debian/Ubuntu). */
async function installSystemPackage(opts: {
    label: string;
    brew?: string;
    apt: string;
}): Promise<void> {
    if (opts.brew && platform() === "darwin" && (await commandExists("brew"))) {
        await runShell(`brew install ${opts.brew}`);
    } else if (platform() === "linux" && (await commandExists("apt"))) {
        await runShell(`${sudo()}apt update && ${sudo()}apt install -y ${opts.apt}`);
    } else {
        throw new Error(`Cannot install ${opts.label} automatically on this platform.`);
    }
}

async function hasRustNightly(): Promise<boolean> {
    return (await tryRun("rustup toolchain list"))?.includes("nightly") ?? false;
}

async function hasRustSrc(): Promise<boolean> {
    return (
        (await tryRun("rustup component list --toolchain nightly"))?.includes(
            "rust-src (installed)",
        ) ?? false
    );
}

export async function hasCargoPvmContract(): Promise<boolean> {
    if (!(await commandExists("cargo"))) return false;
    return (await tryRun("cargo pvm-contract build --help")) !== null;
}

export interface ToolStep {
    name: string;
    check: () => Promise<boolean>;
    install: () => Promise<void>;
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

    // If the remote is unreachable (offline, transient failure), trust the existing
    // install rather than aborting setup or forcing a needless reinstall.
    let latestRevision: string;
    try {
        latestRevision = await resolveCargoPvmContractRevision(opts.repo, opts.ref);
    } catch {
        return true;
    }
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
            install: () => installSystemPackage({ label: "git", brew: "git", apt: "git" }),
            manualHint: "Install git from https://git-scm.com/downloads",
        },
        {
            name: "curl",
            check: () => commandExists("curl"),
            install: () => installSystemPackage({ label: "curl", brew: "curl", apt: "curl" }),
            manualHint: "Install curl from https://curl.se/download.html",
        },
        {
            name: "C linker (cc)",
            check: () => commandExists("cc"),
            install: () => installSystemPackage({ label: "a C toolchain", apt: "build-essential" }),
            manualHint:
                "Debian/Ubuntu: sudo apt install -y build-essential; macOS: xcode-select --install",
        },
        {
            name: "rustup",
            check: () => commandExists("rustup"),
            install: async () => {
                await runShell(
                    'curl --proto "=https" --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y',
                    {
                        description: "rustup installer",
                    },
                );
                prependPath(resolve(process.env.CARGO_HOME ?? `${homedir()}/.cargo`, "bin"));
            },
            manualHint: "Install rustup from https://rustup.rs",
        },
        {
            name: "Rust nightly",
            check: hasRustNightly,
            install: () => runShell("rustup toolchain install nightly"),
        },
        {
            name: "rust-src",
            check: hasRustSrc,
            install: () => runShell("rustup component add rust-src --toolchain nightly"),
        },
        {
            name: "cargo-pvm-contract",
            check: () => hasCurrentCargoPvmContract(cargoPvmContract),
            install: () =>
                runShell(cargoPvmContractInstallScript(cargoPvmContract), {
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
            await step.install();
            opts.onEvent?.({ step, status: "ok" });
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            opts.onEvent?.({ step, status: "failed", message });
            throw err;
        }
    }
}
