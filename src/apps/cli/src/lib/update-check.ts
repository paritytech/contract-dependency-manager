import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { cdmHome, resolveLatestReleaseTag } from "./releases";

export const UPDATE_CHECK_COMMAND = "__update-check";

const CHECK_TTL_MS = 60 * 60 * 1000;

export interface UpdateCheckCache {
    latestTag: string;
    checkedAt: number;
}

export function updateCheckCachePath(): string {
    return resolve(cdmHome(), "update-check.json");
}

export function readUpdateCheckCache(path = updateCheckCachePath()): UpdateCheckCache | undefined {
    try {
        const parsed = JSON.parse(readFileSync(path, "utf8"));
        if (typeof parsed?.latestTag === "string" && typeof parsed?.checkedAt === "number") {
            return { latestTag: parsed.latestTag, checkedAt: parsed.checkedAt };
        }
    } catch {}
    return undefined;
}

export function writeUpdateCheckCache(
    cache: UpdateCheckCache,
    path = updateCheckCachePath(),
): void {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(cache));
}

function parseSemver(version: string): [number, number, number] | undefined {
    const match = version.trim().match(/^v?(\d+)\.(\d+)\.(\d+)$/);
    if (!match) return undefined;
    return [Number(match[1]), Number(match[2]), Number(match[3])];
}

export type VersionStatus = "current" | "behind" | "major-behind";

export function compareCdmVersions(current: string, latest: string): VersionStatus {
    const cur = parseSemver(current);
    const lat = parseSemver(latest);
    if (!cur || !lat) return "current";
    const behind =
        lat[0] !== cur[0] ? lat[0] > cur[0] : lat[1] !== cur[1] ? lat[1] > cur[1] : lat[2] > cur[2];
    if (!behind) return "current";
    return lat[0] > cur[0] ? "major-behind" : "behind";
}

export function formatUpdateWarning(
    current: string,
    latest: string,
    opts: { color?: boolean } = {},
): string | undefined {
    const status = compareCdmVersions(current, latest);
    if (status === "current") return undefined;

    const yellow = opts.color ? "\x1b[33m" : "";
    const redBold = opts.color ? "\x1b[1;31m" : "";
    const reset = opts.color ? "\x1b[0m" : "";
    const currentTag = current.startsWith("v") ? current : `v${current}`;
    const latestTag = latest.startsWith("v") ? latest : `v${latest}`;

    if (status === "major-behind") {
        return (
            `${redBold}✖ CDM ${latestTag} is available — you are a MAJOR version behind (current: ${currentTag}).${reset}\n` +
            `${redBold}  You may be working against a stale CDM registry. Run \`cdm update\`.${reset}`
        );
    }
    return `${yellow}⚠ CDM ${latestTag} is available (current: ${currentTag}). Run \`cdm update\`.${reset}`;
}

export function warnIfOutdated(currentVersion: string): void {
    if (process.env.CDM_NO_UPDATE_CHECK) return;
    const cache = readUpdateCheckCache();
    if (!cache) return;
    const warning = formatUpdateWarning(currentVersion, cache.latestTag, {
        color: process.stderr.isTTY ?? false,
    });
    if (warning) console.error(`${warning}\n`);
}

function selfInvocationArgs(): string[] {
    const script = process.argv[1];
    // Dev mode runs as `bun src/cli.ts`; in the compiled binary argv[1] is a
    // bunfs virtual path and execPath re-runs the CLI itself.
    if (script && (script.endsWith(".ts") || script.endsWith(".js"))) {
        return [script, UPDATE_CHECK_COMMAND];
    }
    return [UPDATE_CHECK_COMMAND];
}

export function scheduleUpdateCheck(): void {
    if (process.env.CDM_NO_UPDATE_CHECK) return;
    const cache = readUpdateCheckCache();
    if (cache && Date.now() - cache.checkedAt < CHECK_TTL_MS) return;
    try {
        spawn(process.execPath, selfInvocationArgs(), {
            detached: true,
            stdio: "ignore",
        }).unref();
    } catch {}
}

export async function runUpdateCheck(): Promise<void> {
    const latestTag = await resolveLatestReleaseTag();
    writeUpdateCheckCache({ latestTag, checkedAt: Date.now() });
}
