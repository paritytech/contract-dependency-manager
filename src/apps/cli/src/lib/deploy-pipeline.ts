import { resolve } from "path";
import { existsSync, readFileSync } from "fs";
import {
    detectDeploymentOrderLayered,
    getGitRemoteUrl,
    readCdmPackage,
    readReadmeContent,
    pvmContractBuildAsync,
    computeCid,
} from "@dotdm/contracts";
import type {
    DeploymentOrderLayered,
    BuildProgressCallback,
    ContractDeployer,
    Metadata,
    AbiEntry,
    MetadataPublisher,
    RegistryManager,
} from "@dotdm/contracts";

export type ContractState =
    | "waiting"
    | "building"
    | "built"
    | "checking"
    | "cached"
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

export async function executePipeline(opts: PipelineOptions): Promise<PipelineResult> {
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

        // 2. BUILD PHASE + REGISTRY PRE-FETCH (parallel)
        // Pre-fetch registry addresses for any package names already known (from a
        // previous build). On fresh clones cdmPackageMap is empty, so nothing is
        // fetched here — gaps are filled after build when package names are discovered.
        const knownCdmPackages = runnable
            .map((c) => order.cdmPackageMap.get(c))
            .filter((p): p is string => !!p);
        const [buildResults, prefetchedAddresses] = await Promise.all([
            Promise.all(
                runnable.map((crate) => {
                    updateStatus(statuses, crate, "building", opts.onStatusChange);
                    const onProgress: BuildProgressCallback = (processed, total, currentCrate) => {
                        updateStatus(statuses, crate, "building", opts.onStatusChange, {
                            buildProgress: { compiled: processed, total, currentCrate },
                        });
                    };
                    return pvmContractBuildAsync(opts.rootDir, crate, onProgress);
                }),
            ),
            opts.services && knownCdmPackages.length > 0
                ? opts.services.registry.getAddressBatch(knownCdmPackages)
                : Promise.resolve(new Map<string, string | null>()),
        ]);

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
            if (!failedCrates.has(crate)) {
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
                const nonCdmCrates = deployable.filter((c) => !order.cdmPackageMap.has(c));
                const cidMap: Record<string, string> = {};
                const addrMap: Record<string, string> = {};

                // 4a. CHECK PHASE — compare local bytecode against on-chain code.
                // Signer-independent: caches hit even if a different account deployed.
                // Non-CDM contracts (no registry entry possible) always deploy.
                const toDeploy: string[] = [...nonCdmCrates];

                if (cdmCrates.length > 0) {
                    // Use pre-fetched addresses where package names match, fetch the rest
                    const missingPkgs = cdmCrates
                        .map((c) => order.cdmPackageMap.get(c)!)
                        .filter((pkg) => !prefetchedAddresses.has(pkg));
                    const freshAddresses =
                        missingPkgs.length > 0
                            ? await opts.services.registry.getAddressBatch(missingPkgs)
                            : new Map<string, string | null>();
                    const registryAddresses = new Map([...prefetchedAddresses, ...freshAddresses]);

                    const checkResults = await Promise.all(
                        cdmCrates.map(async (crate) => {
                            updateStatus(statuses, crate, "checking", opts.onStatusChange);
                            const cdmPkg = order.cdmPackageMap.get(crate)!;
                            const registryAddr = registryAddresses.get(cdmPkg);

                            if (!registryAddr) {
                                return { crate, cached: false as const };
                            }

                            // Compare local bytecode with on-chain pristine code
                            const pvmPath = resolve(
                                opts.rootDir,
                                `target/${crate}.release.polkavm`,
                            );
                            const localCode = readFileSync(pvmPath);
                            const onChainCode =
                                await opts.services!.deployer.getOnChainCode(registryAddr);

                            if (
                                onChainCode &&
                                localCode.length === onChainCode.length &&
                                Buffer.from(localCode).equals(Buffer.from(onChainCode))
                            ) {
                                return {
                                    crate,
                                    cached: true as const,
                                    address: registryAddr,
                                };
                            }

                            return { crate, cached: false as const };
                        }),
                    );

                    for (const check of checkResults) {
                        if (check.cached) {
                            addresses[check.crate] = check.address;
                            updateStatus(statuses, check.crate, "cached", opts.onStatusChange, {
                                address: check.address,
                            });
                        } else {
                            toDeploy.push(check.crate);
                        }
                    }
                }

                // 4b. DEPLOY + PUBLISH only non-cached contracts
                const cdmToDeploy = toDeploy.filter((c) => order.cdmPackageMap.has(c));
                const cdmToDeploySet = new Set(cdmToDeploy);

                if (toDeploy.length > 0) {
                    // Prepare metadata and precompute CIDs for CDM crates being deployed
                    let metadataList: Metadata[] = [];
                    let precomputedCids: string[] = [];
                    if (cdmToDeploy.length > 0) {
                        const publishedAt = new Date().toISOString();
                        metadataList = cdmToDeploy.map((c) => {
                            const contract = order.contractMap.get(c)!;
                            const readmeContent = readReadmeContent(contract.readmePath);
                            const repository =
                                contract.repository ?? getGitRemoteUrl(opts.rootDir) ?? "";
                            const abiPath = resolve(opts.rootDir, `target/${c}.release.abi.json`);
                            let abi: AbiEntry[] = [];
                            if (existsSync(abiPath)) {
                                try {
                                    abi = JSON.parse(readFileSync(abiPath, "utf-8"));
                                } catch {}
                            }
                            return {
                                publish_block: 0,
                                published_at: publishedAt,
                                description: contract.description ?? "",
                                readme: readmeContent,
                                authors: contract.authors,
                                homepage: contract.homepage ?? "",
                                repository,
                                abi,
                            };
                        });
                        precomputedCids = metadataList.map((m) =>
                            computeCid(new TextEncoder().encode(JSON.stringify(m))),
                        );
                        for (let i = 0; i < cdmToDeploy.length; i++) {
                            cidMap[cdmToDeploy[i]] = precomputedCids[i];
                        }
                    }

                    // Mark deploying (+ publishing for CDM crates)
                    for (const crate of toDeploy) {
                        updateStatus(statuses, crate, "deploying", opts.onStatusChange, {
                            deployInProgress: true,
                            ...(cdmToDeploySet.has(crate)
                                ? { publishInProgress: true, cid: cidMap[crate] }
                                : {}),
                        });
                    }

                    // Deploy (AssetHub) + Publish (Bulletin) in parallel
                    const pvmPaths = toDeploy.map((c) =>
                        resolve(opts.rootDir, `target/${c}.release.polkavm`),
                    );
                    const cdmPackages = toDeploy.map((c) => order.cdmPackageMap.get(c));
                    const [deployResult, publishResult] = await Promise.all([
                        opts.services.deployer.deployBatch(pvmPaths, cdmPackages),
                        cdmToDeploy.length > 0
                            ? opts.services.publisher.publishBatch(metadataList)
                            : Promise.resolve(null),
                    ]);

                    // Process deploy results
                    const {
                        addresses: batchAddrs,
                        txHash: deployTxHash,
                        blockHash: deployBlockHash,
                    } = deployResult;
                    for (let i = 0; i < toDeploy.length; i++) {
                        addrMap[toDeploy[i]] = batchAddrs[i];
                        addresses[toDeploy[i]] = batchAddrs[i];
                    }

                    // Verify published CIDs
                    let publishTxHash = "";
                    let publishBlockHash = "";
                    if (publishResult) {
                        for (let i = 0; i < precomputedCids.length; i++) {
                            if (publishResult.cids[i] !== precomputedCids[i]) {
                                throw new Error(
                                    `CID mismatch for ${cdmToDeploy[i]}: expected ${precomputedCids[i]}, got ${publishResult.cids[i]}`,
                                );
                            }
                        }
                        publishTxHash = publishResult.txHash;
                        publishBlockHash = publishResult.blockHash;
                    }

                    // Transition: CDM crates → registering, non-CDM → done
                    for (const crate of toDeploy) {
                        if (cdmToDeploySet.has(crate)) {
                            updateStatus(statuses, crate, "registering", opts.onStatusChange, {
                                deployInProgress: false,
                                publishInProgress: false,
                                registerInProgress: true,
                                address: addrMap[crate],
                                deployTxHash,
                                deployBlockHash,
                                publishTxHash,
                                publishBlockHash,
                            });
                        } else {
                            updateStatus(statuses, crate, "done", opts.onStatusChange, {
                                deployInProgress: false,
                                address: addrMap[crate],
                                deployTxHash,
                                deployBlockHash,
                            });
                        }
                    }

                    // 5. REGISTER PHASE (needs address from deploy + CID from publish)
                    if (cdmToDeploy.length > 0) {
                        const registerEntries = cdmToDeploy.map((c) => ({
                            cdmPackage: order.cdmPackageMap.get(c)!,
                            contractAddr: addrMap[c],
                            metadataUri: cidMap[c],
                        }));
                        const { txHash: registerTxHash, blockHash: registerBlockHash } =
                            await opts.services.registry.registerBatch(registerEntries);

                        for (const crate of cdmToDeploy) {
                            updateStatus(statuses, crate, "done", opts.onStatusChange, {
                                registerInProgress: false,
                                registerTxHash,
                                registerBlockHash,
                            });
                        }
                    }
                }
            } catch (err) {
                for (const crate of deployable) {
                    if (!failedCrates.has(crate) && statuses.get(crate)?.state !== "cached") {
                        failedCrates.add(crate);
                        updateStatus(statuses, crate, "error", opts.onStatusChange, {
                            deployInProgress: false,
                            publishInProgress: false,
                            registerInProgress: false,
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

if (import.meta.vitest) {
    const { describe, test, expect, vi, beforeEach } = import.meta.vitest;

    // ── mocks ──────────────────────────────────────────────────────────
    vi.mock("@dotdm/contracts", () => ({
        pvmContractBuildAsync: vi.fn(
            async (_root: string, crateName: string) =>
                ({ crateName, success: true, stdout: "", stderr: "", durationMs: 100 }) as any,
        ),
        detectDeploymentOrderLayered: vi.fn(),
        readCdmPackage: vi.fn(() => null),
        getGitRemoteUrl: vi.fn(() => "https://github.com/test/repo"),
        readReadmeContent: vi.fn(() => ""),
        computeCid: vi.fn(() => "fakeCid123"),
    }));

    vi.mock("fs", () => ({
        existsSync: vi.fn(() => true),
        readFileSync: vi.fn(() => "[]"),
    }));

    // Pull references so we can tweak per-test
    const {
        pvmContractBuildAsync: mockBuild,
        readCdmPackage: mockReadCdm,
        computeCid: mockComputeCid,
    } = await import("@dotdm/contracts");

    // ── helpers ─────────────────────────────────────────────────────────
    type CI = import("@dotdm/contracts").ContractInfo;

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

    function makeServices(): DeployServices {
        return {
            deployer: {
                deployBatch: vi.fn(async (paths: string[]) => ({
                    addresses: paths.map((_, i) => `0xaddr${i}`),
                    txHash: "0xdeploy",
                    blockHash: "0xblock",
                })),
                getOnChainCode: vi.fn(async () => null),
            } as any,
            publisher: {
                publishBatch: vi.fn(async (metaList: any[]) => ({
                    cids: metaList.map(() => "fakeCid123"),
                    blockNumber: 1,
                    txHash: "0xpub",
                    blockHash: "0xpblock",
                })),
            } as any,
            registry: {
                registerBatch: vi.fn(async () => ({
                    txHash: "0xreg",
                    blockHash: "0xrblock",
                })),
                getAddressBatch: vi.fn(async () => new Map()),
            } as any,
        };
    }

    beforeEach(() => {
        vi.clearAllMocks();
        // restore default happy-path mock for build
        (mockBuild as any).mockImplementation(async (_root: string, crateName: string) => ({
            crateName,
            success: true,
            stdout: "",
            stderr: "",
            durationMs: 100,
        }));
        (mockReadCdm as any).mockReturnValue(null);
        (mockComputeCid as any).mockReturnValue("fakeCid123");
    });

    // ── tests ───────────────────────────────────────────────────────────
    describe("pipeline execution", () => {
        test("contracts in same layer build concurrently", async () => {
            const order = makeOrder([["a", "b"]]);
            const result = await executePipeline({ rootDir: "/fake", order });

            expect(mockBuild).toHaveBeenCalledTimes(2);
            expect(result.success).toBe(true);
            expect(result.statuses.get("a")!.state).toBe("done");
            expect(result.statuses.get("b")!.state).toBe("done");
        });

        test("layer N+1 waits for layer N to complete", async () => {
            const callOrder: string[] = [];
            (mockBuild as any).mockImplementation(async (_root: string, crateName: string) => {
                callOrder.push(`start:${crateName}`);
                // small delay to make ordering observable
                await new Promise((r) => setTimeout(r, 5));
                callOrder.push(`end:${crateName}`);
                return { crateName, success: true, stdout: "", stderr: "", durationMs: 50 };
            });

            const order = makeOrder([["a"], ["b"]], { b: ["a"] });
            await executePipeline({ rootDir: "/fake", order });

            const endA = callOrder.indexOf("end:a");
            const startB = callOrder.indexOf("start:b");
            expect(endA).toBeLessThan(startB);
        });

        test("error in one contract cascades to dependents", async () => {
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

            const order = makeOrder([["a"], ["b"]], { b: ["a"] });
            const result = await executePipeline({ rootDir: "/fake", order });

            expect(result.success).toBe(false);
            expect(result.statuses.get("a")!.state).toBe("error");
            expect(result.statuses.get("b")!.state).toBe("error");
            expect(result.statuses.get("b")!.error).toBe("Skipped: dependency failed");
        });

        test("error in one contract does not affect independent contracts", async () => {
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

            const order = makeOrder([["a", "b"]]);
            const result = await executePipeline({ rootDir: "/fake", order });

            expect(result.success).toBe(false);
            expect(result.statuses.get("a")!.state).toBe("error");
            expect(result.statuses.get("b")!.state).toBe("done");
        });

        test("build-only mode skips deploy phase", async () => {
            const order = makeOrder([["a"]]);
            const result = await executePipeline({
                rootDir: "/fake",
                order,
                services: undefined,
            });

            expect(result.success).toBe(true);
            expect(result.statuses.get("a")!.state).toBe("done");
            expect(Object.keys(result.addresses)).toHaveLength(0);
        });

        test("CDM packages detected after build on fresh clone", async () => {
            (mockReadCdm as any).mockReturnValue("@test/my-contract");

            const detected: [string, string][] = [];
            const order = makeOrder([["a"]]);
            await executePipeline({
                rootDir: "/fake",
                order,
                onCdmPackageDetected: (crate, pkg) => detected.push([crate, pkg]),
            });

            expect(detected).toEqual([["a", "@test/my-contract"]]);
            expect(order.cdmPackageMap.get("a")).toBe("@test/my-contract");
        });

        test("status callbacks fire in correct order", async () => {
            (mockReadCdm as any).mockReturnValue("@test/pkg");

            const states: ContractState[] = [];
            const services = makeServices();
            const order = makeOrder([["a"]], {}, { a: "@test/pkg" });
            await executePipeline({
                rootDir: "/fake",
                order,
                services,
                onStatusChange: (_crate, status) => states.push(status.state),
            });

            expect(states).toEqual([
                "building",
                "built",
                "checking",
                "deploying",
                "registering",
                "done",
            ]);
        });

        test("empty pipeline succeeds immediately", async () => {
            const order: DeploymentOrderLayered = {
                layers: [],
                contractMap: new Map(),
                cdmPackageMap: new Map(),
            };
            const result = await executePipeline({ rootDir: "/fake", order });

            expect(result.success).toBe(true);
            expect(result.addresses).toEqual({});
            expect(result.statuses.size).toBe(0);
        });

        test("single contract works without parallelism overhead", async () => {
            (mockReadCdm as any).mockReturnValue("@test/solo");

            const services = makeServices();
            const order = makeOrder([["solo"]], {}, { solo: "@test/solo" });
            const result = await executePipeline({
                rootDir: "/fake",
                order,
                services,
            });

            expect(result.success).toBe(true);
            expect(result.statuses.get("solo")!.state).toBe("done");
            expect(result.addresses["solo"]).toBe("0xaddr0");
            expect(services.publisher.publishBatch).toHaveBeenCalledTimes(1);
            expect(services.registry.registerBatch).toHaveBeenCalledTimes(1);
        });

        test("cache hit: on-chain bytecode matches local → skip deploy", async () => {
            (mockReadCdm as any).mockReturnValue("@test/cached-pkg");

            const services = makeServices();
            // Registry has an address for this package
            (services.registry.getAddressBatch as any).mockResolvedValue(
                new Map([["@test/cached-pkg", "0xexisting"]]),
            );
            // On-chain code matches what readFileSync returns (mocked as "[]")
            (services.deployer.getOnChainCode as any).mockResolvedValue(
                new TextEncoder().encode("[]"),
            );

            const order = makeOrder([["a"]], {}, { a: "@test/cached-pkg" });
            const result = await executePipeline({
                rootDir: "/fake",
                order,
                services,
            });

            expect(result.success).toBe(true);
            expect(result.statuses.get("a")!.state).toBe("cached");
            expect(result.statuses.get("a")!.address).toBe("0xexisting");
            expect(result.addresses["a"]).toBe("0xexisting");
            expect(services.deployer.deployBatch).not.toHaveBeenCalled();
            expect(services.publisher.publishBatch).not.toHaveBeenCalled();
            expect(services.registry.registerBatch).not.toHaveBeenCalled();
        });

        test("bytecode changed: on-chain code differs → deploy new version", async () => {
            (mockReadCdm as any).mockReturnValue("@test/changed-pkg");

            const services = makeServices();
            (services.registry.getAddressBatch as any).mockResolvedValue(
                new Map([["@test/changed-pkg", "0xold-addr"]]),
            );
            // On-chain code is different from local
            (services.deployer.getOnChainCode as any).mockResolvedValue(
                new TextEncoder().encode("old-bytecode"),
            );

            const order = makeOrder([["a"]], {}, { a: "@test/changed-pkg" });
            const result = await executePipeline({
                rootDir: "/fake",
                order,
                services,
            });

            expect(result.success).toBe(true);
            expect(result.statuses.get("a")!.state).toBe("done");
            expect(services.deployer.deployBatch).toHaveBeenCalledTimes(1);
        });

        test("first deploy: not in registry → deploy", async () => {
            (mockReadCdm as any).mockReturnValue("@test/new-pkg");

            const services = makeServices();
            // Registry returns nothing for this package
            (services.registry.getAddressBatch as any).mockResolvedValue(new Map());

            const order = makeOrder([["a"]], {}, { a: "@test/new-pkg" });
            const result = await executePipeline({
                rootDir: "/fake",
                order,
                services,
            });

            expect(result.success).toBe(true);
            expect(result.statuses.get("a")!.state).toBe("done");
            expect(services.deployer.deployBatch).toHaveBeenCalledTimes(1);
            // getOnChainCode should NOT be called (no address to check)
            expect(services.deployer.getOnChainCode).not.toHaveBeenCalled();
        });

        test("mixed batch: cached contracts skipped, new ones deploy", async () => {
            (mockReadCdm as any).mockImplementation(
                (_root: string, crate: string) => `@test/${crate}`,
            );

            const services = makeServices();
            // "a" is in registry with matching code, "b" is not in registry
            (services.registry.getAddressBatch as any).mockResolvedValue(
                new Map([["@test/a", "0xexisting-a"]]),
            );
            (services.deployer.getOnChainCode as any).mockResolvedValue(
                new TextEncoder().encode("[]"),
            );

            const order = makeOrder([["a", "b"]], {}, { a: "@test/a", b: "@test/b" });
            const result = await executePipeline({
                rootDir: "/fake",
                order,
                services,
            });

            expect(result.success).toBe(true);
            expect(result.statuses.get("a")!.state).toBe("cached");
            expect(result.statuses.get("a")!.address).toBe("0xexisting-a");
            expect(result.statuses.get("b")!.state).toBe("done");
            expect(result.addresses["a"]).toBe("0xexisting-a");
        });

        test("non-CDM contracts always deploy (no caching)", async () => {
            const services = makeServices();
            const order = makeOrder([["a"]]);
            const result = await executePipeline({
                rootDir: "/fake",
                order,
                services,
            });

            expect(result.success).toBe(true);
            expect(result.statuses.get("a")!.state).toBe("done");
            expect(result.addresses["a"]).toBe("0xaddr0");
            expect(services.deployer.getOnChainCode).not.toHaveBeenCalled();
            expect(services.deployer.deployBatch).toHaveBeenCalledTimes(1);
        });
    });
}
