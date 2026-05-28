/**
 * Re-invoke the cdm binary that's running this process. Compiled mode →
 * `process.execPath` is the cdm binary, no extra base args. Dev mode (running
 * via `bun src/.../cli.ts`) → `process.execPath` is bun and `argv[1]` is the
 * entry script that bun needs to forward.
 *
 * Callers extend `baseArgs` with their own subcommand args before passing the
 * result to `spawn(cmd, baseArgs.concat(extra), ...)`.
 */
export function cdmInvocation(): { cmd: string; baseArgs: string[] } {
    const entry = process.argv[1];
    const isDev = entry?.endsWith(".ts") === true;
    return isDev
        ? { cmd: process.execPath, baseArgs: [entry!] }
        : { cmd: process.execPath, baseArgs: [] };
}
