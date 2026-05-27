import { Command } from "commander";
import { spawn, spawnSync } from "node:child_process";
import { createConnection } from "node:net";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { createCdmAssetHubClient, getChainPreset } from "@dotdm/env";
import { resolveLocalRegistry, type SizedHex } from "@dotdm/contracts";

const PPN_DIR = resolve(homedir(), ".cdm/ppn");
const PPN_PROXY_INSTALL_URL =
    "https://raw.githubusercontent.com/paritytech/ppn-proxy/main/install.sh";
const LOCAL_ASSETHUB_PORT = 10020;
const LOCAL_BULLETIN_PORT = 10030;

const network = new Command("network").description(
    "Manage the local Polkadot ecosystem (Product Preview Network) used by `cdm test`",
);

network
    .command("start")
    .description("Start the local network. Installs PPN on first run if missing.")
    .option("--fresh", "Wipe ppn/data/ before starting", false)
    .option("--wait <seconds>", "Max seconds to wait for the network to be ready", "120")
    .option(
        "--ignore-ipv6",
        "Start even if macOS IPv6 is enabled (PPN's parachain will likely have 0 peers)",
        false,
    )
    .action(async (opts: { fresh: boolean; wait: string; ignoreIpv6: boolean }) => {
        refuseIfMacOsIpv6On(opts.ignoreIpv6);
        await ensurePpnInstalled();
        if (await isLocalNetworkUp()) {
            console.log("Network is already running.");
            return;
        }
        if (opts.fresh) {
            console.log("Wiping ppn/data/...");
            const r = spawnSync("make", ["clean-data"], { cwd: PPN_DIR, stdio: "inherit" });
            if (r.status !== 0) {
                console.error("Failed to wipe ppn/data/");
                process.exit(1);
            }
        }
        console.log(`Starting PPN from ${PPN_DIR}...`);
        const child = spawn("make", ["start"], {
            cwd: PPN_DIR,
            detached: true,
            stdio: "ignore",
        });
        child.unref();
        const maxMs = Number(opts.wait) * 1000;
        const ready = await waitForLocalNetwork(maxMs);
        if (!ready) {
            console.error(
                `Network did not come up within ${opts.wait}s. Inspect logs: cdm network logs`,
            );
            process.exit(1);
        }
        console.log("Network is up.");
    });

network
    .command("stop")
    .description("Stop the local network")
    .action(async () => {
        if (!existsSync(PPN_DIR)) {
            console.log("PPN is not installed.");
            return;
        }
        const r = spawnSync("make", ["kill"], { cwd: PPN_DIR, stdio: "inherit" });
        process.exit(r.status ?? 0);
    });

network
    .command("status")
    .description("Show whether the local network is running and what's on it")
    .action(async () => {
        const installed = existsSync(PPN_DIR);
        console.log(`PPN install:      ${installed ? PPN_DIR : "not installed"}`);
        const ahUp = await tcpProbe(LOCAL_ASSETHUB_PORT);
        const bulletinUp = await tcpProbe(LOCAL_BULLETIN_PORT);
        console.log(`Asset Hub :${LOCAL_ASSETHUB_PORT}: ${ahUp ? "up" : "down"}`);
        console.log(`Bulletin  :${LOCAL_BULLETIN_PORT}: ${bulletinUp ? "up" : "down"}`);
        if (!ahUp) {
            console.log("\nNot running. Start with: cdm network start");
            return;
        }
        const preset = getChainPreset("local");
        const registryAddress = resolveLocalRegistry();
        console.log(`\nQuerying ${preset.assethubUrl} (fetching metadata)...`);
        let client: Awaited<ReturnType<typeof createCdmAssetHubClient>> | undefined;
        try {
            client = await createCdmAssetHubClient(preset.assethubUrl, "local");
            const blockNumber = await withTimeout(
                client.assetHub.query.System.Number.getValue(),
                30_000,
                "Asset Hub query",
            );
            console.log(`Asset Hub head:   #${blockNumber}`);
            if (!registryAddress) {
                console.log(
                    "Registry:         not bootstrapped (cdm deploy --bootstrap -n local will bootstrap)",
                );
            } else {
                const info = await withTimeout(
                    client.assetHub.query.Revive.AccountInfoOf.getValue(
                        registryAddress as SizedHex<20>,
                    ),
                    10_000,
                    "Registry lookup",
                );
                const registryDeployed = info?.account_type.type === "Contract";
                console.log(
                    `Registry:         ${registryAddress} ${registryDeployed ? "deployed ✓" : "not on chain (cdm test will auto-bootstrap)"}`,
                );
            }
        } catch (err) {
            console.log(
                `Could not query Asset Hub: ${err instanceof Error ? err.message : String(err)}`,
            );
        } finally {
            client?.destroy();
        }
    });

network
    .command("logs")
    .description("Tail a PPN node log (default: asset-hub-collator1)")
    .option(
        "--node <name>",
        "Node to tail (asset-hub-collator1, bulletin-collator1, eth-rpc, alice-paseo-validator, ...)",
        "asset-hub-collator1",
    )
    .option("--list", "List available node logs and exit", false)
    .action((opts: { node: string; list: boolean }) => {
        if (!existsSync(PPN_DIR)) {
            console.error("PPN is not installed.");
            process.exit(1);
        }
        const dataDir = resolve(PPN_DIR, "data");
        if (opts.list) {
            const out = spawnSync("bash", ["-c", `ls ${dataDir}/*/*.log 2>/dev/null`], {
                stdio: "inherit",
            });
            process.exit(out.status ?? 0);
        }
        const logFile = resolve(dataDir, opts.node, `${opts.node}.log`);
        if (!existsSync(logFile)) {
            console.error(
                `Log not found: ${logFile}\nList available logs with: cdm network logs --list`,
            );
            process.exit(1);
        }
        const r = spawnSync("tail", ["-f", logFile], { stdio: "inherit" });
        process.exit(r.status ?? 0);
    });

/**
 * Lazy-install PPN into ~/.cdm/ppn/ via the ppn-proxy installer. Idempotent.
 * Requires `gh auth login` or GITHUB_TOKEN since PPN is a private repo.
 */
export async function ensurePpnInstalled(): Promise<void> {
    if (existsSync(PPN_DIR)) return;
    console.log("PPN not installed — fetching now (needs gh auth or GITHUB_TOKEN)...");
    const r = spawnSync("bash", ["-c", `curl -sL ${PPN_PROXY_INSTALL_URL} | bash`], {
        cwd: resolve(homedir(), ".cdm"),
        stdio: "inherit",
    });
    if (r.status !== 0 || !existsSync(PPN_DIR)) {
        console.error(
            "PPN install failed. Run `gh auth login` (or set GITHUB_TOKEN) and try again.",
        );
        process.exit(1);
    }
}

export async function isLocalNetworkUp(): Promise<boolean> {
    return tcpProbe(LOCAL_ASSETHUB_PORT);
}

export async function waitForLocalNetwork(maxMs: number): Promise<boolean> {
    const deadline = Date.now() + maxMs;
    while (Date.now() < deadline) {
        if (await tcpProbe(LOCAL_ASSETHUB_PORT)) return true;
        await new Promise((r) => setTimeout(r, 1000));
    }
    return false;
}

/**
 * macOS + IPv6 enabled = polkadot-sdk#8918: PPN's parachain collator can't
 * establish peers and the chain stalls silently. Refuse to start; print the
 * exact `sudo` command to disable. User can re-enable later with
 * `sudo networksetup -setv6automatic "<service>"`, or bypass this check
 * with `--ignore-ipv6` if they know what they're doing.
 */
function refuseIfMacOsIpv6On(ignore: boolean): void {
    if (process.platform !== "darwin") return;
    let service: string | undefined;
    let ipv6: string | undefined;
    try {
        const iface = spawnSync(
            "bash",
            ["-c", "route -n get default | awk '/interface:/{print $2}'"],
            { encoding: "utf8" },
        ).stdout.trim();
        if (!iface) return;
        service = spawnSync(
            "bash",
            [
                "-c",
                `networksetup -listallhardwareports | awk -v iface="${iface}" 'BEGIN{p=""} /Hardware Port:/{p=$0} $0 ~ "Device: "iface{sub(/Hardware Port: /,"",p); print p; exit}'`,
            ],
            { encoding: "utf8" },
        ).stdout.trim();
        if (!service) return;
        ipv6 = spawnSync(
            "bash",
            ["-c", `networksetup -getinfo "${service}" | awk -F': ' '/^IPv6:/{print $2}'`],
            { encoding: "utf8" },
        ).stdout.trim();
    } catch {
        return; // can't detect — don't block
    }
    if (!ipv6 || ipv6 === "Off") return;
    if (ignore) {
        console.warn(
            `⚠️  --ignore-ipv6: starting with IPv6 enabled on '${service}'. Parachain peers will likely fail.\n`,
        );
        return;
    }
    console.error(
        `\nmacOS IPv6 is enabled on '${service}'. PPN's parachain collator can't establish peers\n` +
            `with IPv6 on (polkadot-sdk#8918), and the chain will stall silently.\n` +
            `\n` +
            `Disable it:\n` +
            `  sudo networksetup -setv6off "${service}"\n` +
            `\n` +
            `Re-enable when you're done:\n` +
            `  sudo networksetup -setv6automatic "${service}"\n` +
            `\n` +
            `Or override (you'll likely get a stalled chain):\n` +
            `  cdm network start --ignore-ipv6\n`,
    );
    process.exit(1);
}

async function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    });
    try {
        return await Promise.race([p, timeout]);
    } finally {
        if (timer) clearTimeout(timer);
    }
}

function tcpProbe(port: number, host = "127.0.0.1", timeoutMs = 500): Promise<boolean> {
    return new Promise((res) => {
        const sock = createConnection({ port, host });
        const done = (ok: boolean) => {
            sock.destroy();
            res(ok);
        };
        sock.once("connect", () => done(true));
        sock.once("error", () => done(false));
        sock.setTimeout(timeoutMs, () => done(false));
    });
}

export const networkCommand = network;
