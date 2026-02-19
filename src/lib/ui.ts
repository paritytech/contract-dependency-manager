import { Listr, type ListrTask } from "listr2";
import chalk from "chalk";
import { resolve } from "path";
import { existsSync, readFileSync } from "fs";
import {
    detectDeploymentOrderLayered,
    type DeploymentOrderLayered,
    getGitRemoteUrl,
    readReadmeContent,
} from "./detection.js";
import {
    pvmContractBuildAsync,
    type ContractDeployer,
    type Metadata,
    type AbiEntry,
} from "./deployer.js";
import type { PipelineOptions, PipelineResult, ContractStatus } from "./pipeline.js";

export function progressBar(current: number, total: number, width: number = 20): string {
    if (total === 0) return "░".repeat(width);
    const filled = Math.round((current / total) * width);
    return "█".repeat(filled) + "░".repeat(width - filled);
}

export function formatDuration(ms: number): string {
    return `${(ms / 1000).toFixed(1)}s`;
}

export async function runPipelineWithUI(opts: PipelineOptions): Promise<PipelineResult> {
    const order = detectDeploymentOrderLayered(opts.rootDir);

    // Apply contract filter if provided
    let layers = order.layers;
    if (opts.contractFilter && opts.contractFilter.length > 0) {
        const filterSet = new Set(opts.contractFilter);
        layers = layers
            .map((layer) => layer.filter((crate) => filterSet.has(crate)))
            .filter((layer) => layer.length > 0);
    }

    // Shared state
    const addresses: Record<string, string> = {};
    const failedCrates = new Set<string>();
    const statuses = new Map<string, ContractStatus>();

    // Initialize statuses
    for (const layer of layers) {
        for (const crate of layer) {
            statuses.set(crate, { crateName: crate, state: "waiting" });
        }
    }

    const totalLayers = layers.length;

    // Build listr task tree
    const layerTasks: ListrTask[] = layers.map((layer, idx) => ({
        title: `Layer ${idx + 1}/${totalLayers}`,
        task: (_ctx: unknown, parentTask: any) =>
            parentTask.newListr(
                layer.map((crateName) => ({
                    title: `${crateName}  ${chalk.dim("waiting")}`,
                    task: async (_ctx: unknown, task: any) => {
                        // Check if blocked by failed dependency
                        const contract = order.contractMap.get(crateName)!;
                        const failedDep = contract.dependsOnCrates.find((d) =>
                            failedCrates.has(d),
                        );
                        if (failedDep) {
                            failedCrates.add(crateName);
                            statuses.set(crateName, {
                                crateName,
                                state: "error",
                                error: `Skipped: dependency '${failedDep}' failed`,
                            });
                            throw new Error(`Skipped: dependency '${failedDep}' failed`);
                        }

                        const startTime = Date.now();

                        // BUILD PHASE
                        if (!opts.skipBuild) {
                            task.title = `${crateName}  ${chalk.yellow("building...")}`;
                            statuses.set(crateName, { crateName, state: "building" });

                            const buildResult = await pvmContractBuildAsync(
                                opts.rootDir,
                                crateName,
                                opts.registryAddr,
                                (processed, total, currentCrate) => {
                                    task.title = `${crateName}  ${progressBar(processed, total)} ${chalk.yellow("building")} (${processed}/${total} crates, ${currentCrate})`;
                                },
                            );

                            if (!buildResult.success) {
                                failedCrates.add(crateName);
                                statuses.set(crateName, {
                                    crateName,
                                    state: "error",
                                    error: buildResult.stderr || "Build failed",
                                    durationMs: buildResult.durationMs,
                                });
                                throw new Error(`Build failed:\n${buildResult.stderr.slice(-500)}`);
                            }

                            task.title = `${crateName}  ${chalk.green("built")}`;
                            statuses.set(crateName, {
                                crateName,
                                state: "built",
                                durationMs: buildResult.durationMs,
                            });
                        }

                        // DEPLOY PHASE
                        if (opts.deployer) {
                            task.title = `${crateName}  ${chalk.yellow("deploying...")}`;
                            statuses.set(crateName, { crateName, state: "deploying" });

                            const pvmPath = resolve(
                                opts.rootDir,
                                `target/${crateName}.release.polkavm`,
                            );
                            const addr = await opts.deployer.deploy(pvmPath);
                            addresses[crateName] = addr;
                            statuses.set(crateName, {
                                crateName,
                                state: "deployed",
                                address: addr,
                            });

                            const cdmPackage = order.cdmPackageMap.get(crateName);
                            if (cdmPackage) {
                                task.title = `${crateName}  ${chalk.yellow("publishing metadata...")}`;
                                statuses.set(crateName, {
                                    crateName,
                                    state: "publishing",
                                    address: addr,
                                });

                                // Build metadata
                                const readmeContent = readReadmeContent(contract.readmePath);
                                const repository =
                                    contract.repository ??
                                    getGitRemoteUrl(opts.rootDir) ??
                                    "";
                                const abiPath = resolve(
                                    opts.rootDir,
                                    `target/${crateName}.release.abi.json`,
                                );
                                let abi: AbiEntry[] = [];
                                if (existsSync(abiPath)) {
                                    try {
                                        abi = JSON.parse(readFileSync(abiPath, "utf-8"));
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

                                const { cid } = await opts.deployer.publishMetadata(metadata);
                                statuses.set(crateName, {
                                    crateName,
                                    state: "registering",
                                    address: addr,
                                    cid,
                                });

                                task.title = `${crateName}  ${chalk.yellow("registering...")}`;
                                await opts.deployer.register(cdmPackage, addr, cid);
                            }

                            const elapsed = formatDuration(Date.now() - startTime);
                            task.title = `${crateName}  ${chalk.green("done")} → ${chalk.dim(addr)}  ${chalk.dim(`(${elapsed})`)}`;
                            statuses.set(crateName, {
                                crateName,
                                state: "done",
                                address: addr,
                                durationMs: Date.now() - startTime,
                            });
                        } else {
                            // Build-only mode
                            const elapsed = formatDuration(Date.now() - startTime);
                            task.title = `${crateName}  ${chalk.green("built")}  ${chalk.dim(`(${elapsed})`)}`;
                            statuses.set(crateName, {
                                crateName,
                                state: "done",
                                durationMs: Date.now() - startTime,
                            });
                        }
                    },
                })),
                { concurrent: true, exitOnError: false },
            ),
    }));

    const runner = new Listr(layerTasks, {
        concurrent: false,
        rendererOptions: {
            collapseSubtasks: false,
        },
        exitOnError: false,
    });

    try {
        await runner.run();
    } catch {
        // Errors are tracked in failedCrates/statuses, no need to rethrow
    }

    const success = failedCrates.size === 0;
    return { addresses, statuses, success };
}
