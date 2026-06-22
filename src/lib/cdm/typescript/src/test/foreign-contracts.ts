import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { HexString, PolkadotSigner, SS58String } from "polkadot-api";
import { createContractFromClient } from "@parity/product-sdk-contracts";
import { ALICE_SS58 } from "@parity/cdm-utils";
import {
    CONTRACTS_REGISTRY_ABI,
    ContractDeployer,
    getCdmRoot,
    readCdmLocalJson,
    unwrapQueryOption,
} from "@parity/cdm-builder";
import {
    createCdmAssetHubClient,
    getChainPreset,
    getRegistryAddress,
    prepareSigner,
    ss58Address,
    type CdmDeployAssetHubApi,
} from "@parity/cdm-env";

const defaultCacheDir = () => resolve(getCdmRoot(), "cache/foreign");

export interface SetupForeignContractsOptions {
    /** Chain to pull bytecode from (name from getChainPreset or "custom"). */
    from: string;
    /** Required when `from` is a custom URL not in the preset list. */
    assethubUrl?: string;
    /** Packages to fetch in `@org/name:version` form. `:latest` allowed, warns. */
    packages: string[];
    /** Local chain to redeploy onto. Default "local". */
    to?: string;
    /**
     * Override the dest chain's registry address. Useful when the local
     * chain's bootstrapped registry doesn't match the canonical
     * `REGISTRY_ADDRESS` (e.g., bytecode drift between local toolchain and
     * the source the canonical constant is pinned to). When omitted,
     * resolution falls back to `cdm.local.json`'s `localRegistry` field
     * (written by `cdm deploy --bootstrap`), then to the chain preset.
     */
    destRegistryAddress?: string;
    /** Override the deploying signer. Default: Alice. */
    signer?: PolkadotSigner;
    /** Cache root. Default: `<CDM_ROOT>/cache/foreign/` (CDM_ROOT defaults to ~/.cdm). */
    cacheDir?: string;
}

export interface SetupForeignContractsResult {
    /** {pkg → local H160} after deploy. */
    addresses: Record<string, string>;
}

export interface ParsedPackageSpec {
    name: string;
    version: number | "latest";
}

/**
 * Parse `@org/name:N` or `@org/name:latest` (no colon implies latest).
 * Exported for testing — internal callers use it directly.
 */
export function parsePackageSpec(spec: string): ParsedPackageSpec {
    const idx = spec.lastIndexOf(":");
    // `idx <= 0` covers "no colon" and the special case of an `@` prefix where
    // `lastIndexOf(":")` could be 0 if someone passed `:3` alone (degenerate).
    if (idx <= 0) return { name: spec, version: "latest" };
    const name = spec.slice(0, idx);
    const vStr = spec.slice(idx + 1);
    if (vStr === "latest") return { name, version: "latest" };
    const v = Number.parseInt(vStr, 10);
    if (Number.isNaN(v) || v < 0 || String(v) !== vStr) {
        // Not a clean number → treat the whole thing as a name with implicit latest
        return { name: spec, version: "latest" };
    }
    return { name, version: v };
}

/**
 * Path under the cache root for a resolved (pkg, version, source-chain) tuple.
 * Exported so callers can pre-warm or inspect the cache; not part of the
 * stable API.
 */
export function cachePathFor(
    pkgName: string,
    resolvedVersion: number,
    sourceChain: string,
    cacheDir: string = defaultCacheDir(),
): string {
    // @polkadot/contexts → polkadot/contexts (strip leading @)
    const slug = pkgName.replace(/^@/, "").replace(/[^a-zA-Z0-9/_-]/g, "_");
    return resolve(cacheDir, slug, `v${resolvedVersion}@${sourceChain}.polkavm`);
}

function sha256Hex(bytes: Uint8Array): string {
    return createHash("sha256").update(bytes).digest("hex");
}

/**
 * Fetch bytecode for foreign packages from a live chain, cache it, and
 * redeploy onto a local chain. Idempotent across re-runs — if the local
 * chain already has the package at the same bytecode hash, the deploy is
 * skipped.
 *
 * Designed for use as a vitest `globalSetup`:
 * ```
 * export default () => setupForeignContracts({
 *     from: "paseo",
 *     packages: ["@polkadot/contexts:3"],
 * });
 * ```
 *
 * Caveat: the local registry assigns its own version index (usually 1)
 * irrespective of the source-chain version. Tests should look up
 * via `get_address(pkg)` / `cdm::import!` (latest), not by numeric version.
 */
export async function setupForeignContracts(
    opts: SetupForeignContractsOptions,
): Promise<SetupForeignContractsResult> {
    const cacheDir = opts.cacheDir ?? defaultCacheDir();
    const destChain = opts.to ?? "local";

    // === Phase A: pull bytecode from source ===
    const sourceAssethubUrl = opts.assethubUrl ?? getChainPreset(opts.from).assethubUrl;
    const sourceRegistryAddress = getRegistryAddress(opts.from);

    console.log(`[setupForeignContracts] source: ${opts.from} (${sourceAssethubUrl})`);
    const sourceClient = await createCdmAssetHubClient(sourceAssethubUrl, opts.from);
    await sourceClient.raw.assetHub.getChainSpecData();

    const sourceRegistry = createContractFromClient(
        sourceClient.raw.assetHub,
        sourceClient.descriptors.assetHub,
        sourceRegistryAddress as HexString,
        CONTRACTS_REGISTRY_ABI,
        { defaultOrigin: ALICE_SS58 as SS58String },
    );
    const sourceDeployer = new ContractDeployer(
        prepareSigner("Alice"),
        ALICE_SS58 as SS58String,
        sourceClient.raw.assetHub,
        // CdmAssetHubApi is a superset of CdmDeployAssetHubApi (adds polkadot
        // descriptor variant). The runtime calls we use are identical across
        // both, so the cast is safe.
        sourceClient.assetHub as unknown as CdmDeployAssetHubApi,
    );

    // Phase A is read-only against the source chain, so fetch packages in
    // parallel. Phase B (deploy) stays serial below since each tx advances the
    // signer's nonce and the registry assigns versions monotonically.
    let fetched: Array<{ pkg: ParsedPackageSpec; resolvedVersion: number; cachePath: string }>;
    try {
        fetched = await Promise.all(
            opts.packages.map(async (spec) => {
                const pkg = parsePackageSpec(spec);
                if (pkg.version === "latest") {
                    console.warn(
                        `[setupForeignContracts] ${pkg.name}:latest — non-deterministic, prefer :N for CI`,
                    );
                }

                const resolvedVersion = await resolveVersion(sourceRegistry, pkg, opts.from);
                const cachePath = cachePathFor(pkg.name, resolvedVersion, opts.from, cacheDir);

                if (existsSync(cachePath)) {
                    console.log(
                        `[setupForeignContracts] ${pkg.name}:v${resolvedVersion} → cache hit`,
                    );
                    return { pkg, resolvedVersion, cachePath };
                }

                const sourceAddrResult = await sourceRegistry.getAddressAtVersion.query(
                    pkg.name,
                    resolvedVersion,
                );
                const sourceAddr = unwrapQueryOption<string>(sourceAddrResult);
                if (!sourceAddr) {
                    throw new Error(
                        `No deployment of ${pkg.name}:v${resolvedVersion} on ${opts.from}`,
                    );
                }
                const bytecode = await sourceDeployer.getOnChainCode(sourceAddr);
                if (!bytecode) {
                    throw new Error(
                        `Could not fetch bytecode for ${pkg.name}:v${resolvedVersion} at ${sourceAddr} on ${opts.from}`,
                    );
                }
                mkdirSync(dirname(cachePath), { recursive: true });
                writeFileSync(cachePath, bytecode);
                console.log(
                    `[setupForeignContracts] ${pkg.name}:v${resolvedVersion} from ${opts.from} → cached (${bytecode.length} bytes)`,
                );
                return { pkg, resolvedVersion, cachePath };
            }),
        );
    } finally {
        sourceClient.destroy();
    }

    // === Phase B: deploy on dest ===
    const destAssethubUrl = getChainPreset(destChain).assethubUrl;
    const destRegistryAddress = resolveDestRegistry(opts, destChain);

    console.log(`[setupForeignContracts] dest: ${destChain} (${destAssethubUrl})`);
    const destClient = await createCdmAssetHubClient(destAssethubUrl, destChain);
    await destClient.raw.assetHub.getChainSpecData();

    const signer = opts.signer ?? prepareSigner("Alice");
    const origin = ss58Address(signer.publicKey);

    const addresses: Record<string, string> = {};

    try {
        // Map account on Revive — idempotent, errors if already mapped (ignored).
        try {
            await destClient.assetHub.tx.Revive.map_account().signAndSubmit(signer);
        } catch {
            // Account already mapped — fine.
        }

        const destRegistry = createContractFromClient(
            destClient.raw.assetHub,
            destClient.descriptors.assetHub,
            destRegistryAddress as HexString,
            CONTRACTS_REGISTRY_ABI,
            { defaultOrigin: origin, defaultSigner: signer },
        );
        const destDeployer = new ContractDeployer(
            signer,
            origin,
            destClient.raw.assetHub,
            destClient.assetHub as unknown as CdmDeployAssetHubApi,
        );

        // Preflight: without a contract at destRegistryAddress, publishLatest.tx
        // silently returns ok=true, masking the missing registry. Probe the
        // on-chain code so we fail loud here instead.
        const registryCode = await destDeployer.getOnChainCode(destRegistryAddress);
        if (!registryCode || registryCode.length === 0) {
            throw new Error(
                `No ContractRegistry found at ${destRegistryAddress} on '${destChain}'. ` +
                    `Run \`cdm deploy --bootstrap -n ${destChain}\` ` +
                    `(or \`make deploy-registry CHAIN=${destChain}\`) first.`,
            );
        }

        for (const { pkg, cachePath } of fetched) {
            const cachedBytes = readFileSync(cachePath);
            const cachedHash = sha256Hex(cachedBytes);

            // Idempotency check: package already deployed locally with same bytecode?
            const existing = await destRegistry.getAddress.query(pkg.name);
            const localAddr = unwrapQueryOption<string>(existing);
            if (localAddr) {
                const localBytes = await destDeployer.getOnChainCode(localAddr);
                if (localBytes && sha256Hex(localBytes) === cachedHash) {
                    console.log(
                        `[setupForeignContracts] ${pkg.name} already at ${localAddr} (matched bytecode hash), skip`,
                    );
                    addresses[pkg.name] = localAddr;
                    continue;
                }
            }

            // Deploy + register fresh
            const { address } = await destDeployer.deploy(cachePath, pkg.name);
            const publish = await destRegistry.publishLatest.tx(pkg.name, address, "");
            if (!publish.ok) {
                throw new Error(
                    `publishLatest failed for ${pkg.name} at ${address}: ${JSON.stringify(publish)}`,
                );
            }
            console.log(`[setupForeignContracts] ${pkg.name} → ${address}`);
            addresses[pkg.name] = address;
        }
    } finally {
        destClient.destroy();
    }

    return { addresses };
}

/**
 * Resolve the dest registry address with a three-tier fallback:
 *   1. Explicit `opts.destRegistryAddress`.
 *   2. `localRegistry` from cdm.local.json (written by `cdm deploy --bootstrap`).
 *   3. Canonical address from the chain preset (non-local only — local has no
 *      canonical address, so this is a hard error pointing at the bootstrap).
 */
function resolveDestRegistry(opts: SetupForeignContractsOptions, destChain: string): string {
    if (opts.destRegistryAddress) return opts.destRegistryAddress;
    const local = readCdmLocalJson();
    if (local?.cdmLocalJson.localRegistry) return local.cdmLocalJson.localRegistry;
    if (destChain === "local") {
        throw new Error(
            `No local registry available. Run \`cdm deploy --bootstrap -n local\` first ` +
                "to write cdm.local.json, or pass destRegistryAddress explicitly.",
        );
    }
    return getRegistryAddress(destChain);
}

async function resolveVersion(
    registry: Awaited<ReturnType<typeof createContractFromClient>>,
    pkg: ParsedPackageSpec,
    sourceChain: string,
): Promise<number> {
    if (pkg.version !== "latest") return pkg.version;
    const countResult = await registry.getVersionCount.query(pkg.name);
    if (!countResult.success) {
        throw new Error(
            `Could not query version count for ${pkg.name} on ${sourceChain}: ${JSON.stringify(countResult)}`,
        );
    }
    const count = countResult.value as number;
    if (count === 0) {
        throw new Error(`Package ${pkg.name} has no published versions on ${sourceChain}`);
    }
    return count - 1;
}
