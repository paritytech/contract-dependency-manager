import { resolve } from "path";
import { existsSync, readFileSync } from "fs";
import {
    detectDeploymentOrderLayered,
    getGitRemoteUrl,
    readCdmPackage,
    readReadmeContent,
} from "./detection.js";
import type { DeploymentOrderLayered } from "./detection.js";
import {
    pvmContractBuildAsync,
    type BuildProgressCallback,
} from "./builder.js";
import {
    type ContractDeployer,
    type Metadata,
    type AbiEntry,
} from "./deployer.js";
import type { MetadataPublisher } from "./publisher.js";
import type { RegistryManager } from "./registry.js";
import { computeCid } from "./cid.js";

export type ContractState =
    | "waiting"
    | "building"
    | "built"
    | "deploying"
    | "registering"
    | "done"
    | "error";

export interface ContractStatus {
    crateName: string;
    state: ContractState;
    error?: string;
    address?: string;
    cid?: string;
    deployTxHash?: string;
    deployBlockHash?: string;
    publishTxHash?: string;
    publishBlockHash?: string;
    registerTxHash?: string;
    registerBlockHash?: string;
    durationMs?: number;
    buildProgress?: { compiled: number; total: number; currentCrate: string };
    deployInProgress?: boolean;
    publishInProgress?: boolean;
    registerInProgress?: boolean;
}

export interface DeployServices {
    deployer: ContractDeployer;
    publisher: MetadataPublisher;
    registry: RegistryManager;
}

export interface PipelineOptions {
    rootDir: string;
    registryAddr?: string;
    services?: DeployServices; // undefined = build-only mode
    contractFilter?: string[]; // optional filter to only process specific contracts
    onStatusChange?: (crateName: string, status: ContractStatus) => void;
    onCdmPackageDetected?: (crateName: string, cdmPackage: string) => void;
    order?: DeploymentOrderLayered; // if provided, skip re-detecting
}

export interface PipelineResult {
    addresses: Record<string, string>;
    statuses: Map<string, ContractStatus>;
    success: boolean;
}

function updateStatus(
    statuses: Map<string, ContractStatus>,
    crateName: string,
    state: ContractState,
    onStatusChange?: PipelineOptions["onStatusChange"],
    extra?: Partial<ContractStatus>,
): void {
    const current = statuses.get(crateName)!;
    const updated = { ...current, state, ...extra };
    statuses.set(crateName, updated);
    onStatusChange?.(crateName, updated);
}

export async function executePipeline(
    opts: PipelineOptions,
): Promise<PipelineResult> {
    const order = opts.order ?? detectDeploymentOrderLayered(opts.rootDir);

    // Apply contract filter if set
    let layers = order.layers;
    if (opts.contractFilter && opts.contractFilter.length > 0) {
        const filterSet = new Set(opts.contractFilter);
        layers = layers
            .map((layer) => layer.filter((crate) => filterSet.has(crate)))
            .filter((layer) => layer.length > 0);
    }

    // Initialize statuses — all contracts start as "waiting"
    const statuses = new Map<string, ContractStatus>();
    for (const layer of layers) {
        for (const crate of layer) {
            statuses.set(crate, { crateName: crate, state: "waiting" });
        }
    }

    const addresses: Record<string, string> = {};
    const failedCrates = new Set<string>();

    for (const layer of layers) {
        // 1. Skip contracts with failed dependencies
        const runnable: string[] = [];
        for (const crate of layer) {
            const contract = order.contractMap.get(crate);
            const hasFailed = contract?.dependsOnCrates.some((dep) => failedCrates.has(dep));
            if (hasFailed) {
                failedCrates.add(crate);
                updateStatus(statuses, crate, "error", opts.onStatusChange, {
                    error: "Skipped: dependency failed",
                });
            } else {
                runnable.push(crate);
            }
        }

        // 2. BUILD PHASE - parallel within layer
        const buildResults = await Promise.all(
            runnable.map((crate) => {
                updateStatus(statuses, crate, "building", opts.onStatusChange);
                const onProgress: BuildProgressCallback = (processed, total, currentCrate) => {
                    updateStatus(statuses, crate, "building", opts.onStatusChange, {
                        buildProgress: { compiled: processed, total, currentCrate },
                    });
                };
                return pvmContractBuildAsync(opts.rootDir, crate, opts.registryAddr, onProgress);
            }),
        );

        for (const result of buildResults) {
            if (result.success) {
                updateStatus(statuses, result.crateName, "built", opts.onStatusChange, {
                    durationMs: result.durationMs,
                });
            } else {
                failedCrates.add(result.crateName);
                updateStatus(statuses, result.crateName, "error", opts.onStatusChange, {
                    error: result.stderr || "Build failed",
                    durationMs: result.durationMs,
                });
            }
        }

        // 2b. Refresh CDM package info from build artifacts (.cdm.json generated during build)
        for (const crate of runnable) {
            if (!failedCrates.has(crate) && !order.cdmPackageMap.has(crate)) {
                const cdmPkg = readCdmPackage(opts.rootDir, crate);
                if (cdmPkg) {
                    order.cdmPackageMap.set(crate, cdmPkg);
                    opts.onCdmPackageDetected?.(crate, cdmPkg);
                }
            }
        }

        // 3. Filter to successful builds
        const deployable = runnable.filter((crate) => !failedCrates.has(crate));

        // 4. DEPLOY + PUBLISH PHASE (parallel: deploy on AssetHub, publish on Bulletin)
        if (opts.services && deployable.length > 0) {
            try {
                const cdmCrates = deployable.filter((c) => order.cdmPackageMap.has(c));
                const cdmSet = new Set(cdmCrates);
                const cidMap: Record<string, string> = {};
                const addrMap: Record<string, string> = {};

                // Prepare metadata and precompute CIDs for CDM crates
                let metadataList: Metadata[] = [];
                let precomputedCids: string[] = [];
                if (cdmCrates.length > 0) {
                    const publishedAt = new Date().toISOString();
                    metadataList = cdmCrates.map((c) => {
                        const contract = order.contractMap.get(c)!;
                        const readmeContent = readReadmeContent(contract.readmePath);
                        const repository = contract.repository ?? getGitRemoteUrl(opts.rootDir) ?? "";
                        const abiPath = resolve(opts.rootDir, `target/${c}.release.abi.json`);
                        let abi: AbiEntry[] = [];
                        if (existsSync(abiPath)) {
                            try { abi = JSON.parse(readFileSync(abiPath, "utf-8")); } catch {}
                        }
                        return {
                            publish_block: 0, published_at: publishedAt,
                            description: contract.description ?? "",
                            readme: readmeContent, authors: contract.authors,
                            homepage: contract.homepage ?? "", repository, abi,
                        };
                    });
                    precomputedCids = metadataList.map((m) =>
                        computeCid(new TextEncoder().encode(JSON.stringify(m))),
                    );
                    for (let i = 0; i < cdmCrates.length; i++) {
                        cidMap[cdmCrates[i]] = precomputedCids[i];
                    }
                }

                // Mark deploying (+ publishing for CDM crates)
                for (const crate of deployable) {
                    updateStatus(statuses, crate, "deploying", opts.onStatusChange, {
                        deployInProgress: true,
                        ...(cdmSet.has(crate) ? { publishInProgress: true, cid: cidMap[crate] } : {}),
                    });
                }

                // Deploy (AssetHub) + Publish (Bulletin) in parallel
                const pvmPaths = deployable.map((c) =>
                    resolve(opts.rootDir, `target/${c}.release.polkavm`),
                );
                const [deployResult, publishResult] = await Promise.all([
                    opts.services.deployer.deployBatch(pvmPaths),
                    cdmCrates.length > 0
                        ? opts.services.publisher.publishBatch(metadataList)
                        : Promise.resolve(null),
                ]);

                // Process deploy results
                const { addresses: batchAddrs, txHash: deployTxHash, blockHash: deployBlockHash } = deployResult;
                for (let i = 0; i < deployable.length; i++) {
                    addrMap[deployable[i]] = batchAddrs[i];
                    addresses[deployable[i]] = batchAddrs[i];
                }

                // Verify published CIDs
                let publishTxHash = "";
                let publishBlockHash = "";
                if (publishResult) {
                    for (let i = 0; i < precomputedCids.length; i++) {
                        if (publishResult.cids[i] !== precomputedCids[i]) {
                            throw new Error(
                                `CID mismatch for ${cdmCrates[i]}: expected ${precomputedCids[i]}, got ${publishResult.cids[i]}`,
                            );
                        }
                    }
                    publishTxHash = publishResult.txHash;
                    publishBlockHash = publishResult.blockHash;
                }

                // Transition: CDM crates → registering, non-CDM → done
                for (const crate of deployable) {
                    if (cdmSet.has(crate)) {
                        updateStatus(statuses, crate, "registering", opts.onStatusChange, {
                            deployInProgress: false, publishInProgress: false, registerInProgress: true,
                            address: addrMap[crate], deployTxHash, deployBlockHash, publishTxHash, publishBlockHash,
                        });
                    } else {
                        updateStatus(statuses, crate, "done", opts.onStatusChange, {
                            deployInProgress: false, address: addrMap[crate], deployTxHash, deployBlockHash,
                        });
                    }
                }

                // 5. REGISTER PHASE (needs address from deploy + CID from publish)
                if (cdmCrates.length > 0) {
                    const registerEntries = cdmCrates.map((c) => ({
                        cdmPackage: order.cdmPackageMap.get(c)!,
                        contractAddr: addrMap[c],
                        metadataUri: cidMap[c],
                    }));
                    const { txHash: registerTxHash, blockHash: registerBlockHash } =
                        await opts.services.registry.registerBatch(registerEntries);

                    for (const crate of cdmCrates) {
                        updateStatus(statuses, crate, "done", opts.onStatusChange, {
                            registerInProgress: false, registerTxHash, registerBlockHash,
                        });
                    }
                }
            } catch (err) {
                for (const crate of deployable) {
                    if (!failedCrates.has(crate)) {
                        failedCrates.add(crate);
                        updateStatus(statuses, crate, "error", opts.onStatusChange, {
                            deployInProgress: false, publishInProgress: false, registerInProgress: false,
                            error: err instanceof Error ? err.message : String(err),
                        });
                    }
                }
            }
        } else if (!opts.services) {
            for (const crate of deployable) {
                updateStatus(statuses, crate, "done", opts.onStatusChange);
            }
        }
    }

    const success = failedCrates.size === 0;
    return { addresses, statuses, success };
}
