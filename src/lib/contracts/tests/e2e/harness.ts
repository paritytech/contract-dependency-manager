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
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import type { HexString } from "polkadot-api";
import { submitAndWatch, type SubmittableTransaction } from "@parity/product-sdk-tx";
import { ALICE_SS58, GAS_LIMIT, STORAGE_DEPOSIT_LIMIT } from "@parity/cdm-utils";

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
const CONTRACT_PROXY_PVM = resolve(ROOT_DIR, "target/release/contract-proxy.polkavm");

/** The shared-counter template's counter blob — a real, callable implementation
 * contract for per-name proxy e2e (its own Cargo workspace, own target dir). */
export const COUNTER_PVM = resolve(
    ROOT_DIR,
    "src/templates/shared-counter/target/release/counter.polkavm",
);
export const COUNTER_ABI_JSON = resolve(
    ROOT_DIR,
    "src/templates/shared-counter/target/release/counter.abi.json",
);
/** The template counter's 0.1.0 initialization blob — built manifest-free
 * through the shim path (`buildRustInitialization`), so the e2e suite proves
 * the exact flow users get. */
export const TEMPLATE_DIR = resolve(ROOT_DIR, "src/templates/shared-counter");
export const COUNTER_INIT_PVM = resolve(
    TEMPLATE_DIR,
    "target/cdm/init-build/counter-init-0-1-0/target/release/counter-init-0-1-0.polkavm",
);

/** The initializations fixture crate (tests/e2e/fixtures/initializations):
 * one implementation + three initialization blobs over one shared storage. */
const INIT_FIXTURES_DIR = resolve(__dirname, "fixtures/initializations");
const INIT_FIXTURES_RELEASE = resolve(INIT_FIXTURES_DIR, "target/release");
export const FIXTURE_COUNTER_PVM = resolve(INIT_FIXTURES_RELEASE, "counter-fix.polkavm");
export const FIXTURE_INIT_SET_OWNER_PVM = resolve(
    INIT_FIXTURES_RELEASE,
    "counter-fix-init-set-owner.polkavm",
);
export const FIXTURE_INIT_TRANSFORM_PVM = resolve(
    INIT_FIXTURES_RELEASE,
    "counter-fix-init-transform.polkavm",
);
export const FIXTURE_INIT_REVERT_PVM = resolve(
    INIT_FIXTURES_RELEASE,
    "counter-fix-init-revert.polkavm",
);

/** Build the initializations fixture blobs if missing. */
export async function ensureInitFixturesBuilt(): Promise<void> {
    const blobs = [
        FIXTURE_COUNTER_PVM,
        FIXTURE_INIT_SET_OWNER_PVM,
        FIXTURE_INIT_TRANSFORM_PVM,
        FIXTURE_INIT_REVERT_PVM,
    ];
    if (blobs.every((blob) => existsSync(blob))) return;
    await execFileAsync(
        "cargo",
        ["pvm-contract", "build", "--manifest-path", resolve(INIT_FIXTURES_DIR, "Cargo.toml")],
        { cwd: ROOT_DIR, maxBuffer: 16 * 1024 * 1024 },
    );
    for (const blob of blobs) {
        if (!existsSync(blob)) {
            throw new Error(`Fixture blob not produced at ${blob}`);
        }
    }
}

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
    if (
        existsSync(REGISTRY_PVM) &&
        existsSync(REGISTRY_PROXY_PVM) &&
        existsSync(CONTRACT_PROXY_PVM)
    )
        return;
    await execFileAsync("pnpm", ["build:registry"], {
        cwd: ROOT_DIR,
        maxBuffer: 16 * 1024 * 1024,
    });
    for (const pvm of [REGISTRY_PVM, REGISTRY_PROXY_PVM, CONTRACT_PROXY_PVM]) {
        if (!existsSync(pvm)) {
            throw new Error(`Registry .polkavm not produced at ${pvm} after pnpm build:registry`);
        }
    }
}

/** Build the shared-counter template blobs if missing (`pnpm build:template`),
 * plus its 0.1.0 initialization through the manifest-free shim path. */
export async function ensureTemplateBuilt(): Promise<void> {
    if (!existsSync(COUNTER_PVM) || !existsSync(COUNTER_ABI_JSON)) {
        await execFileAsync("pnpm", ["build:template"], {
            cwd: ROOT_DIR,
            maxBuffer: 16 * 1024 * 1024,
        });
        if (!existsSync(COUNTER_PVM)) {
            throw new Error(`Counter .polkavm not produced at ${COUNTER_PVM}`);
        }
    }
    if (!existsSync(COUNTER_INIT_PVM)) {
        const { buildRustInitialization } = await import("@parity/cdm-builder");
        await buildRustInitialization(TEMPLATE_DIR, "counter", {
            version: "0.1.0",
            sourcePath: resolve(TEMPLATE_DIR, "contracts/counter/initializations/0.1.0.rs"),
        });
    }
}

/**
 * Deploy a blob with fixed, generous limits — deliberately NO dry-run: the
 * `ReviveApi.instantiate` dry-run diverges under Node (see the module note),
 * while plain transaction submission behaves. No salt → the pallet's default
 * (CREATE1-style) scheme, so repeated deploys of the same bytes get distinct
 * addresses without salt bookkeeping. The address comes from the
 * `Revive.Instantiated` event.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function deployBlob(api: any, signer: any, pvmPath: string): Promise<HexString> {
    const code = new Uint8Array(readFileSync(pvmPath));
    const tx = api.tx.Revive.instantiate_with_code({
        value: 0n,
        weight_limit: { ref_time: GAS_LIMIT.refTime, proof_size: GAS_LIMIT.proofSize },
        storage_deposit_limit: STORAGE_DEPOSIT_LIMIT,
        code,
        data: new Uint8Array(0),
        salt: undefined,
    });
    const result = await submitAndWatch(tx as unknown as SubmittableTransaction, signer, {
        waitFor: "best-block",
    });
    if (!result.ok) {
        throw new Error(`deployBlob(${pvmPath}) failed: ${JSON.stringify(result.error)}`);
    }
    const instantiated = api.event.Revive.Instantiated.filter(result.value.events);
    if (instantiated.length === 0) {
        throw new Error(`deployBlob(${pvmPath}): no Instantiated event`);
    }
    return instantiated[0].payload.contract as HexString;
}

/** Plain hex → bytes, matching product-sdk's own calldata handling. */
export function hexBytes(hex: string): Uint8Array {
    const stripped = hex.startsWith("0x") ? hex.slice(2) : hex;
    const out = new Uint8Array(stripped.length / 2);
    for (let i = 0; i < out.length; i++) {
        out[i] = Number.parseInt(stripped.slice(i * 2, i * 2 + 2), 16);
    }
    return out;
}

/** Dry-run a raw contract call (versioned/meta wire formats have no ABI).
 * Argument types mirror product-sdk's own `dryRunCall` exactly — a hex
 * string `dest` and `Uint8Array` calldata — which is the combination PPN's
 * runtime metadata encodes without an `Incompatible runtime entry` error. */
export async function dryRunCall(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    api: any,
    dest: string,
    input: string,
    origin: string = ALICE_SS58,
): Promise<{ success: boolean; reverted: boolean; data: string }> {
    const r = await api.apis.ReviveApi.call(
        origin,
        dest,
        0n,
        undefined,
        undefined,
        hexBytes(input),
        { at: "best" },
    );
    if (!r.result.success) {
        return { success: false, reverted: false, data: "0x" };
    }
    const flags = Number(r.result.value.flags);
    const raw = r.result.value.data;
    const data =
        typeof raw === "string"
            ? raw
            : raw instanceof Uint8Array
              ? `0x${Array.from(raw)
                    .map((b: number) => b.toString(16).padStart(2, "0"))
                    .join("")}`
              : raw.asHex();
    return { success: true, reverted: (flags & 1) === 1, data: String(data).toLowerCase() };
}

/** Submit a raw contract call as a transaction (fixed generous limits). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function rawCallTx(api: any, signer: any, dest: string, input: string): Promise<void> {
    const tx = api.tx.Revive.call({
        dest,
        value: 0n,
        weight_limit: { ref_time: GAS_LIMIT.refTime, proof_size: GAS_LIMIT.proofSize },
        storage_deposit_limit: STORAGE_DEPOSIT_LIMIT,
        data: hexBytes(input),
    });
    const result = await submitAndWatch(tx as unknown as SubmittableTransaction, signer, {
        waitFor: "best-block",
    });
    if (!result.ok) {
        throw new Error(`rawCallTx failed: ${JSON.stringify(result.error)}`);
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
