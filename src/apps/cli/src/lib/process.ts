import { spawn } from "node:child_process";
import type { Readable } from "node:stream";

/**
 * Run a bash command, capturing output. On non-zero exit the promise rejects
 * with an error carrying the last lines of output for diagnostics.
 */
export async function runShell(
    cmd: string,
    opts?: { description?: string; failurePrefix?: string },
): Promise<void> {
    const description = opts?.description ?? cmd;
    const failurePrefix = opts?.failurePrefix ?? "Command failed";

    await new Promise<void>((resolve, reject) => {
        const child = spawn("bash", ["-c", cmd], {
            stdio: ["ignore", "pipe", "pipe"],
            env: { ...process.env, FORCE_COLOR: process.env.FORCE_COLOR ?? "1" },
        }) as unknown as {
            stdout: Readable;
            stderr: Readable;
            on(event: "error", listener: (err: Error) => void): void;
            on(event: "close", listener: (code: number | null) => void): void;
        };

        const tail: string[] = [];
        const capture = (chunk: Buffer) => {
            for (const line of chunk.toString().split("\n")) {
                if (!line) continue;
                tail.push(line);
                if (tail.length > 40) tail.shift();
            }
        };

        child.stdout.on("data", capture);
        child.stderr.on("data", capture);
        child.on("error", (err) => {
            reject(new Error(`Failed to spawn "${description}": ${err.message}`, { cause: err }));
        });
        child.on("close", (code) => {
            if (code === 0) {
                resolve();
                return;
            }
            reject(
                new Error(
                    `${failurePrefix} (${description}) with exit code ${code}.\n${tail.join("\n") || "(no output)"}`,
                ),
            );
        });
    });
}
