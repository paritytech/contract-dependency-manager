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
        // Partition contracts into runnable vs skipped
        const runnable: string[] = [];
        for (const crate of layer) {
            const contract = order.contractMap.get(crate);
            const hasFailed = contract?.dependsOnCrates.some((dep) =>
                failedCrates.has(dep),
            );
            if (hasFailed) {
                failedCrates.add(crate);
                updateStatus(
                    statuses,
                    crate,
                    "error",
                    opts.onStatusChange,
                    { error: "Skipped: dependency failed" },
                );
            } else {
                runnable.push(crate);
            }
        }

        // BUILD PHASE
        if (!opts.skipBuild) {
            const buildResults = await Promise.all(
                runnable.map((crate) => {
                    updateStatus(
                        statuses,
                        crate,
                        "building",
                        opts.onStatusChange,
                    );

                    const onProgress: BuildProgressCallback = (
                        processed,
                        total,
                        currentCrate,
                    ) => {
                        updateStatus(
                            statuses,
                            crate,
                            "building",
                            opts.onStatusChange,
                            {
                                buildProgress: {
                                    compiled: processed,
                                    total,
                                    currentCrate,
                                },
                            },
                        );
                    };

                    return pvmContractBuildAsync(
                        opts.rootDir,
                        crate,
                        opts.registryAddr,
                        onProgress,
                    );
                }),
            );

            for (const result of buildResults) {
                if (result.success) {
                    updateStatus(
                        statuses,
                        result.crateName,
                        "built",
                        opts.onStatusChange,
                        { durationMs: result.durationMs },
                    );
                } else {
                    failedCrates.add(result.crateName);
                    updateStatus(
                        statuses,
                        result.crateName,
                        "error",
                        opts.onStatusChange,
                        {
                            error: result.stderr || "Build failed",
                            durationMs: result.durationMs,
                        },
                    );
                }
            }
        }

        // Filter out contracts that failed during build
        const deployable = runnable.filter(
            (crate) => !failedCrates.has(crate),
        );

        // DEPLOY PHASE
        if (opts.deployer) {
            // Deploy sequentially within a layer for nonce safety
            for (const crate of deployable) {
                try {
                    updateStatus(
                        statuses,
                        crate,
                        "deploying",
                        opts.onStatusChange,
                    );

                    const pvmPath = resolve(
                        opts.rootDir,
                        `target/${crate}.release.polkavm`,
                    );
                    const addr = await opts.deployer.deploy(pvmPath);
                    updateStatus(
                        statuses,
                        crate,
                        "deployed",
                        opts.onStatusChange,
                        { address: addr },
                    );
                    addresses[crate] = addr;

                    // Check if contract has a CDM package
                    const cdmPackage = order.cdmPackageMap.get(crate);
                    if (cdmPackage) {
                        updateStatus(
                            statuses,
                            crate,
                            "publishing",
                            opts.onStatusChange,
                        );

                        const contract = order.contractMap.get(crate)!;
                        const readmeContent = readReadmeContent(
                            contract.readmePath,
                        );
                        const repository =
                            contract.repository ??
                            getGitRemoteUrl(opts.rootDir) ??
                            "";
                        const abiPath = resolve(
                            opts.rootDir,
                            `target/${crate}.release.abi.json`,
                        );
                        let abi: AbiEntry[] = [];
                        if (existsSync(abiPath)) {
                            try {
                                abi = JSON.parse(
                                    readFileSync(abiPath, "utf-8"),
                                );
                            } catch {
                                // ignore parse errors
                            }
                        }

                        const metadata: Metadata = {
                            publish_block: 0,
                            published_at: "",
                            description: contract.description ?? "",
                            readme: readmeContent,
                            authors: contract.authors,
                            homepage: contract.homepage ?? "",
                            repository,
                            abi,
                        };

                        const { cid } =
                            await opts.deployer.publishMetadata(metadata);
                        updateStatus(
                            statuses,
                            crate,
                            "registering",
                            opts.onStatusChange,
                            { cid },
                        );

                        await opts.deployer.register(cdmPackage, addr, cid);
                    }

                    updateStatus(
                        statuses,
                        crate,
                        "done",
                        opts.onStatusChange,
                    );
                } catch (err) {
                    failedCrates.add(crate);
                    updateStatus(
                        statuses,
                        crate,
                        "error",
                        opts.onStatusChange,
                        {
                            error:
                                err instanceof Error
                                    ? err.message
                                    : String(err),
                        },
                    );
                }
            }
        } else {
            // Build-only mode: mark built contracts as "done"
            for (const crate of deployable) {
                updateStatus(statuses, crate, "done", opts.onStatusChange);
            }
        }
    }

    const success = failedCrates.size === 0;
    return { addresses, statuses, success };
}
