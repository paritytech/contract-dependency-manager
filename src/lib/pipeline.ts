import { resolve } from "path";
import { existsSync, readFileSync } from "fs";
import {
    detectDeploymentOrderLayered,
    type DeploymentOrderLayered,
    type ContractInfo,
    getGitRemoteUrl,
    readReadmeContent,
} from "./detection.js";
import {
    pvmContractBuildAsync,
    type BuildResult,
    type BuildProgressCallback,
    type ContractDeployer,
    type Metadata,
    type AbiEntry,
} from "./deployer.js";

export type ContractState =
    | "waiting"
    | "building"
    | "built"
    | "deploying"
    | "deployed"
    | "publishing"
    | "registering"
    | "done"
    | "error";

export interface ContractStatus {
    crateName: string;
    state: ContractState;
    error?: string;
    address?: string;
    cid?: string;
    durationMs?: number;
    buildProgress?: { compiled: number; total: number; currentCrate: string };
}

export interface PipelineOptions {
    rootDir: string;
    registryAddr?: string;
    skipBuild?: boolean;
    deployer?: ContractDeployer; // undefined = build-only mode
    contractFilter?: string[]; // optional filter to only process specific contracts
    onStatusChange?: (crateName: string, status: ContractStatus) => void;
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
    const order = detectDeploymentOrderLayered(opts.rootDir);

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
        if (!opts.skipBuild) {
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
        }

        // 3. Filter to successful builds
        const deployable = runnable.filter((crate) => !failedCrates.has(crate));

        // 4. DEPLOY PHASE - batched
        if (opts.deployer && deployable.length > 0) {
            try {
                // Mark all as deploying
                for (const crate of deployable) {
                    updateStatus(statuses, crate, "deploying", opts.onStatusChange);
                }

                // Batch deploy
                const pvmPaths = deployable.map((c) =>
                    resolve(opts.rootDir, `target/${c}.release.polkavm`),
                );
                const batchAddrs = await opts.deployer.deployBatch(pvmPaths);
                const addrMap: Record<string, string> = {};
                for (let i = 0; i < deployable.length; i++) {
                    addrMap[deployable[i]] = batchAddrs[i];
                    addresses[deployable[i]] = batchAddrs[i];
                }

                // Mark all as deployed
                for (const crate of deployable) {
                    updateStatus(statuses, crate, "deployed", opts.onStatusChange, {
                        address: addrMap[crate],
                    });
                }

                // 5. PUBLISH METADATA PHASE - batched (CDM contracts only)
                const cdmCrates = deployable.filter((c) => order.cdmPackageMap.has(c));
                const cidMap: Record<string, string> = {};

                if (cdmCrates.length > 0) {
                    for (const crate of cdmCrates) {
                        updateStatus(statuses, crate, "publishing", opts.onStatusChange);
                    }

                    const metadataList: Metadata[] = cdmCrates.map((c) => {
                        const contract = order.contractMap.get(c)!;
                        const readmeContent = readReadmeContent(contract.readmePath);
                        const repository = contract.repository ?? getGitRemoteUrl(opts.rootDir) ?? "";
                        const abiPath = resolve(opts.rootDir, `target/${c}.release.abi.json`);
                        let abi: AbiEntry[] = [];
                        if (existsSync(abiPath)) {
                            try { abi = JSON.parse(readFileSync(abiPath, "utf-8")); } catch {}
                        }
                        return {
                            publish_block: 0,
                            published_at: "",
                            description: contract.description ?? "",
                            readme: readmeContent,
                            authors: contract.authors,
                            homepage: contract.homepage ?? "",
                            repository,
                            abi,
                        };
                    });

                    const { cids } = await opts.deployer.publishMetadataBatch(metadataList);
                    for (let i = 0; i < cdmCrates.length; i++) {
                        cidMap[cdmCrates[i]] = cids[i];
                    }

                    // 6. REGISTER PHASE - batched
                    for (const crate of cdmCrates) {
                        updateStatus(statuses, crate, "registering", opts.onStatusChange, {
                            cid: cidMap[crate],
                        });
                    }

                    const registerEntries = cdmCrates.map((c) => ({
                        cdmPackage: order.cdmPackageMap.get(c)!,
                        contractAddr: addrMap[c],
                        metadataUri: cidMap[c],
                    }));
                    await opts.deployer.registerBatch(registerEntries);
                }

                // 7. Mark ALL deployable as done
                for (const crate of deployable) {
                    updateStatus(statuses, crate, "done", opts.onStatusChange, {
                        address: addrMap[crate],
                        cid: cidMap[crate],
                    });
                }
            } catch (err) {
                // If batch fails, mark all deployable as failed
                for (const crate of deployable) {
                    if (!failedCrates.has(crate)) {
                        failedCrates.add(crate);
                        updateStatus(statuses, crate, "error", opts.onStatusChange, {
                            error: err instanceof Error ? err.message : String(err),
                        });
                    }
                }
            }
        } else if (!opts.deployer) {
            // Build-only mode
            for (const crate of deployable) {
                updateStatus(statuses, crate, "done", opts.onStatusChange);
            }
        }
    }

    const success = failedCrates.size === 0;
    return { addresses, statuses, success };
}
