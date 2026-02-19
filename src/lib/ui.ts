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

    let layers = order.layers;
    if (opts.contractFilter && opts.contractFilter.length > 0) {
        const filterSet = new Set(opts.contractFilter);
        layers = layers
            .map((layer) => layer.filter((crate) => filterSet.has(crate)))
            .filter((layer) => layer.length > 0);
    }

    const addresses: Record<string, string> = {};
    const failedCrates = new Set<string>();
    const statuses = new Map<string, ContractStatus>();

    for (const layer of layers) {
        for (const crate of layer) {
            statuses.set(crate, { crateName: crate, state: "waiting" });
        }
    }

    const dn = (crate: string) => chalk.bold(order.cdmPackageMap.get(crate) ?? crate);

    // Per-layer done signals — previous layer must complete before next starts
    const layerDoneResolvers: (() => void)[] = [];
    const layerDone: Promise<void>[] = layers.map(() => {
        let resolve!: () => void;
        const p = new Promise<void>((r) => { resolve = r; });
        layerDoneResolvers.push(resolve);
        return p;
    });

    const allTasks: ListrTask[] = [];

    for (let layerIdx = 0; layerIdx < layers.length; layerIdx++) {
        const layer = layers[layerIdx];
        const prevDone = layerIdx > 0 ? layerDone[layerIdx - 1] : Promise.resolve();

        // Per-layer batch coordination
        const deployableCrates: string[] = [];
        let buildsRemaining = layer.length;
        let batchResolve!: (r: { addresses: Record<string, string>; cids: Record<string, string> }) => void;
        let batchReject!: (err: Error) => void;
        const batchResult = new Promise<{ addresses: Record<string, string>; cids: Record<string, string> }>((res, rej) => {
            batchResolve = res;
            batchReject = rej;
        });
        const taskHandles = new Map<string, any>();
        const startTimes = new Map<string, number>();

        // Runs deploy → publish → register for all deployable contracts in this layer.
        // Called inline by the last successful build, or as background by the last failed build.
        async function runBatch() {
            for (const c of deployableCrates) {
                const handle = taskHandles.get(c);
                if (handle) handle.title = `${dn(c)}  ${chalk.yellow("deploying...")}`;
            }

            const pvmPaths = deployableCrates.map((c) =>
                resolve(opts.rootDir, `target/${c}.release.polkavm`),
            );
            const batchAddrs = await opts.deployer!.deployBatch(pvmPaths);
            const addrMap: Record<string, string> = {};
            for (let i = 0; i < deployableCrates.length; i++) {
                addrMap[deployableCrates[i]] = batchAddrs[i];
            }

            // Update titles to show deployed addresses
            for (const c of deployableCrates) {
                const handle = taskHandles.get(c);
                if (handle) handle.title = `${dn(c)}  ${chalk.dim(addrMap[c])} ${chalk.green("deployed")}`;
                statuses.set(c, { crateName: c, state: "deployed", address: addrMap[c] });
            }

            const cidMap: Record<string, string> = {};
            const cdmCrates = deployableCrates.filter((c) => order.cdmPackageMap.has(c));
            if (cdmCrates.length > 0) {
                // PUBLISH METADATA (batched)
                for (const c of cdmCrates) {
                    const handle = taskHandles.get(c);
                    if (handle) handle.title = `${dn(c)}  ${chalk.dim(addrMap[c])} ${chalk.yellow("publishing metadata...")}`;
                    statuses.set(c, { crateName: c, state: "publishing", address: addrMap[c] });
                }

                const metadataList: Metadata[] = cdmCrates.map((c) => {
                    const cContract = order.contractMap.get(c)!;
                    const readmeContent = readReadmeContent(cContract.readmePath);
                    const repository = cContract.repository ?? getGitRemoteUrl(opts.rootDir) ?? "";
                    const abiPath = resolve(opts.rootDir, `target/${c}.release.abi.json`);
                    let abi: AbiEntry[] = [];
                    if (existsSync(abiPath)) {
                        try { abi = JSON.parse(readFileSync(abiPath, "utf-8")); } catch {}
                    }
                    return {
                        publish_block: 0,
                        published_at: "",
                        description: cContract.description ?? "",
                        readme: readmeContent,
                        authors: cContract.authors,
                        homepage: cContract.homepage ?? "",
                        repository,
                        abi,
                    };
                });

                const { cids } = await opts.deployer!.publishMetadataBatch(metadataList);
                for (let i = 0; i < cdmCrates.length; i++) {
                    cidMap[cdmCrates[i]] = cids[i];
                }

                // REGISTER (batched)
                for (const c of cdmCrates) {
                    const handle = taskHandles.get(c);
                    if (handle) handle.title = `${dn(c)}  ${chalk.dim(addrMap[c])} ${chalk.yellow("registering...")}`;
                    statuses.set(c, { crateName: c, state: "registering", address: addrMap[c], cid: cidMap[c] });
                }

                const registerEntries = cdmCrates.map((c, i) => ({
                    cdmPackage: order.cdmPackageMap.get(c)!,
                    contractAddr: addrMap[c],
                    metadataUri: cids[i],
                }));
                await opts.deployer!.registerBatch(registerEntries);
            }

            // Set final "done" titles for ALL contracts from the batch
            for (const c of deployableCrates) {
                const elapsed = formatDuration(Date.now() - (startTimes.get(c) ?? Date.now()));
                const handle = taskHandles.get(c);
                if (handle) handle.title = `${dn(c)}  ${chalk.green("done")} → ${chalk.dim(addrMap[c])}  ${chalk.dim(`(${elapsed})`)}`;
                addresses[c] = addrMap[c];
                statuses.set(c, {
                    crateName: c,
                    state: "done",
                    address: addrMap[c],
                    cid: cidMap[c],
                    durationMs: Date.now() - (startTimes.get(c) ?? Date.now()),
                });
            }

            return { addresses: addrMap, cids: cidMap };
        }

        for (const crateName of layer) {
            allTasks.push({
                title: `${dn(crateName)}  ${chalk.dim("waiting")}`,
                task: async (_ctx: unknown, task: any) => {
                    taskHandles.set(crateName, task);

                    // Wait for previous layer to complete
                    await prevDone;

                    // Check if blocked by failed dependency
                    const contract = order.contractMap.get(crateName)!;
                    const failedDep = contract.dependsOnCrates.find((d) => failedCrates.has(d));
                    if (failedDep) {
                        failedCrates.add(crateName);
                        statuses.set(crateName, {
                            crateName,
                            state: "error",
                            error: `Skipped: dependency '${failedDep}' failed`,
                        });
                        buildsRemaining--;
                        if (buildsRemaining === 0) {
                            if (opts.deployer && deployableCrates.length > 0) {
                                // Edge case: failed dep skip is last, trigger batch for waiting contracts
                                runBatch().then(r => batchResolve(r)).catch(e => batchReject(e)).finally(() => layerDoneResolvers[layerIdx]());
                            } else {
                                if (opts.deployer) batchResolve({ addresses: {}, cids: {} });
                                layerDoneResolvers[layerIdx]();
                            }
                        }
                        throw new Error(`Skipped: dependency '${failedDep}' failed`);
                    }

                    const startTime = Date.now();
                    startTimes.set(crateName, startTime);
                    let buildSuccess = true;
                    let buildResult: Awaited<ReturnType<typeof pvmContractBuildAsync>> | undefined;

                    // BUILD PHASE
                    if (!opts.skipBuild) {
                        task.title = `${dn(crateName)}  ${chalk.yellow("building...")}`;
                        statuses.set(crateName, { crateName, state: "building" });

                        buildResult = await pvmContractBuildAsync(
                            opts.rootDir,
                            crateName,
                            opts.registryAddr,
                            (processed, total, currentCrate) => {
                                task.title = `${dn(crateName)}  ${progressBar(processed, total)} ${chalk.yellow("building")} (${processed}/${total} crates, ${currentCrate})`;
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
                            buildSuccess = false;
                        } else {
                            task.title = `${dn(crateName)}  ${chalk.green("built")}`;
                            statuses.set(crateName, {
                                crateName,
                                state: "built",
                                durationMs: buildResult.durationMs,
                            });
                        }
                    }

                    // DEPLOY PHASE
                    if (opts.deployer) {
                        if (buildSuccess) deployableCrates.push(crateName);
                        buildsRemaining--;

                        if (buildsRemaining === 0 && deployableCrates.length > 0) {
                            if (buildSuccess) {
                                // Normal case: last successful build triggers batch INLINE
                                try {
                                    const result = await runBatch();
                                    batchResolve(result);
                                } catch (err) {
                                    for (const c of deployableCrates) {
                                        failedCrates.add(c);
                                        statuses.set(c, {
                                            crateName: c,
                                            state: "error",
                                            error: `Deploy failed: ${(err as Error).message}`,
                                        });
                                    }
                                    batchReject(err as Error);
                                    throw err;
                                } finally {
                                    layerDoneResolvers[layerIdx]();
                                }
                                // Triggerer is done — runBatch already set its title
                                return;
                            } else {
                                // Edge case: last build failed but others succeeded — trigger in background
                                runBatch().then(r => batchResolve(r)).catch(e => batchReject(e)).finally(() => layerDoneResolvers[layerIdx]());
                            }
                        } else if (buildsRemaining === 0 && deployableCrates.length === 0) {
                            // All builds failed
                            batchResolve({ addresses: {}, cids: {} });
                            layerDoneResolvers[layerIdx]();
                        } else if (buildSuccess) {
                            task.title = `${dn(crateName)}  ${chalk.dim("waiting to deploy...")}`;
                        }

                        if (!buildSuccess) {
                            throw new Error(`Build failed:\n${buildResult!.stderr.slice(-500)}`);
                        }

                        // Non-triggerer successful builds await the batch result
                        try {
                            await batchResult;
                        } catch (err) {
                            failedCrates.add(crateName);
                            throw new Error(`Deploy failed: ${(err as Error).message}`);
                        }

                        // Check if batch already marked us as failed (publish/register error)
                        if (failedCrates.has(crateName)) {
                            throw new Error(statuses.get(crateName)?.error ?? "Failed");
                        }

                        // runBatch already set our title and statuses — just return
                    } else {
                        // Build-only mode
                        if (!buildSuccess) {
                            buildsRemaining--;
                            if (buildsRemaining === 0) layerDoneResolvers[layerIdx]();
                            throw new Error(`Build failed:\n${buildResult!.stderr.slice(-500)}`);
                        }

                        const elapsed = formatDuration(Date.now() - startTime);
                        task.title = `${dn(crateName)}  ${chalk.green("built")}  ${chalk.dim(`(${elapsed})`)}`;
                        statuses.set(crateName, {
                            crateName,
                            state: "done",
                            durationMs: Date.now() - startTime,
                        });
                        buildsRemaining--;
                        if (buildsRemaining === 0) layerDoneResolvers[layerIdx]();
                    }
                },
            });
        }
    }

    const runner = new Listr(allTasks, {
        concurrent: true,
        rendererOptions: {
            collapseSubtasks: false,
        },
        exitOnError: false,
    });

    try {
        await runner.run();
    } catch {
        // Errors are tracked in failedCrates/statuses
    }

    const success = failedCrates.size === 0;
    return { addresses, statuses, success };
}
