import { resolve } from "path";
import { existsSync, readFileSync } from "fs";
import type { PolkadotSigner, SS58String, HexString, TypedApi } from "polkadot-api";
import { Binary, Enum } from "polkadot-api";
import type { ChainClient } from "@polkadot-apps/chain-client";
import type { AssetHub, Bulletin } from "@dotdm/descriptors";
import { assetHub as assetHubDescriptor, bulletin as bulletinDescriptor } from "@dotdm/descriptors";

import {
    type ContractInfo,
    type DeploymentOrderLayered,
    detectDeploymentOrderLayered,
    getGitRemoteUrl,
    readCdmPackage,
    readReadmeContent,
} from "./detection";
import { pvmContractBuildAsync, type BuildProgressCallback } from "./builder";
import { computeCid } from "./cid";
import { ContractDeployer, computeDeploySalt, type AbiEntry, type Metadata } from "./deployer";
import { MetadataPublisher } from "./publisher";
import { RegistryManager, getRegistryContract } from "./registry";

/**
 * `deployContracts` expects a `ChainClient` that provides both `assetHub` and
 * `bulletin` keys. We deliberately use `unknown` for the value types here —
 * the descriptor types from `@dotdm/descriptors` and any caller's descriptors
 * are structurally compatible at runtime, and the pipeline only touches
 * documented surface area (tx, query, event, apis).
 */
export type PipelineChainClient = ChainClient<{
    assetHub: typeof assetHubDescriptor;
    bulletin: typeof bulletinDescriptor;
}>;

// ---------- shared types ----------

export interface BuildContractsOptions {
    rootDir: string;
    /** Crate-name filter; default: all detected */
    contracts?: string[];
    onEvent?: (e: BuildEvent) => void;
}

export type BuildEvent =
    | { type: "detect"; contracts: ContractInfo[]; layers: string[][] }
    | { type: "build-start"; crate: string }
    | { type: "build-progress"; crate: string; compiled: number; total: number }
    | { type: "build-done"; crate: string; durationMs: number; bytecodeSize: number }
    | { type: "build-error"; crate: string; error: string }
    | { type: "pipeline-done"; summary: BuildSummary }
    | { type: "pipeline-error"; error: string };

export interface BuildSummary {
    contracts: Array<{
        crate: string;
        pvmPath?: string;
        bytecodeSize?: number;
        durationMs?: number;
        error?: string;
    }>;
    totalDurationMs: number;
}

export interface DeployContractsOptions {
    rootDir: string;
    contracts?: string[];

    // Injected infra — REQUIRED, do not create connections internally
    client: PipelineChainClient;
    signer: PolkadotSigner;
    origin: SS58String;
    registryAddress: HexString;

    // Tuning (reserved for future use by internal tx layers)
    waitFor?: "best-block" | "finalized";
    timeoutMs?: number;
    gateway?: string;

    onEvent?: (e: DeployEvent) => void;
}

export type DeployEvent =
    | { type: "detect"; contracts: ContractInfo[]; layers: string[][] }
    | { type: "build-start"; crate: string }
    | { type: "build-progress"; crate: string; compiled: number; total: number }
    | { type: "build-done"; crate: string; durationMs: number; bytecodeSize: number }
    | { type: "build-error"; crate: string; error: string }
    | { type: "check-cached"; crate: string; address: HexString }
    | { type: "check-needs-deploy"; crate: string; address: HexString }
    | {
          type: "sign-request";
          phase: "deploy-register" | "publish";
          crates: string[];
      }
    | { type: "deploy-register-start"; crates: string[] }
    | {
          type: "deploy-register-done";
          addresses: Record<string, HexString>;
          txHash: string;
          blockHash: string;
          durationMs: number;
      }
    | { type: "deploy-register-error"; crates: string[]; error: string }
    | { type: "publish-start"; crates: string[] }
    | {
          type: "publish-done";
          cids: Record<string, string>;
          txHash: string;
          durationMs: number;
      }
    | { type: "publish-error"; crates: string[]; error: string }
    | {
          type: "tx-status";
          phase: "deploy-register" | "publish";
          crates: string[];
          status: "signing" | "broadcasting" | "in-block" | "finalized";
      }
    | { type: "pipeline-done"; summary: DeploySummary }
    | { type: "pipeline-error"; error: string };

export interface DeploySummary {
    contracts: Array<{
        crate: string;
        cdmPackage?: string;
        address?: HexString;
        cid?: string;
        status: "done" | "cached" | "error";
        error?: string;
    }>;
    totalDurationMs: number;
}

// ---------- internal helpers ----------

interface DetectedPipeline {
    order: DeploymentOrderLayered;
    layers: string[][];
}

/** Detect + optionally filter layers. Shared between build and deploy. */
function detectAndFilter(rootDir: string, filter: string[] | undefined): DetectedPipeline {
    const order = detectDeploymentOrderLayered(rootDir);
    let layers = order.layers;
    if (filter && filter.length > 0) {
        const filterSet = new Set(filter);
        layers = layers
            .map((layer) => layer.filter((crate) => filterSet.has(crate)))
            .filter((layer) => layer.length > 0);
    }
    return { order, layers };
}

interface BuildPhaseResult {
    /** Crates whose build succeeded (in layered order). */
    successful: string[];
    /** Crates whose build failed or were skipped due to dep failure. */
    failed: Set<string>;
    /** Per-crate build info (size + durationMs) for the summary. */
    info: Map<
        string,
        { durationMs: number; pvmPath?: string; bytecodeSize?: number; error?: string }
    >;
}

type BuildEmitter = (e: BuildEvent | DeployEvent) => void;

/**
 * Build all layers. On layer N, crates build concurrently. Dep failures cascade
 * (a crate whose dep failed is marked failed without attempting to build).
 *
 * Emits only the build-related events (`build-start`, `build-progress`,
 * `build-done`, `build-error`) — both BuildEvent and DeployEvent share those
 * variants, so this works for both pipelines.
 */
async function runBuildPhase(
    rootDir: string,
    order: DeploymentOrderLayered,
    layers: string[][],
    emit: BuildEmitter,
): Promise<BuildPhaseResult> {
    const failed = new Set<string>();
    const successful: string[] = [];
    const info = new Map<
        string,
        { durationMs: number; pvmPath?: string; bytecodeSize?: number; error?: string }
    >();

    for (const layer of layers) {
        const runnable: string[] = [];
        for (const crate of layer) {
            const contract = order.contractMap.get(crate);
            const hasFailedDep = contract?.dependsOnCrates.some((dep) => failed.has(dep));
            if (hasFailedDep) {
                failed.add(crate);
                info.set(crate, { durationMs: 0, error: "Skipped: dependency failed" });
                emit({ type: "build-error", crate, error: "Skipped: dependency failed" });
            } else {
                runnable.push(crate);
            }
        }

        const results = await Promise.all(
            runnable.map(async (crate) => {
                emit({ type: "build-start", crate });
                const onProgress: BuildProgressCallback = (compiled, total) => {
                    emit({ type: "build-progress", crate, compiled, total });
                };
                return pvmContractBuildAsync(rootDir, crate, onProgress);
            }),
        );

        for (const result of results) {
            if (result.success) {
                const pvmPath = resolve(rootDir, `target/${result.crateName}.release.polkavm`);
                let bytecodeSize: number | undefined;
                try {
                    bytecodeSize = readFileSync(pvmPath).length;
                } catch {
                    bytecodeSize = undefined;
                }
                successful.push(result.crateName);
                info.set(result.crateName, {
                    durationMs: result.durationMs,
                    pvmPath,
                    bytecodeSize,
                });
                emit({
                    type: "build-done",
                    crate: result.crateName,
                    durationMs: result.durationMs,
                    bytecodeSize: bytecodeSize ?? 0,
                });
            } else {
                failed.add(result.crateName);
                info.set(result.crateName, {
                    durationMs: result.durationMs,
                    error: result.stderr || "Build failed",
                });
                emit({
                    type: "build-error",
                    crate: result.crateName,
                    error: result.stderr || "Build failed",
                });
            }
        }

        // Refresh CDM package info from build artifacts (.cdm.json) for
        // freshly-built crates so later phases see accurate package names.
        for (const crate of runnable) {
            if (!failed.has(crate)) {
                const cdmPkg = readCdmPackage(rootDir, crate);
                if (cdmPkg) {
                    order.cdmPackageMap.set(crate, cdmPkg);
                }
            }
        }
    }

    return { successful, failed, info };
}

// ---------- public API ----------

/**
 * Build all (or a filtered subset of) PVM contracts in a workspace.
 * Emits detect + per-crate build events; does not touch the chain.
 */
export async function buildContracts(opts: BuildContractsOptions): Promise<BuildSummary> {
    const t0 = Date.now();
    const emit = (e: BuildEvent) => opts.onEvent?.(e);

    try {
        const { order, layers } = detectAndFilter(opts.rootDir, opts.contracts);
        const crates = layers.flat();
        const contracts: ContractInfo[] = crates
            .map((c) => order.contractMap.get(c))
            .filter((c): c is ContractInfo => !!c);
        emit({ type: "detect", contracts, layers });

        const build = await runBuildPhase(opts.rootDir, order, layers, emit as BuildEmitter);

        const summary: BuildSummary = {
            contracts: crates.map((crate) => {
                const i = build.info.get(crate);
                return {
                    crate,
                    pvmPath: i?.pvmPath,
                    bytecodeSize: i?.bytecodeSize,
                    durationMs: i?.durationMs,
                    error: build.failed.has(crate) ? (i?.error ?? "Build failed") : undefined,
                };
            }),
            totalDurationMs: Date.now() - t0,
        };
        emit({ type: "pipeline-done", summary });
        return summary;
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        emit({ type: "pipeline-error", error: msg });
        throw err;
    }
}

/**
 * Full pipeline: build contracts, then for each layer of dependencies
 *
 *  1. Cache-check — compare local bytecode to what's currently on-chain for
 *     each CDM-annotated crate, and skip if identical.
 *  2. Publish metadata to Bulletin (1 tx per CDM crate) AND
 *  3. Deploy + register on AssetHub in one `Utility.batch_all`
 *
 *  2 and 3 run in parallel per layer — CIDs are precomputed locally from the
 *  metadata bytes (`computeCid`) so the on-chain registration extrinsic
 *  doesn't need to wait for the Bulletin publish to finish. The pipeline
 *  verifies the published CIDs match the precomputed values after the fact.
 *
 * Never opens its own chain connections — the `ChainClient` + signer + origin
 * + registry address must be supplied by the caller.
 */
export async function deployContracts(opts: DeployContractsOptions): Promise<DeploySummary> {
    const t0 = Date.now();
    const emit = (e: DeployEvent) => opts.onEvent?.(e);

    // ---- 1. detect + build ----
    const detected = detectAndFilter(opts.rootDir, opts.contracts);
    const { order } = detected;
    const crates = detected.layers.flat();
    const contracts: ContractInfo[] = crates
        .map((c) => order.contractMap.get(c))
        .filter((c): c is ContractInfo => !!c);

    // Per-crate running status for the final summary.
    const status = new Map<
        string,
        {
            cdmPackage?: string;
            address?: HexString;
            cid?: string;
            status: "done" | "cached" | "error";
            error?: string;
        }
    >();
    for (const c of crates) status.set(c, { status: "error", error: "pending" });

    try {
        emit({ type: "detect", contracts, layers: detected.layers });

        const build = await runBuildPhase(
            opts.rootDir,
            order,
            detected.layers,
            emit as BuildEmitter,
        );

        for (const crate of build.failed) {
            const info = build.info.get(crate);
            status.set(crate, {
                status: "error",
                error: info?.error ?? "Build failed",
                cdmPackage: order.cdmPackageMap.get(crate),
            });
        }

        // ---- 2. wire service classes (implementation details) ----
        // `ContractDeployer`/`MetadataPublisher`/`RegistryManager` declare
        // their `signer` parameter as `ReturnType<typeof prepareSigner>`, which
        // is `PolkadotSigner` at runtime — the cast is shape-preserving.
        type Signer = ConstructorParameters<typeof ContractDeployer>[0];
        const signer = opts.signer as unknown as Signer;
        const assetHubApi = opts.client.assetHub as unknown as TypedApi<AssetHub>;
        const assetHubClient = opts.client.raw.assetHub;
        const bulletinApi = opts.client.bulletin as unknown as TypedApi<Bulletin>;

        const deployer = new ContractDeployer(signer, opts.origin, assetHubClient, assetHubApi);
        const publisher = new MetadataPublisher(signer, bulletinApi);
        const registry = new RegistryManager(
            signer,
            opts.origin,
            assetHubApi,
            assetHubClient,
            opts.registryAddress,
        );
        const registryContract = getRegistryContract(assetHubClient, opts.registryAddress);

        // ---- 3. per-layer deploy loop ----
        const failedCrates = new Set(build.failed);
        const addresses: Record<string, HexString> = {};

        for (const layer of detected.layers) {
            const layerDeployable = layer.filter((c) => !failedCrates.has(c));
            if (layerDeployable.length === 0) continue;

            try {
                // 3a. cache check
                const cdmCrates = layerDeployable.filter((c) => order.cdmPackageMap.has(c));
                const nonCdmCrates = layerDeployable.filter((c) => !order.cdmPackageMap.has(c));

                const toDeploy: string[] = [...nonCdmCrates];

                if (cdmCrates.length > 0) {
                    const pkgs = cdmCrates.map((c) => order.cdmPackageMap.get(c)!);
                    const registryAddrs = await registry.getAddressBatch(pkgs);

                    const checks = await Promise.all(
                        cdmCrates.map(async (crate) => {
                            const pkg = order.cdmPackageMap.get(crate)!;
                            const regAddr = registryAddrs.get(pkg);
                            if (!regAddr) return { crate, cached: false as const };

                            const pvmPath = resolve(
                                opts.rootDir,
                                `target/${crate}.release.polkavm`,
                            );
                            const localCode = readFileSync(pvmPath);
                            const onChainCode = await deployer.getOnChainCode(regAddr);

                            if (
                                onChainCode &&
                                localCode.length === onChainCode.length &&
                                Buffer.from(localCode).equals(Buffer.from(onChainCode))
                            ) {
                                return {
                                    crate,
                                    cached: true as const,
                                    address: regAddr as HexString,
                                };
                            }
                            return { crate, cached: false as const };
                        }),
                    );

                    for (const ch of checks) {
                        if (ch.cached) {
                            addresses[ch.crate] = ch.address;
                            status.set(ch.crate, {
                                status: "cached",
                                address: ch.address,
                                cdmPackage: order.cdmPackageMap.get(ch.crate),
                            });
                            emit({
                                type: "check-cached",
                                crate: ch.crate,
                                address: ch.address,
                            });
                        } else {
                            toDeploy.push(ch.crate);
                        }
                    }
                }

                if (toDeploy.length === 0) continue;

                // 3b. precompute metadata + CIDs for CDM crates, precompute addresses too
                const cdmToDeploy = toDeploy.filter((c) => order.cdmPackageMap.has(c));
                const nonCdmToDeploy = toDeploy.filter((c) => !order.cdmPackageMap.has(c));
                const cidMap: Record<string, string> = {};
                const metadataList: Metadata[] = [];

                if (cdmToDeploy.length > 0) {
                    const publishedAt = new Date().toISOString();
                    for (const crate of cdmToDeploy) {
                        const contract = order.contractMap.get(crate)!;
                        const readmeContent = readReadmeContent(contract.readmePath);
                        const repository =
                            contract.repository ?? getGitRemoteUrl(opts.rootDir) ?? "";
                        const abiPath = resolve(opts.rootDir, `target/${crate}.release.abi.json`);
                        let abi: AbiEntry[] = [];
                        if (existsSync(abiPath)) {
                            try {
                                abi = JSON.parse(readFileSync(abiPath, "utf-8"));
                            } catch {
                                // ignore — deploy succeeds with empty abi
                            }
                        }
                        const meta: Metadata = {
                            publish_block: 0,
                            published_at: publishedAt,
                            description: contract.description ?? "",
                            readme: readmeContent,
                            authors: contract.authors,
                            homepage: contract.homepage ?? "",
                            repository,
                            abi,
                        };
                        metadataList.push(meta);
                        cidMap[crate] = computeCid(new TextEncoder().encode(JSON.stringify(meta)));
                    }
                }

                // Precomputed addresses for emit "check-needs-deploy" — the
                // deploy-register batch computes this internally, but we
                // need it eagerly for the event before signing. Use a dry-run
                // to fetch CREATE2 addresses for CDM crates; non-CDM have no
                // salt so their precompute is skipped.
                for (const crate of cdmToDeploy) {
                    try {
                        const pvmPath = resolve(opts.rootDir, `target/${crate}.release.polkavm`);
                        const pkg = order.cdmPackageMap.get(crate)!;
                        const code = Binary.fromBytes(readFileSync(pvmPath));
                        const salt = computeDeploySalt(pkg);
                        const result = await assetHubApi.apis.ReviveApi.instantiate(
                            opts.origin,
                            0n,
                            undefined,
                            undefined,
                            Enum("Upload", code),
                            Binary.fromBytes(new Uint8Array(0)),
                            salt,
                        );
                        if (result.result.success) {
                            const addr = result.result.value.addr.asHex() as HexString;
                            emit({ type: "check-needs-deploy", crate, address: addr });
                        }
                    } catch {
                        // best-effort event — swallow
                    }
                }

                // 3c. parallel publish (Bulletin) + deploy+register (AssetHub)
                const pvmPaths = toDeploy.map((c) =>
                    resolve(opts.rootDir, `target/${c}.release.polkavm`),
                );

                // Sign requests fire immediately before submission.
                emit({
                    type: "sign-request",
                    phase: "deploy-register",
                    crates: toDeploy,
                });
                if (cdmToDeploy.length > 0) {
                    emit({ type: "sign-request", phase: "publish", crates: cdmToDeploy });
                }

                emit({ type: "deploy-register-start", crates: toDeploy });
                if (cdmToDeploy.length > 0) {
                    emit({ type: "publish-start", crates: cdmToDeploy });
                }

                const deployT0 = Date.now();
                const publishT0 = Date.now();

                // Non-CDM crates skip register. If ANY CDM crate in the layer
                // is deploying, batch them all via deployAndRegisterBatch and
                // pass "" metadataUri for the non-CDM ones — but the registry
                // call only happens for CDM crates, so split:
                // - pure deploy (utility.batch_all) for non-CDM
                // - deploy+register (utility.batch_all) for CDM
                // Run both + publish in parallel.
                const cdmPvmPaths = cdmToDeploy.map((c) =>
                    resolve(opts.rootDir, `target/${c}.release.polkavm`),
                );
                const cdmPkgs = cdmToDeploy.map((c) => order.cdmPackageMap.get(c)!);
                const cdmMetadataUris = cdmToDeploy.map((c) => cidMap[c]);
                const nonCdmPvmPaths = nonCdmToDeploy.map((c) =>
                    resolve(opts.rootDir, `target/${c}.release.polkavm`),
                );

                const [cdmDeployRes, nonCdmDeployRes, publishRes] = await Promise.all([
                    cdmToDeploy.length > 0
                        ? deployer.deployAndRegisterBatch(
                              cdmPvmPaths,
                              cdmPkgs,
                              registryContract,
                              cdmMetadataUris,
                          )
                        : Promise.resolve(null),
                    nonCdmToDeploy.length > 0
                        ? deployer.deployBatch(nonCdmPvmPaths)
                        : Promise.resolve(null),
                    cdmToDeploy.length > 0
                        ? publisher.publishBatch(metadataList).then((r) => {
                              // Verify CIDs match precomputation — any drift
                              // indicates a code bug or serialization mismatch.
                              for (let i = 0; i < metadataList.length; i++) {
                                  if (r.cids[i] !== cidMap[cdmToDeploy[i]]) {
                                      throw new Error(
                                          `CID mismatch for ${cdmToDeploy[i]}: expected ${cidMap[cdmToDeploy[i]]}, got ${r.cids[i]}`,
                                      );
                                  }
                              }
                              return r;
                          })
                        : Promise.resolve(null),
                ]);

                // Apply deploy-register results
                const deployAddrs: Record<string, HexString> = {};
                let deployTxHash = "";
                let deployBlockHash = "";
                if (cdmDeployRes) {
                    for (let i = 0; i < cdmToDeploy.length; i++) {
                        deployAddrs[cdmToDeploy[i]] = cdmDeployRes.addresses[i] as HexString;
                        addresses[cdmToDeploy[i]] = cdmDeployRes.addresses[i] as HexString;
                    }
                    deployTxHash = cdmDeployRes.txHash;
                    deployBlockHash = cdmDeployRes.blockHash;
                }
                if (nonCdmDeployRes) {
                    for (let i = 0; i < nonCdmToDeploy.length; i++) {
                        deployAddrs[nonCdmToDeploy[i]] = nonCdmDeployRes.addresses[i] as HexString;
                        addresses[nonCdmToDeploy[i]] = nonCdmDeployRes.addresses[i] as HexString;
                    }
                    // Prefer cdmDeployRes tx/block hash for the "combined" event;
                    // if there's only non-CDM, fall back to that.
                    if (!deployTxHash) {
                        deployTxHash = nonCdmDeployRes.txHash;
                        deployBlockHash = nonCdmDeployRes.blockHash;
                    }
                }

                emit({
                    type: "deploy-register-done",
                    addresses: deployAddrs,
                    txHash: deployTxHash,
                    blockHash: deployBlockHash,
                    durationMs: Date.now() - deployT0,
                });

                if (publishRes) {
                    const cidsOut: Record<string, string> = {};
                    for (let i = 0; i < cdmToDeploy.length; i++) {
                        cidsOut[cdmToDeploy[i]] = publishRes.cids[i];
                    }
                    emit({
                        type: "publish-done",
                        cids: cidsOut,
                        txHash: publishRes.txHash,
                        durationMs: Date.now() - publishT0,
                    });
                }

                // Mark status
                for (const crate of toDeploy) {
                    status.set(crate, {
                        status: "done",
                        address: addresses[crate],
                        cid: cidMap[crate],
                        cdmPackage: order.cdmPackageMap.get(crate),
                    });
                }
            } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                const affected = layerDeployable.filter((c) => status.get(c)?.status !== "cached");
                for (const crate of affected) {
                    failedCrates.add(crate);
                    status.set(crate, {
                        status: "error",
                        error: msg,
                        cdmPackage: order.cdmPackageMap.get(crate),
                    });
                }
                emit({
                    type: "deploy-register-error",
                    crates: affected,
                    error: msg,
                });
            }
        }

        const summary: DeploySummary = {
            contracts: crates.map((crate) => {
                const s = status.get(crate)!;
                return {
                    crate,
                    cdmPackage: s.cdmPackage,
                    address: s.address,
                    cid: s.cid,
                    status: s.status,
                    error: s.status === "error" ? s.error : undefined,
                };
            }),
            totalDurationMs: Date.now() - t0,
        };
        emit({ type: "pipeline-done", summary });
        return summary;
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        emit({ type: "pipeline-error", error: msg });
        throw err;
    }
}

// ---------- inline tests ----------

if (import.meta.vitest) {
    const { describe, test, expect, vi, beforeEach } = import.meta.vitest;

    vi.mock("./builder", () => ({
        pvmContractBuildAsync: vi.fn(
            async (_root: string, crateName: string) =>
                ({
                    crateName,
                    success: true,
                    stdout: "",
                    stderr: "",
                    durationMs: 100,
                }) as const,
        ),
    }));

    vi.mock("./detection", async () => {
        const actual = await vi.importActual<typeof import("./detection")>("./detection");
        return {
            ...actual,
            detectDeploymentOrderLayered: vi.fn(),
            readCdmPackage: vi.fn(() => null),
            getGitRemoteUrl: vi.fn(() => "https://github.com/test/repo"),
            readReadmeContent: vi.fn(() => ""),
        };
    });

    vi.mock("./cid", () => ({ computeCid: vi.fn(() => "fakeCid123") }));

    vi.mock("fs", () => ({
        existsSync: vi.fn(() => true),
        readFileSync: vi.fn(() => Buffer.from("[]")),
    }));

    const { pvmContractBuildAsync: mockBuild } = await import("./builder");
    const { readCdmPackage: mockReadCdm, detectDeploymentOrderLayered: mockDetect } = await import(
        "./detection"
    );

    type CI = ContractInfo;

    function makeOrder(
        layers: string[][],
        deps: Record<string, string[]> = {},
        cdm: Record<string, string> = {},
    ): DeploymentOrderLayered {
        const contractMap = new Map<string, CI>();
        for (const layer of layers) {
            for (const crate of layer) {
                contractMap.set(crate, {
                    name: crate,
                    cdmPackage: cdm[crate] ?? null,
                    description: null,
                    authors: [],
                    homepage: null,
                    repository: null,
                    readmePath: null,
                    path: `/fake/${crate}`,
                    dependsOnCrates: deps[crate] ?? [],
                });
            }
        }
        const cdmPackageMap = new Map(Object.entries(cdm));
        return { layers, contractMap, cdmPackageMap };
    }

    beforeEach(() => {
        vi.clearAllMocks();
        (mockBuild as any).mockImplementation(async (_root: string, crateName: string) => ({
            crateName,
            success: true,
            stdout: "",
            stderr: "",
            durationMs: 100,
        }));
        (mockReadCdm as any).mockReturnValue(null);
    });

    describe("buildContracts", () => {
        test("contracts in same layer build concurrently", async () => {
            (mockDetect as any).mockReturnValue(makeOrder([["a", "b"]]));
            const summary = await buildContracts({ rootDir: "/fake" });
            expect(mockBuild).toHaveBeenCalledTimes(2);
            expect(summary.contracts.map((c) => c.crate).sort()).toEqual(["a", "b"]);
            expect(summary.contracts.every((c) => !c.error)).toBe(true);
        });

        test("layer N+1 waits for layer N to complete", async () => {
            (mockDetect as any).mockReturnValue(makeOrder([["a"], ["b"]], { b: ["a"] }));
            const callOrder: string[] = [];
            (mockBuild as any).mockImplementation(async (_root: string, crateName: string) => {
                callOrder.push(`start:${crateName}`);
                await new Promise((r) => setTimeout(r, 5));
                callOrder.push(`end:${crateName}`);
                return { crateName, success: true, stdout: "", stderr: "", durationMs: 50 };
            });
            await buildContracts({ rootDir: "/fake" });
            expect(callOrder.indexOf("end:a")).toBeLessThan(callOrder.indexOf("start:b"));
        });

        test("error in one contract cascades to dependents", async () => {
            (mockDetect as any).mockReturnValue(makeOrder([["a"], ["b"]], { b: ["a"] }));
            (mockBuild as any).mockImplementation(async (_root: string, crateName: string) => {
                if (crateName === "a") {
                    return {
                        crateName,
                        success: false,
                        stdout: "",
                        stderr: "fail",
                        durationMs: 10,
                    };
                }
                return { crateName, success: true, stdout: "", stderr: "", durationMs: 10 };
            });
            const summary = await buildContracts({ rootDir: "/fake" });
            expect(summary.contracts.find((c) => c.crate === "a")!.error).toBeDefined();
            expect(summary.contracts.find((c) => c.crate === "b")!.error).toBe(
                "Skipped: dependency failed",
            );
        });

        test("emits detect + pipeline-done events", async () => {
            (mockDetect as any).mockReturnValue(makeOrder([["a"]]));
            const events: BuildEvent[] = [];
            await buildContracts({ rootDir: "/fake", onEvent: (e) => events.push(e) });
            expect(events[0].type).toBe("detect");
            expect(events.at(-1)!.type).toBe("pipeline-done");
        });

        test("empty pipeline succeeds immediately", async () => {
            (mockDetect as any).mockReturnValue({
                layers: [],
                contractMap: new Map(),
                cdmPackageMap: new Map(),
            });
            const summary = await buildContracts({ rootDir: "/fake" });
            expect(summary.contracts).toEqual([]);
        });

        test("contract filter narrows the build set", async () => {
            (mockDetect as any).mockReturnValue(makeOrder([["a", "b", "c"]]));
            const summary = await buildContracts({ rootDir: "/fake", contracts: ["b"] });
            expect(summary.contracts.map((c) => c.crate)).toEqual(["b"]);
        });
    });
}
