// E2E test harness: connect to a local PPN (product-preview-net), deploy the
// registry, hand back endpoints.
//
// The suite runs against a full local Polkadot product environment — relay,
// Asset Hub (2s blocks), Bulletin, IPFS gateway — instead of a single dev
// node, so tests can cover the real cross-chain flow: registry state on
// Asset Hub, metadata on Bulletin, content served by the IPFS gateway.
//
// Requires a running PPN (one command, prebuilt binaries, ~seconds to boot):
//
//   git clone git@github.com:paritytech/preview-net-v1 && cd preview-net-v1
//   make start            # persistent local network
//   make start EPHEMERAL=1  # throwaway network (what CI uses)
//
// PPN serves Asset Hub on :10020, Bulletin on :10030, and the IPFS gateway
// on :8080 — matching @parity/cdm-env's `local` preset. Override with
// E2E_ASSETHUB_URL / E2E_BULLETIN_URL / E2E_IPFS_GATEWAY_URL.
//
// The registry deploy is idempotent (CREATE3 — the address is a pure
// function of the dev signer and the salts), so the suite works against
// both a fresh ephemeral network and a long-running local one; tests use
// per-run unique names and baseline-relative counts accordingly.

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import type { HexString } from "polkadot-api";

// Deploy via `bun run src/lib/scripts/deploy-registry.ts` rather than
// invoking `ContractDeployer` programmatically: the deploy dry-run behaves
// differently under Node than under Bun — Node reports
// `Module(Revive(StackUnderflow))` for the exact same code path that
// succeeds under Bun. Until the divergence is rooted out (likely papi's
// encoding of the upload payload), the script is the canonical deploy path.

const execFileAsync = promisify(execFile);

const __dirname = dirname(fileURLToPath(import.meta.url));
// src/lib/contracts/tests/e2e -> repo root is 5 levels up
const ROOT_DIR = resolve(__dirname, "../../../../..");
// Keep these aligned with the paths `deploy-registry.ts` reads from.
const REGISTRY_PVM = resolve(ROOT_DIR, "target/release/contract-registry.polkavm");
const REGISTRY_PROXY_PVM = resolve(ROOT_DIR, "target/release/contract-registry-proxy.polkavm");

export interface PpnHandle {
    /** Asset Hub WebSocket endpoint (registry lives here). */
    wsUrl: string;
    /** Bulletin chain WebSocket endpoint (metadata storage). */
    bulletinUrl: string;
    /** IPFS gateway base URL, `/ipfs`-suffixed (serves Bulletin content). */
    ipfsGatewayUrl: string;
}

async function pollRpcReady(url: string, timeoutMs = 60_000): Promise<void> {
    const httpUrl = url.replace(/^ws/, "http");
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        try {
            const res = await fetch(httpUrl, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    jsonrpc: "2.0",
                    id: 1,
                    method: "system_chain",
                    params: [],
                }),
                signal: AbortSignal.timeout(2000),
            });
            if (res.ok) {
                const json = (await res.json()) as { result?: string };
                if (typeof json.result === "string") return;
            }
        } catch {
            // not ready
        }
        await new Promise((r) => setTimeout(r, 500));
    }
    throw new Error(
        `No chain RPC answering at ${url}. Is PPN running?\n` +
            `  Start it with \`make start\` in a preview-net-v1 checkout ` +
            `(or \`make start EPHEMERAL=1\` for a throwaway network).`,
    );
}

/** Verify the local PPN endpoints are up and return them. */
export async function connectPpn(): Promise<PpnHandle> {
    const handle: PpnHandle = {
        wsUrl: process.env.E2E_ASSETHUB_URL ?? "ws://127.0.0.1:10020",
        bulletinUrl: process.env.E2E_BULLETIN_URL ?? "ws://127.0.0.1:10030",
        ipfsGatewayUrl: process.env.E2E_IPFS_GATEWAY_URL ?? "http://127.0.0.1:8080/ipfs",
    };
    await pollRpcReady(handle.wsUrl);
    await pollRpcReady(handle.bulletinUrl);
    return handle;
}

async function ensureRegistryBuilt(): Promise<void> {
    if (existsSync(REGISTRY_PVM) && existsSync(REGISTRY_PROXY_PVM)) return;
    await execFileAsync("pnpm", ["build:registry"], {
        cwd: ROOT_DIR,
        maxBuffer: 16 * 1024 * 1024,
    });
    for (const pvm of [REGISTRY_PVM, REGISTRY_PROXY_PVM]) {
        if (!existsSync(pvm)) {
            throw new Error(`Registry .polkavm not produced at ${pvm} after pnpm build:registry`);
        }
    }
}

export interface DeployedRegistry {
    /** The stable registry address — the EIP-1967 proxy, CREATE3-derived. */
    address: HexString;
    /** The implementation blob the proxy delegates to. */
    implAddress: HexString;
    /** The CREATE3 factory the proxy was deployed through. */
    factoryAddress: HexString;
}

/**
 * Build the registry blobs (if needed) and deploy them against `wsUrl` —
 * CREATE3 factory bootstrap first (frozen artifacts), then the
 * implementation blob (plain CREATE2), then the proxy THROUGH the factory.
 * Idempotent: on a network that already has the registry it verifies and
 * returns the existing addresses.
 *
 * Spawns `bun run src/lib/scripts/deploy-registry.ts`. See the import-site
 * note above for why we don't invoke `ContractDeployer` directly under Node.
 */
export async function deployRegistry(wsUrl: string): Promise<DeployedRegistry> {
    await ensureRegistryBuilt();
    const { stdout } = await execFileAsync(
        "bun",
        ["run", "src/lib/scripts/deploy-registry.ts", "--assethub-url", wsUrl],
        { cwd: ROOT_DIR, maxBuffer: 16 * 1024 * 1024 },
    );
    const match = stdout.match(/^CONTRACTS_REGISTRY_ADDR=(0x[a-fA-F0-9]+)/m);
    if (!match) {
        throw new Error(
            `Could not parse registry address from deploy-registry.ts output:\n${stdout}`,
        );
    }
    const implMatch = stdout.match(/^CONTRACTS_REGISTRY_IMPL_ADDR=(0x[a-fA-F0-9]+)/m);
    if (!implMatch) {
        throw new Error(
            `Could not parse registry implementation address from deploy-registry.ts output:\n${stdout}`,
        );
    }
    const factoryMatch = stdout.match(/^CREATE3_FACTORY_ADDR=(0x[a-fA-F0-9]+)/m);
    if (!factoryMatch) {
        throw new Error(
            `Could not parse CREATE3 factory address from deploy-registry.ts output:\n${stdout}`,
        );
    }
    return {
        address: match[1] as HexString,
        implAddress: implMatch[1] as HexString,
        factoryAddress: factoryMatch[1] as HexString,
    };
}
