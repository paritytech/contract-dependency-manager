import { resolve } from "path";
import { execFileSync, spawn } from "child_process";

export interface BuildResult {
    crateName: string;
    success: boolean;
    stdout: string;
    stderr: string;
    durationMs: number;
}

export type BuildProgressCallback = (
    processed: number,
    total: number,
    currentCrate: string,
) => void;

/**
 * Build a single contract using `cargo pvm-contract build`.
 */
export function pvmContractBuild(rootDir: string, crateName: string, registryAddr?: string): void {
    const manifestPath = resolve(rootDir, "Cargo.toml");
    const args = ["pvm-contract", "build", "--manifest-path", manifestPath, "-p", crateName];
    const env: Record<string, string> = {
        ...(process.env as Record<string, string>),
    };
    if (registryAddr) {
        env.CONTRACTS_REGISTRY_ADDR = registryAddr;
    }
    execFileSync("cargo", args, { cwd: rootDir, stdio: "inherit", env });
}

/**
 * Build a single contract asynchronously with progress tracking.
 */
export async function pvmContractBuildAsync(
    rootDir: string,
    crateName: string,
    registryAddr?: string,
    onProgress?: BuildProgressCallback,
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
        const env: Record<string, string> = {
            ...(process.env as Record<string, string>),
        };
        if (registryAddr) {
            env.CONTRACTS_REGISTRY_ADDR = registryAddr;
        }

        const child = spawn("cargo", args, {
            cwd: rootDir,
            env,
            stdio: ["pipe", "pipe", "pipe"],
        });

        let stdout = "";
        let stderr = "";
        let compilerMessages = "";
        let artifactsSeen = 0;
        let total = 0;

        child.stdout.on("data", (data: Buffer) => {
            const text = data.toString();
            stdout += text;

            for (const line of text.split("\n")) {
                const trimmed = line.trim();
                if (!trimmed) continue;
                try {
                    const msg = JSON.parse(trimmed);
                    if (msg.reason === "build-plan") {
                        // Emitted by cargo-pvm-contract before build starts
                        total = msg.total ?? 0;
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
            }
        });

        child.stderr.on("data", (data: Buffer) => {
            const text = data.toString();
            stderr += text;
        });

        child.on("close", (code) => {
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
