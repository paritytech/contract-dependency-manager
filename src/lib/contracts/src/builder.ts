import { resolve } from "path";
import { execFileSync, spawn } from "child_process";
import { getRegistryAddress } from "@parity/cdm-env/registry";

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
 */
export function pvmContractBuild(
    rootDir: string,
    crateName: string,
    features?: string,
    registryAddress: string = getRegistryAddress(),
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
 */
export async function pvmContractBuildAsync(
    rootDir: string,
    crateName: string,
    onProgress?: BuildProgressCallback,
    features?: string,
    registryAddress: string = getRegistryAddress(),
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
