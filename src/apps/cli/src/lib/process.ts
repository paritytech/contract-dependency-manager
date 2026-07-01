import { spawn } from "node:child_process";
import type { Readable } from "node:stream";

export interface RunStreamedOptions {
    cmd: string;
    args: string[];
    description?: string;
    failurePrefix?: string;
    onData?: (line: string) => void;
}

export async function runStreamed(opts: RunStreamedOptions): Promise<void> {
    const description = opts.description ?? `${opts.cmd} ${opts.args.join(" ")}`;
    const failurePrefix = opts.failurePrefix ?? "Command failed";

    await new Promise<void>((resolve, reject) => {
        const child = spawn(opts.cmd, opts.args, {
            stdio: ["ignore", "pipe", "pipe"],
            env: { ...process.env, FORCE_COLOR: process.env.FORCE_COLOR ?? "1" },
        }) as unknown as {
            stdout: Readable;
            stderr: Readable;
            on(event: "error", listener: (err: Error) => void): void;
            on(event: "close", listener: (code: number | null) => void): void;
        };

        const tail: string[] = [];
        const maxTail = 40;

        const forward = (chunk: Buffer) => {
            for (const line of chunk.toString().split("\n")) {
                if (!line) continue;
                tail.push(line);
                if (tail.length > maxTail) tail.shift();
                opts.onData?.(line);
            }
        };

        child.stdout.on("data", forward);
        child.stderr.on("data", forward);
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

export async function runShell(
    cmd: string,
    onData?: (line: string) => void,
    opts?: { description?: string; failurePrefix?: string },
): Promise<void> {
    await runStreamed({
        cmd: "bash",
        args: ["-c", cmd],
        description: opts?.description ?? cmd,
        failurePrefix: opts?.failurePrefix,
        onData,
    });
}
