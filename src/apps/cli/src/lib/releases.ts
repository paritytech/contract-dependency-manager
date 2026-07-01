import { chmodSync, mkdirSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { arch, homedir, platform } from "node:os";
import { dirname, resolve } from "node:path";
import { runShell } from "./process";

export const DEFAULT_CDM_REPO = "paritytech/contract-dependency-manager";
export const CDM_BIN = "cdm";

export interface InstallCdmReleaseOptions {
    tag?: string;
    repo?: string;
    cdmDir?: string;
}

export interface InstallCdmReleaseResult {
    tag: string;
    asset: string;
    url: string;
    binPath: string;
    linkPath: string;
}

export function cdmHome(): string {
    return process.env.CDM_DIR ?? resolve(homedir(), ".cdm");
}

export function releaseAssetName(os = platform(), cpu = arch()): string {
    const normalizedOs = os === "darwin" ? "darwin" : "linux";
    const normalizedCpu = cpu === "arm64" ? "arm64" : "x64";
    return `${CDM_BIN}-${normalizedOs}-${normalizedCpu}`;
}

function assertSupportedPlatform(): void {
    const os = platform();
    const cpu = arch();
    if (os !== "darwin" && os !== "linux") {
        throw new Error(`Unsupported OS for CDM binary releases: ${os}`);
    }
    if (cpu !== "arm64" && cpu !== "x64") {
        throw new Error(`Unsupported architecture for CDM binary releases: ${cpu}`);
    }
}

export function normalizeReleaseTag(tag: string): string {
    if (tag.startsWith("v") || tag.includes("/")) return tag;
    return /^[0-9]/.test(tag) ? `v${tag}` : tag;
}

export function selectReleaseTag(...candidates: Array<string | undefined>): string | undefined {
    return candidates.map((tag) => tag?.trim()).find((tag): tag is string => Boolean(tag));
}

export async function resolveLatestReleaseTag(
    repo = process.env.CDM_REPO ?? DEFAULT_CDM_REPO,
): Promise<string> {
    const res = await fetch(`https://github.com/${repo}/releases/latest`, {
        method: "HEAD",
        redirect: "follow",
        headers: {
            "Cache-Control": "no-cache",
            Pragma: "no-cache",
        },
    });
    if (!res.ok) {
        throw new Error(`Could not resolve latest CDM release (${res.status} ${res.statusText})`);
    }

    const match = res.url.match(/\/releases\/tag\/([^/?#]+)$/);
    if (!match) {
        throw new Error(`Could not determine latest CDM release from ${res.url}`);
    }
    return decodeURIComponent(match[1]);
}

async function bestEffortMacosUnquarantine(path: string): Promise<void> {
    if (platform() !== "darwin") return;
    const quoted = `'${path.replace(/'/g, "'\\''")}'`;
    await runShell(`codesign --sign - --force ${quoted}`, undefined, {
        description: "codesign cdm",
    }).catch(() => {});
    await runShell(`xattr -c ${quoted}`, undefined, {
        description: "clear cdm quarantine attrs",
    }).catch(() => {});
}

export async function installCdmRelease(
    opts: InstallCdmReleaseOptions = {},
): Promise<InstallCdmReleaseResult> {
    assertSupportedPlatform();

    const repo = opts.repo ?? process.env.CDM_REPO ?? DEFAULT_CDM_REPO;
    const tag = normalizeReleaseTag(
        selectReleaseTag(opts.tag, process.env.CDM_TAG, process.env.VERSION) ??
            (await resolveLatestReleaseTag(repo)),
    );
    const asset = releaseAssetName();
    const url = `https://github.com/${repo}/releases/download/${tag}/${asset}`;
    const cdmDir = opts.cdmDir ?? cdmHome();
    const binPath = resolve(cdmDir, "bin", CDM_BIN);
    const linkPath = resolve(homedir(), ".local", "bin", CDM_BIN);
    const tmpPath = `${binPath}.tmp-${process.pid}`;

    const res = await fetch(url, { redirect: "follow" });
    if (!res.ok) {
        throw new Error(`Could not download ${url} (${res.status} ${res.statusText})`);
    }

    const bytes = Buffer.from(await res.arrayBuffer());
    mkdirSync(dirname(binPath), { recursive: true });
    writeFileSync(tmpPath, bytes);
    chmodSync(tmpPath, 0o755);
    renameSync(tmpPath, binPath);
    await bestEffortMacosUnquarantine(binPath);

    mkdirSync(dirname(linkPath), { recursive: true });
    rmSync(linkPath, { force: true });
    symlinkSync(binPath, linkPath);

    return { tag, asset, url, binPath, linkPath };
}
