import { dirname, relative, resolve } from "path";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import type { PolkadotSigner, SS58String, HexString } from "polkadot-api";
import { Enum } from "polkadot-api";
import type { CdmChainClient } from "@dotdm/env";
import {
    createContractFromClient,
    type Contract,
    type ContractDef,
} from "@parity/product-sdk-contracts";
import { stringifyBigInt } from "@dotdm/utils";
import { CONTRACTS_REGISTRY_ABI } from "./abi/registry";

import {
    type ContractInfo,
    type ContractToolchain,
    type DeploymentOrderLayered,
    buildDependencyGraph,
    detectDeploymentOrderLayered,
    getGitRemoteUrl,
    readReadmeContent,
    toposortLayers,
} from "./detection";
import { pvmContractBuildAsync, type BuildProgressCallback } from "./builder";
import { computeBulletinStoreCid } from "./cid";
import {
    type CdmBuildManifestContract,
    buildManifestPath,
    writeBuildManifest,
} from "./build-manifest";
import {
    buildSolidityToolchain,
    detectSolidityBuildTargets,
    type SolidityBuildTarget,
} from "./solidity";
import {
    generateSolidityImport,
    generateSolidityLocalBuildImport,
    type SolidityAbiEntry,
    solidityImportPathForLibrary,
} from "./solidity-imports";
import {
    ContractDeployer,
    computeDeploySalt,
    type AbiEntry,
    type DeploySaltVersion,
    type Metadata,
} from "./deployer";
import { MetadataPublisher } from "./publisher";

async function queryRegistryVersionCounts(
    contract: Contract<ContractDef>,
    pkgs: string[],
): Promise<Map<string, number>> {
    const entries = await Promise.all(
        pkgs.map(async (pkg): Promise<readonly [string, number]> => {
            const versionResult = await contract.getVersionCount.query(pkg);

            if (!versionResult.success || typeof versionResult.value !== "number") {
                throw new Error(`Failed to query registry version count for "${pkg}"`);
            }

            return [pkg, versionResult.value];
        }),
    );
    return new Map(entries);
}

/**
 * `deployContracts` expects a chain-client-shaped object that provides both
 * `assetHub` and `bulletin` keys, typed against product-sdk descriptors so callers
 * (e.g., product-sdk's `getChainAPI("paseo" | "previewnet")`) can pass
 * their own clients in without any cast.
 */
export type PipelineChainClient = CdmChainClient;

// ---------- shared types ----------

export interface BuildContractsOptions {
    rootDir: string;
    /** Crate-name filter; default: all detected */
    contracts?: string[];
    /** Cargo feature flags to pass to the build */
    features?: string;
    /** Registry address embedded into contracts through CONTRACTS_REGISTRY_ADDR. */
    registryAddress?: HexString;
    onEvent?: (e: BuildEvent) => void;
}

export type BuildEvent =
    | { type: "detect"; contracts: ContractInfo[]; layers: string[][] }
    | { type: "log"; line: string; source?: string }
    | { type: "build-start"; crate: string }
    | { type: "build-progress"; crate: string; compiled: number; total: number }
    | { type: "build-done"; crate: string; durationMs: number; bytecodeSize: number }
    | { type: "build-error"; crate: string; error: string }
    | { type: "pipeline-done"; summary: BuildSummary }
    | { type: "pipeline-error"; error: string };

export interface BuildSummary {
    manifestPath?: string;
    contracts: Array<{
        crate: string;
        name?: string;
        displayName?: string;
        toolchain?: ContractToolchain;
        pvmPath?: string;
        abiPath?: string;
        artifactPath?: string;
        sourcePath?: string;
        contractName?: string;
        bytecodeSize?: number;
        durationMs?: number;
        cdmPackage?: string | null;
        error?: string;
    }>;
    totalDurationMs: number;
}

export interface DeployContractsOptions {
    rootDir: string;
    contracts?: string[];
    /** Cargo feature flags to pass to the build */
    features?: string;

    // Injected infra — REQUIRED, do not create connections internally
    client: PipelineChainClient;
    signer: PolkadotSigner;
    origin: SS58String;
    registryAddress: HexString;
    /**
     * Signer used for Bulletin metadata publishes. Defaults to `signer`.
     *
     * Hosts with separated account semantics, such as playground-cli mobile
     * sessions, should pass their Bulletin allowance slot signer here while
     * keeping `signer`/`origin` as the Asset Hub product account that deploys
     * contracts and publishes registry entries.
     */
    metadataSigner?: PolkadotSigner;

    // Tuning (reserved for future use by internal tx layers)
    waitFor?: "best-block" | "finalized";
    timeoutMs?: number;
    gateway?: string;

    onEvent?: (e: DeployEvent) => void;
}

export type DeployEvent =
    | { type: "detect"; contracts: ContractInfo[]; layers: string[][] }
    | { type: "log"; line: string; source?: string }
    | { type: "build-start"; crate: string }
    | { type: "build-progress"; crate: string; compiled: number; total: number }
    | { type: "build-done"; crate: string; durationMs: number; bytecodeSize: number }
    | { type: "build-error"; crate: string; error: string }
    | { type: "check-cached"; crate: string; address: HexString }
    | { type: "check-needs-deploy"; crate: string; address: HexString }
    | {
          /**
           * Coarse "what's happening right now" signal for the dead time
           * between build-done and the first per-row deploy spinner. Fires
           * synchronously — consumers (CLI TUI, playground) can use the
           * `description` to drive a top-of-screen spinner. No pipeline code
           * awaits anything on this event.
           *
           * `name` values:
           *  - `connecting-registry`    — creating the ContractRegistry handle
           *  - `checking-versions`       — querying registry version counts
           *  - `precomputing-addresses`  — dry-run planDeploy for CREATE2 addrs
           *  - `preparing-metadata`      — assembling ABI/readme/etc for publish
           *  - `deploying`               — about to emit `deploy-register-start`
           *  - `publishing`              — about to emit `publish-start`
           *  - `done`                    — pipeline complete (paired with pipeline-done)
           */
          type: "phase";
          name:
              | "connecting-registry"
              | "checking-versions"
              | "precomputing-addresses"
              | "preparing-metadata"
              | "deploying"
              | "publishing"
              | "done";
          description: string;
          layer?: number;
      }
    | {
          type: "sign-request";
          phase: "deploy-register" | "publish";
          crates: string[];
      }
    | {
          /**
           * Diagnostic, one-shot per layer, emitted AFTER the dry-run +
           * chunking decisions are finalized but BEFORE the first chunk is
           * submitted. Informational only — the pipeline does NOT wait for a
           * response; it continues to submission immediately after emitting.
           *
           * `extrinsicWeight` is what the chunker actually sums against
           * `budget` (= dry-run gasLimit + pallet-declared static per-call
           * weight). `gasLimit` is the execution-only cap passed to the
           * dispatchable. Keeping both exposed makes it easy to see why
           * the chunker landed on a given split.
           */
          type: "deploy-plan";
          layer: number; // 0-based layer index
          crates: string[]; // layer's deployable crates (input order)
          budget: { ref_time: bigint; proof_size: bigint };
          perContract: Array<{
              crate: string;
              gasLimit: { ref_time: bigint; proof_size: bigint };
              extrinsicWeight: { ref_time: bigint; proof_size: bigint };
              storageDeposit: bigint;
          }>;
          chunks: string[][]; // resulting chunks of crate names
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
    | { type: "deploy-skip"; crate: string; reason: string }
    | { type: "publish-start"; crates: string[] }
    | {
          type: "publish-done";
          cids: Record<string, string>;
          txHash: string;
          durationMs: number;
      }
    | { type: "pipeline-done"; summary: DeploySummary }
    | { type: "pipeline-error"; error: string };

export interface DeploySummary {
    contracts: Array<{
        crate: string;
        cdmPackage?: string;
        address?: HexString;
        cid?: string;
        status: "done" | "cached" | "skipped" | "error";
        error?: string;
    }>;
    totalDurationMs: number;
}

// ---------- internal helpers ----------

interface DetectedPipeline {
    order: DeploymentOrderLayered;
    layers: string[][];
}

interface DetectedBuildPipeline {
    contracts: ContractInfo[];
    layers: string[][];
    contractMap: Map<string, ContractInfo>;
    cdmPackageMap: Map<string, string>;
    rust?: DetectedPipeline;
    solidity: {
        foundry: SolidityBuildTarget[];
        hardhat: SolidityBuildTarget[];
    };
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

function matchesContractFilter(contract: ContractInfo, filterSet: Set<string>): boolean {
    return (
        filterSet.has(contract.name) ||
        (contract.displayName ? filterSet.has(contract.displayName) : false) ||
        (contract.cdmPackage ? filterSet.has(contract.cdmPackage) : false)
    );
}

function assertUniqueCdmPackages(contracts: ContractInfo[]): void {
    const seen = new Map<string, string>();
    for (const contract of contracts) {
        if (!contract.cdmPackage) continue;

        const previous = seen.get(contract.cdmPackage);
        if (previous) {
            throw new Error(
                `Duplicate CDM package "${contract.cdmPackage}" declared by ${previous} and ${contract.name}`,
            );
        }
        seen.set(contract.cdmPackage, contract.name);
    }
}

/**
 * Detect every buildable contract target in the workspace and normalize all
 * dependency edges into crate/target names. Rust contributes Cargo dependency
 * edges; Solidity contributes CDM import edges from generated `.cdm/solidity`
 * import files. The resulting layers are language-agnostic.
 */
export function detectBuildOrder(
    rootDir: string,
    filter: string[] | undefined = undefined,
): DetectedBuildPipeline {
    const filterSet = filter && filter.length > 0 ? new Set(filter) : null;
    let rust: DetectedPipeline | undefined;
    const rustContracts: ContractInfo[] = [];

    if (existsSync(resolve(rootDir, "Cargo.toml"))) {
        const detected = detectAndFilter(rootDir, filter);
        rust = detected;
        for (const crate of detected.layers.flat()) {
            const contract = detected.order.contractMap.get(crate);
            if (contract) rustContracts.push(contract);
        }
    }

    const solidityTargets = detectSolidityBuildTargets(rootDir).filter((target) =>
        filterSet ? matchesContractFilter(target, filterSet) : true,
    );
    const foundry = solidityTargets.filter((target) => target.toolchain === "foundry");
    const hardhat = solidityTargets.filter((target) => target.toolchain === "hardhat");

    const contracts = [...rustContracts, ...foundry, ...hardhat];
    assertUniqueCdmPackages(contracts);

    const graph = buildDependencyGraph(contracts);
    const layers = toposortLayers(graph);
    const contractMap = new Map<string, ContractInfo>();
    const cdmPackageMap = new Map<string, string>();
    for (const contract of contracts) {
        contractMap.set(contract.name, contract);
        if (contract.cdmPackage) cdmPackageMap.set(contract.name, contract.cdmPackage);
    }

    return {
        contracts,
        layers,
        contractMap,
        cdmPackageMap,
        rust,
        solidity: { foundry, hardhat },
    };
}

interface BuildInfo {
    durationMs: number;
    pvmPath?: string;
    abiPath?: string;
    artifactPath?: string;
    sourcePath?: string;
    contractName?: string;
    bytecodeSize?: number;
    toolchain?: ContractToolchain;
    displayName?: string;
    error?: string;
    cdmPackage?: string | null;
}

interface BuildPhaseResult {
    /** Crates whose build succeeded (in layered order). */
    successful: string[];
    /** Crates whose build failed or were skipped due to dep failure. */
    failed: Set<string>;
    /** Per-crate build info (size + durationMs) for the summary. */
    info: Map<string, BuildInfo>;
}

interface DeployableContract {
    crate: string;
    cdmPackage: string;
    pvmPath: string;
    abiPath?: string;
    contract: ContractInfo;
}

type BuildEmitter = (e: BuildEvent | DeployEvent) => void;

function markSkippedBuild(
    build: BuildPhaseResult,
    detected: DetectedBuildPipeline,
    crate: string,
    emit: BuildEmitter,
): void {
    build.failed.add(crate);
    build.info.set(crate, {
        durationMs: 0,
        error: "Skipped: dependency failed",
        cdmPackage: detected.cdmPackageMap.get(crate) ?? null,
    });
    emit({ type: "build-error", crate, error: "Skipped: dependency failed" });
}

async function buildRustTargets(
    rootDir: string,
    detected: DetectedBuildPipeline,
    build: BuildPhaseResult,
    crates: string[],
    emit: BuildEmitter,
    features?: string,
    registryAddress?: HexString,
): Promise<void> {
    const results = await Promise.all(
        crates.map(async (crate) => {
            emit({ type: "build-start", crate });
            const onProgress: BuildProgressCallback = (compiled, total) => {
                emit({ type: "build-progress", crate, compiled, total });
            };
            return pvmContractBuildAsync(rootDir, crate, onProgress, features, registryAddress);
        }),
    );

    for (const result of results) {
        if (result.success) {
            const pvmPath = resolve(rootDir, `target/release/${result.crateName}.polkavm`);
            let bytecodeSize: number | undefined;
            try {
                bytecodeSize = readFileSync(pvmPath).length;
            } catch {
                bytecodeSize = undefined;
            }

            const contract = detected.contractMap.get(result.crateName);
            const cdmPackage = detected.cdmPackageMap.get(result.crateName) ?? null;

            build.successful.push(result.crateName);
            build.info.set(result.crateName, {
                durationMs: result.durationMs,
                pvmPath,
                abiPath: resolve(rootDir, `target/release/${result.crateName}.abi.json`),
                toolchain: "rust",
                displayName: cdmPackage ?? contract?.displayName ?? result.crateName,
                sourcePath: contract?.path,
                contractName: result.crateName,
                cdmPackage,
                bytecodeSize,
            });
            emit({
                type: "build-done",
                crate: result.crateName,
                durationMs: result.durationMs,
                bytecodeSize: bytecodeSize ?? 0,
            });
        } else {
            build.failed.add(result.crateName);
            build.info.set(result.crateName, {
                durationMs: result.durationMs,
                error: result.stderr || "Build failed",
                cdmPackage: detected.cdmPackageMap.get(result.crateName) ?? null,
            });
            emit({
                type: "build-error",
                crate: result.crateName,
                error: result.stderr || "Build failed",
            });
        }
    }
}

async function buildSolidityTargets(
    rootDir: string,
    build: BuildPhaseResult,
    toolchain: "foundry" | "hardhat",
    targets: SolidityBuildTarget[],
    emit: BuildEmitter,
): Promise<void> {
    if (targets.length === 0) return;

    for (const target of targets) {
        emit({ type: "build-start", crate: target.name });
        emit({ type: "build-progress", crate: target.name, compiled: 0, total: 1 });
    }

    const { result, artifacts, missing } = await buildSolidityToolchain(
        rootDir,
        toolchain,
        targets,
        {
            onData: (line) => emit({ type: "log", source: toolchain, line }),
        },
    );

    if (!result.success) {
        const error = result.stderr || result.error || `${toolchain} build failed`;
        for (const target of targets) {
            build.failed.add(target.name);
            build.info.set(target.name, {
                durationMs: result.durationMs,
                toolchain,
                displayName: target.displayName ?? target.name,
                sourcePath: target.sourcePath,
                contractName: target.contractName,
                cdmPackage: target.cdmPackage,
                error,
            });
            emit({ type: "build-error", crate: target.name, error });
        }
        return;
    }

    for (const artifact of artifacts) {
        const crate = artifact.target.name;
        build.successful.push(crate);
        build.info.set(crate, {
            durationMs: artifact.durationMs,
            pvmPath: artifact.bytecodePath,
            abiPath: artifact.abiPath,
            artifactPath: artifact.artifactPath,
            bytecodeSize: artifact.bytecodeSize,
            toolchain,
            displayName: artifact.target.displayName ?? crate,
            sourcePath: artifact.target.sourcePath,
            contractName: artifact.target.contractName,
            cdmPackage: artifact.target.cdmPackage,
        });
        emit({
            type: "build-done",
            crate,
            durationMs: artifact.durationMs,
            bytecodeSize: artifact.bytecodeSize,
        });
    }

    for (const target of missing) {
        const error = `${toolchain} build did not produce deployable bytecode for ${target.contractName}`;
        build.failed.add(target.name);
        build.info.set(target.name, {
            durationMs: result.durationMs,
            toolchain,
            displayName: target.displayName ?? target.name,
            sourcePath: target.sourcePath,
            contractName: target.contractName,
            cdmPackage: target.cdmPackage,
            error,
        });
        emit({ type: "build-error", crate: target.name, error });
    }
}

function relativeSolidityImport(fromDir: string, toFile: string): string {
    const normalized = relative(fromDir, toFile).replace(/\\/g, "/");
    return normalized.startsWith(".") ? normalized : `./${normalized}`;
}

function writeGeneratedSolidityFile(rootDir: string, generated: { path: string; content: string }) {
    const path = resolve(rootDir, generated.path);
    mkdirSync(dirname(path), { recursive: true });
    if (existsSync(path)) {
        const current = readFileSync(path, "utf-8");
        if (current === generated.content) return;
    }
    writeFileSync(path, generated.content);
}

function writeLocalSolidityBuildImports(rootDir: string, detected: DetectedBuildPipeline): void {
    const targets = [...detected.solidity.foundry, ...detected.solidity.hardhat].filter(
        (target) => target.cdmPackage,
    );

    for (const target of targets) {
        const importPath = solidityImportPathForLibrary(target.cdmPackage!);
        const sourceImportPath = relativeSolidityImport(
            dirname(resolve(rootDir, importPath)),
            target.sourcePath,
        );
        const generated = generateSolidityLocalBuildImport({
            library: target.cdmPackage!,
            contractName: target.contractName,
            sourceImportPath,
        });
        writeGeneratedSolidityFile(rootDir, generated);
    }
}

async function runBuildLayer(
    rootDir: string,
    detected: DetectedBuildPipeline,
    build: BuildPhaseResult,
    layer: string[],
    emit: BuildEmitter,
    features?: string,
    registryAddress?: HexString,
): Promise<string[]> {
    const runnable: string[] = [];
    for (const crate of layer) {
        const contract = detected.contractMap.get(crate);
        const hasFailedDep = contract?.dependsOnCrates.some((dep) => build.failed.has(dep));
        if (hasFailedDep) {
            markSkippedBuild(build, detected, crate, emit);
        } else {
            runnable.push(crate);
        }
    }

    const byToolchain = new Map<ContractToolchain, string[]>();
    for (const crate of runnable) {
        const toolchain = detected.contractMap.get(crate)?.toolchain ?? "rust";
        const list = byToolchain.get(toolchain) ?? [];
        list.push(crate);
        byToolchain.set(toolchain, list);
    }

    const rustCrates = byToolchain.get("rust") ?? [];
    if (rustCrates.length > 0) {
        await buildRustTargets(
            rootDir,
            detected,
            build,
            rustCrates,
            emit,
            features,
            registryAddress,
        );
    }

    for (const toolchain of ["foundry", "hardhat"] as const) {
        const names = byToolchain.get(toolchain) ?? [];
        const targets = names
            .map((name) => detected.contractMap.get(name))
            .filter((target): target is SolidityBuildTarget => target?.toolchain === toolchain);
        await buildSolidityTargets(rootDir, build, toolchain, targets, emit);
    }

    return runnable.filter((crate) => !build.failed.has(crate));
}

async function runDetectedBuild(
    rootDir: string,
    detected: DetectedBuildPipeline,
    emit: BuildEmitter,
    features?: string,
    registryAddress?: HexString,
    onLayerBuilt?: (args: {
        layerIndex: number;
        layer: string[];
        builtCrates: string[];
        build: BuildPhaseResult;
    }) => Promise<void>,
): Promise<{ build: BuildPhaseResult; crates: string[] }> {
    const crates = [...detected.layers.flat()];
    const build: BuildPhaseResult = {
        successful: [],
        failed: new Set<string>(),
        info: new Map(),
    };

    for (let layerIndex = 0; layerIndex < detected.layers.length; layerIndex++) {
        const layer = detected.layers[layerIndex];
        const builtCrates = await runBuildLayer(
            rootDir,
            detected,
            build,
            layer,
            emit,
            features,
            registryAddress,
        );
        await onLayerBuilt?.({ layerIndex, layer, builtCrates, build });
    }

    return { build, crates };
}

function summarizeBuildContracts(
    detected: DetectedBuildPipeline,
    build: BuildPhaseResult,
    crates: string[],
): BuildSummary["contracts"] {
    return crates.map((crate) => {
        const i = build.info.get(crate);
        return {
            crate,
            name: crate,
            displayName: i?.displayName,
            toolchain: i?.toolchain,
            pvmPath: i?.pvmPath,
            abiPath: i?.abiPath,
            artifactPath: i?.artifactPath,
            sourcePath: i?.sourcePath,
            contractName: i?.contractName,
            bytecodeSize: i?.bytecodeSize,
            durationMs: i?.durationMs,
            error: build.failed.has(crate) ? (i?.error ?? "Build failed") : undefined,
            cdmPackage:
                i?.cdmPackage ??
                detected.contracts.find((contract) => contract.name === crate)?.cdmPackage ??
                null,
        };
    });
}

function writeManifestFromBuildSummary(
    rootDir: string,
    contracts: BuildSummary["contracts"],
): string {
    const manifestContracts: CdmBuildManifestContract[] = contracts
        .filter((contract) => !contract.error && contract.pvmPath && contract.toolchain)
        .map((contract) => ({
            name: contract.name ?? contract.crate,
            displayName: contract.displayName,
            toolchain: contract.toolchain as CdmBuildManifestContract["toolchain"],
            cdmPackage: contract.cdmPackage ?? null,
            bytecodePath: contract.pvmPath!,
            abiPath: contract.abiPath,
            artifactPath: contract.artifactPath,
            sourcePath: contract.sourcePath,
            contractName: contract.contractName,
            bytecodeSize: contract.bytecodeSize,
        }));

    return manifestContracts.length > 0
        ? writeBuildManifest(rootDir, manifestContracts)
        : buildManifestPath(rootDir);
}

function buildContractIndexes(
    rootDir: string,
    detected: DetectedBuildPipeline,
    build: BuildPhaseResult,
): { contractMap: Map<string, ContractInfo>; cdmPackageMap: Map<string, string> } {
    const contractMap = new Map<string, ContractInfo>(
        detected.contracts.map((contract) => [contract.name, { ...contract }]),
    );
    const cdmPackageMap = new Map<string, string>();

    for (const contract of contractMap.values()) {
        if (contract.cdmPackage) cdmPackageMap.set(contract.name, contract.cdmPackage);
    }

    for (const [crate, info] of build.info) {
        if (!contractMap.has(crate)) {
            contractMap.set(crate, {
                name: crate,
                displayName: info.displayName,
                toolchain: info.toolchain,
                cdmPackage: info.cdmPackage ?? null,
                description: null,
                authors: [],
                homepage: null,
                repository: null,
                readmePath: null,
                path: info.sourcePath ? dirname(info.sourcePath) : rootDir,
                dependsOnCrates: [],
            });
        }

        if (info.cdmPackage) {
            cdmPackageMap.set(crate, info.cdmPackage);
            const contract = contractMap.get(crate);
            if (contract) contract.cdmPackage = info.cdmPackage;
        }
    }

    return { contractMap, cdmPackageMap };
}

function getBuiltPvmPath(build: BuildPhaseResult, crate: string): string {
    const pvmPath = build.info.get(crate)?.pvmPath;
    if (!pvmPath) throw new Error(`Missing built bytecode for ${crate}`);
    return pvmPath;
}

function getDeployableContract(
    build: BuildPhaseResult,
    contractMap: Map<string, ContractInfo>,
    crate: string,
): DeployableContract | null {
    const info = build.info.get(crate);
    const cdmPackage = info?.cdmPackage ?? contractMap.get(crate)?.cdmPackage;
    if (!cdmPackage) return null;

    return {
        crate,
        cdmPackage,
        pvmPath: getBuiltPvmPath(build, crate),
        abiPath: info?.abiPath,
        contract: contractMap.get(crate) ?? {
            name: crate,
            displayName: info?.displayName,
            toolchain: info?.toolchain,
            cdmPackage,
            description: null,
            authors: [],
            homepage: null,
            repository: null,
            readmePath: null,
            path: info?.sourcePath ? dirname(info.sourcePath) : "",
            dependsOnCrates: [],
        },
    };
}

function readAbiEntries(path: string | undefined): AbiEntry[] {
    if (!path || !existsSync(path)) return [];
    try {
        const parsed = JSON.parse(readFileSync(path, "utf-8")) as unknown;
        if (Array.isArray(parsed)) return parsed as AbiEntry[];
        if (
            parsed &&
            typeof parsed === "object" &&
            "abi" in parsed &&
            Array.isArray((parsed as { abi?: unknown }).abi)
        ) {
            return (parsed as { abi: AbiEntry[] }).abi;
        }
    } catch {
        // ignore — deploy succeeds with empty abi
    }
    return [];
}

function writeSolidityImportForDeployable(
    rootDir: string,
    deployable: DeployableContract,
    address: HexString,
    version: DeploySaltVersion,
): void {
    const generated = generateSolidityImport({
        library: deployable.cdmPackage,
        address,
        abi: readAbiEntries(deployable.abiPath) as SolidityAbiEntry[],
        version: typeof version === "bigint" ? Number(version) : version,
    });
    writeGeneratedSolidityFile(rootDir, generated);
}

async function precomputeDeployAddress(
    api: PipelineChainClient["assetHub"],
    origin: SS58String,
    deployable: DeployableContract,
    version: DeploySaltVersion,
    registryAddress: HexString,
): Promise<HexString> {
    const code = new Uint8Array(readFileSync(deployable.pvmPath));
    const salt = computeDeploySalt(deployable.cdmPackage, version, registryAddress);
    const result = await api.apis.ReviveApi.instantiate(
        origin,
        0n,
        undefined,
        undefined,
        Enum("Upload", code),
        new Uint8Array(0),
        salt,
        { at: "best" },
    );
    if (!result.result.success) {
        throw new Error(`Dry-run failed: ${stringifyBigInt(result.result)}`);
    }
    return result.result.value.addr as HexString;
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
        const detected = detectBuildOrder(opts.rootDir, opts.contracts);
        writeLocalSolidityBuildImports(opts.rootDir, detected);
        emit({ type: "detect", contracts: detected.contracts, layers: detected.layers });
        const { build, crates } = await runDetectedBuild(
            opts.rootDir,
            detected,
            emit as BuildEmitter,
            opts.features,
            opts.registryAddress,
        );
        const contracts = summarizeBuildContracts(detected, build, crates);
        const manifestPath = writeManifestFromBuildSummary(opts.rootDir, contracts);

        const summary: BuildSummary = {
            manifestPath,
            contracts,
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
 * Full pipeline: for each dependency layer, build then deploy/register.
 *
 *  1. Query the next registry version index for each CDM-annotated crate.
 *     That version is included in its CREATE2 salt so repeated publishes get
 *     fresh addresses instead of colliding with previous deployments.
 *  2. Publish metadata to Bulletin (1 tx per CDM crate) AND
 *  3. Deploy + register on AssetHub in one `Utility.batch_all`
 *
 *  2 and 3 run in parallel per layer — CIDs are precomputed locally from the
 *  metadata bytes (`computeCid`) so the on-chain registration extrinsic
 *  doesn't need to wait for the Bulletin publish to finish. The pipeline
 *  verifies the published CIDs match the precomputed values after the fact.
 *
 * Never opens its own chain connections — the `ChainClient` + signer + origin
 * + registry address must be supplied by the caller. Callers that separate
 * Asset Hub authority from Bulletin storage allowance can pass
 * `metadataSigner`; otherwise the deployment signer is reused.
 */
export async function deployContracts(opts: DeployContractsOptions): Promise<DeploySummary> {
    const t0 = Date.now();
    const emit = (e: DeployEvent) => opts.onEvent?.(e);

    // ---- 1. detect + prepare local Solidity imports ----
    const detected = detectBuildOrder(opts.rootDir, opts.contracts);
    writeLocalSolidityBuildImports(opts.rootDir, detected);
    const crates = [...detected.layers.flat()];
    const contracts = detected.contracts;

    // Per-crate running status for the final summary.
    const status = new Map<
        string,
        {
            cdmPackage?: string;
            address?: HexString;
            cid?: string;
            status: "done" | "cached" | "skipped" | "error";
            error?: string;
        }
    >();
    for (const c of crates) status.set(c, { status: "error", error: "pending" });

    try {
        emit({ type: "detect", contracts, layers: detected.layers });

        // ---- 2. wire service classes (implementation details) ----
        const signer = opts.signer;
        const assetHubApi = opts.client.assetHub;
        const assetHubClient = opts.client.raw.assetHub;
        const bulletinApi = opts.client.bulletin;
        const bulletinClient = opts.client.raw.bulletin;

        const deployer = new ContractDeployer(signer, opts.origin, assetHubClient, assetHubApi);
        const publisher = new MetadataPublisher(
            opts.metadataSigner ?? signer,
            bulletinApi,
            bulletinClient,
        );
        emit({
            type: "phase",
            name: "connecting-registry",
            description: "Initializing registry contract handle",
        });
        const registryContract = await createContractFromClient(
            assetHubClient,
            opts.client.descriptors.assetHub,
            opts.registryAddress,
            CONTRACTS_REGISTRY_ABI,
            { defaultSigner: signer, defaultOrigin: opts.origin },
        );

        const build: BuildPhaseResult = {
            successful: [],
            failed: new Set<string>(),
            info: new Map(),
        };
        const nextVersionByCrate = new Map<string, DeploySaltVersion>();
        let { contractMap, cdmPackageMap } = buildContractIndexes(opts.rootDir, detected, build);

        // ---- 3. per-layer build + deploy loop ----
        const failedCrates = new Set<string>();
        const addresses: Record<string, HexString> = {};

        for (let layerIndex = 0; layerIndex < detected.layers.length; layerIndex++) {
            const layer = detected.layers[layerIndex];
            const builtCrates = await runBuildLayer(
                opts.rootDir,
                detected,
                build,
                layer,
                emit as BuildEmitter,
                opts.features,
                opts.registryAddress,
            );
            ({ contractMap, cdmPackageMap } = buildContractIndexes(opts.rootDir, detected, build));

            for (const crate of layer) {
                if (!build.failed.has(crate)) continue;
                const info = build.info.get(crate);
                failedCrates.add(crate);
                status.set(crate, {
                    status: "error",
                    error: info?.error ?? "Build failed",
                    cdmPackage: cdmPackageMap.get(crate),
                });
            }

            const layerDeployable = builtCrates.filter((c) => {
                if (failedCrates.has(c)) return false;
                const contract = contractMap.get(c);
                return !contract?.dependsOnCrates.some((dep) => failedCrates.has(dep));
            });
            if (layerDeployable.length === 0) continue;

            try {
                // Filter out workspace members with no CDM package annotation
                // (e.g., `contract-registry` itself, build-tool crates). They
                // built but aren't part of the registered-contract universe.
                const deployables: DeployableContract[] = [];
                for (const crate of layerDeployable) {
                    const d = getDeployableContract(build, contractMap, crate);
                    if (d) {
                        deployables.push(d);
                    } else {
                        const reason =
                            "no CDM package annotation — won't be deployed or registered";
                        emit({ type: "deploy-skip", crate, reason });
                        status.set(crate, { status: "skipped", error: reason });
                    }
                }
                if (deployables.length === 0) continue;
                const deployableCrates = deployables.map((contract) => contract.crate);
                const deployablePackages = deployables.map((contract) => contract.cdmPackage);

                emit({
                    type: "phase",
                    name: "checking-versions",
                    description: `Checking layer ${layerIndex + 1} registry versions`,
                    layer: layerIndex,
                });
                const versionCounts = await queryRegistryVersionCounts(
                    registryContract,
                    deployablePackages,
                );
                for (const contract of deployables) {
                    const versionCount =
                        nextVersionByCrate.get(contract.crate) ??
                        versionCounts.get(contract.cdmPackage);
                    if (versionCount === undefined) {
                        throw new Error(
                            `Failed to query registry version count for "${contract.cdmPackage}"`,
                        );
                    }
                    nextVersionByCrate.set(contract.crate, versionCount);
                }

                const cidMap: Record<string, string> = {};
                const metadataList: Metadata[] = [];

                emit({
                    type: "phase",
                    name: "preparing-metadata",
                    description: `Assembling metadata for ${deployables.length} contract${deployables.length === 1 ? "" : "s"}`,
                    layer: layerIndex,
                });
                const publishedAt = new Date().toISOString();
                for (const deployable of deployables) {
                    const contract = deployable.contract;
                    const readmeContent = readReadmeContent(contract.readmePath);
                    const repository = contract.repository ?? getGitRemoteUrl(opts.rootDir) ?? "";
                    const abi = readAbiEntries(deployable.abiPath);
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
                    cidMap[deployable.crate] = await computeBulletinStoreCid(
                        new TextEncoder().encode(JSON.stringify(meta)),
                    );
                }

                // Precomputed addresses for emit "check-needs-deploy" — the
                // deploy-register batch computes this internally, but we
                // need it eagerly for the event before signing.
                emit({
                    type: "phase",
                    name: "precomputing-addresses",
                    description: `Dry-running ${deployables.length} contract deploy${deployables.length === 1 ? "" : "s"} for layer ${layerIndex + 1}`,
                    layer: layerIndex,
                });
                for (const deployable of deployables) {
                    try {
                        const version = nextVersionByCrate.get(deployable.crate);
                        if (version === undefined) {
                            throw new Error(
                                `Missing registry version count for "${deployable.cdmPackage}"`,
                            );
                        }
                        const addr = await precomputeDeployAddress(
                            assetHubApi,
                            opts.origin,
                            deployable,
                            version,
                            opts.registryAddress,
                        );
                        emit({
                            type: "check-needs-deploy",
                            crate: deployable.crate,
                            address: addr,
                        });
                    } catch {
                        // best-effort event — swallow
                    }
                }

                // Sign requests fire immediately before submission.
                emit({
                    type: "sign-request",
                    phase: "deploy-register",
                    crates: deployableCrates,
                });
                emit({ type: "sign-request", phase: "publish", crates: deployableCrates });

                emit({
                    type: "phase",
                    name: "deploying",
                    description: "Submitting deploy+register batch",
                    layer: layerIndex,
                });
                emit({ type: "deploy-register-start", crates: deployableCrates });
                emit({
                    type: "phase",
                    name: "publishing",
                    description: "Submitting metadata publish",
                    layer: layerIndex,
                });
                emit({ type: "publish-start", crates: deployableCrates });

                const deployT0 = Date.now();
                const publishT0 = Date.now();
                let deployCursor = 0;

                const pvmPaths = deployables.map((contract) => contract.pvmPath);
                const saltVersions = deployables.map((contract) => {
                    const version = nextVersionByCrate.get(contract.crate);
                    if (version === undefined) {
                        throw new Error(
                            `Missing registry version count for "${contract.cdmPackage}"`,
                        );
                    }
                    return version;
                });
                const metadataUris = deployables.map((contract) => cidMap[contract.crate]);

                // Plan BEFORE submission so we can emit a diagnostic
                // `deploy-plan` event carrying the real budget, per-contract
                // weights, and final chunk layout. Reuses the plan inside the
                // batch call (no duplicate dry-run). At this point Rust,
                // Foundry, and Hardhat contracts are all the same shape.
                const plan = await deployer.planDeploy(
                    pvmPaths,
                    deployablePackages,
                    saltVersions,
                    opts.registryAddress,
                );
                const perContract = plan.prepared.map((prepared, i) => ({
                    crate: deployableCrates[i],
                    gasLimit: {
                        ref_time: prepared.gasLimit.ref_time,
                        proof_size: prepared.gasLimit.proof_size,
                    },
                    extrinsicWeight: {
                        ref_time: prepared.extrinsicWeight.ref_time,
                        proof_size: prepared.extrinsicWeight.proof_size,
                    },
                    storageDeposit: prepared.storageDeposit,
                }));
                emit({
                    type: "deploy-plan",
                    layer: layerIndex,
                    crates: deployableCrates,
                    budget: {
                        ref_time: plan.budget.ref_time,
                        proof_size: plan.budget.proof_size,
                    },
                    perContract,
                    chunks: plan.chunks.map((idxs) => idxs.map((i) => deployableCrates[i])),
                });

                const [deployRes, publishRes] = await Promise.all([
                    deployer.deployAndRegisterBatch(
                        pvmPaths,
                        deployablePackages,
                        registryContract,
                        metadataUris,
                        (chunk) => {
                            // Callback fires in chunk order; the i-th chunk covers
                            // deployables[deployCursor..+len].
                            const addrs: Record<string, HexString> = {};
                            const start = deployCursor;
                            for (let i = 0; i < chunk.addresses.length; i++) {
                                const crate = deployableCrates[start + i];
                                addrs[crate] = chunk.addresses[i] as HexString;
                                addresses[crate] = chunk.addresses[i] as HexString;
                            }
                            deployCursor += chunk.addresses.length;
                            emit({
                                type: "deploy-register-done",
                                addresses: addrs,
                                txHash: chunk.txHash,
                                blockHash: chunk.blockHash,
                                durationMs: Date.now() - deployT0,
                            });
                        },
                        { plan, saltVersions, saltScope: opts.registryAddress },
                    ),
                    publisher.publishBatch(metadataList).then((r) => {
                        // Verify CIDs match precomputation — any drift
                        // indicates a code bug or serialization mismatch.
                        for (let i = 0; i < metadataList.length; i++) {
                            if (r.cids[i] !== cidMap[deployableCrates[i]]) {
                                throw new Error(
                                    `CID mismatch for ${deployableCrates[i]}: expected ${cidMap[deployableCrates[i]]}, got ${r.cids[i]}`,
                                );
                            }
                        }
                        return r;
                    }),
                ]);

                for (let i = 0; i < deployables.length; i++) {
                    const address = deployRes.addresses[i] as HexString;
                    addresses[deployableCrates[i]] = address;
                    writeSolidityImportForDeployable(
                        opts.rootDir,
                        deployables[i],
                        address,
                        saltVersions[i],
                    );
                }

                const cidsOut: Record<string, string> = {};
                for (let i = 0; i < deployables.length; i++) {
                    cidsOut[deployableCrates[i]] = publishRes.cids[i];
                }
                emit({
                    type: "publish-done",
                    cids: cidsOut,
                    txHash: publishRes.txHash,
                    durationMs: Date.now() - publishT0,
                });

                // Mark status
                for (const deployable of deployables) {
                    status.set(deployable.crate, {
                        status: "done",
                        address: addresses[deployable.crate],
                        cid: cidMap[deployable.crate],
                        cdmPackage: deployable.cdmPackage,
                    });
                }
            } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                const affected = layerDeployable.filter((c) => status.get(c)?.status !== "cached");
                for (const crate of affected) {
                    const info = build.info.get(crate);
                    failedCrates.add(crate);
                    build.failed.add(crate);
                    build.info.set(crate, {
                        ...(info ?? {
                            durationMs: 0,
                            cdmPackage: cdmPackageMap.get(crate),
                        }),
                        error: msg,
                    });
                    status.set(crate, {
                        status: "error",
                        error: msg,
                        cdmPackage: cdmPackageMap.get(crate),
                    });
                }
                emit({
                    type: "deploy-register-error",
                    crates: affected,
                    error: msg,
                });
            }
        }

        const buildContractsSummary = summarizeBuildContracts(detected, build, crates);
        writeManifestFromBuildSummary(opts.rootDir, buildContractsSummary);

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
        emit({
            type: "phase",
            name: "done",
            description: "Pipeline complete",
        });
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
            getGitRemoteUrl: vi.fn(() => "https://github.com/test/repo"),
            readReadmeContent: vi.fn(() => ""),
        };
    });

    vi.mock("./cid", () => ({
        computeBulletinStoreCid: vi.fn(async () => "fakeCid123"),
    }));

    vi.mock("@parity/product-sdk-contracts", () => ({
        createContractFromClient: vi.fn(async () => ({
            getVersionCount: {
                query: vi.fn(async () => ({ success: true, value: 0 })),
            },
        })),
    }));

    vi.mock("./deployer", async () => {
        const actual = await vi.importActual<typeof import("./deployer")>("./deployer");
        return {
            ...actual,
            ContractDeployer: vi.fn().mockImplementation(() => ({
                planDeploy: vi.fn(async (pvmPaths: string[]) => ({
                    prepared: pvmPaths.map((_path, index) => ({
                        address: `0x${String(index + 1).padStart(40, "0")}`,
                        gasLimit: { ref_time: 1n, proof_size: 1n },
                        extrinsicWeight: { ref_time: 1n, proof_size: 1n },
                        storageDeposit: 0n,
                    })),
                    budget: { ref_time: 10n, proof_size: 10n },
                    chunks: [pvmPaths.map((_path, index) => index)],
                })),
                deployAndRegisterBatch: vi.fn(
                    async (
                        pvmPaths: string[],
                        _packages: string[],
                        _registry: unknown,
                        _metadataUris: string[],
                        onChunk: (chunk: {
                            addresses: string[];
                            txHash: string;
                            blockHash: string;
                        }) => void,
                    ) => {
                        const addresses = pvmPaths.map(
                            (_path, index) => `0x${String(index + 1).padStart(40, "0")}`,
                        );
                        onChunk({
                            addresses,
                            txHash: "0xdeploy",
                            blockHash: "0xblock",
                        });
                        return { addresses };
                    },
                ),
            })),
        };
    });

    vi.mock("./publisher", () => ({
        MetadataPublisher: vi.fn().mockImplementation(() => ({
            publishBatch: vi.fn(async (metadataList: unknown[]) => ({
                cids: metadataList.map(() => "fakeCid123"),
                txHash: "0xpublish",
            })),
        })),
    }));

    vi.mock("./solidity", () => ({
        buildSolidityToolchain: vi.fn(),
        detectSolidityBuildTargets: vi.fn(() => []),
    }));

    vi.mock("fs", () => ({
        existsSync: vi.fn(() => true),
        mkdirSync: vi.fn(),
        readFileSync: vi.fn(() => Buffer.from("[]")),
        writeFileSync: vi.fn(),
    }));

    const { pvmContractBuildAsync: mockBuild } = await import("./builder");
    const { detectDeploymentOrderLayered: mockDetect } = await import("./detection");
    const {
        buildSolidityToolchain: mockBuildSolidity,
        detectSolidityBuildTargets: mockDetectSolidity,
    } = await import("./solidity");
    const { MetadataPublisher: mockMetadataPublisher } = await import("./publisher");
    const { writeFileSync: mockWriteFileSync } = await import("fs");

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
        (mockDetectSolidity as any).mockReturnValue([]);
        (mockBuildSolidity as any).mockResolvedValue({
            result: { success: true, stdout: "", stderr: "", durationMs: 10 },
            artifacts: [],
            missing: [],
        });
        (mockBuild as any).mockImplementation(async (_root: string, crateName: string) => ({
            crateName,
            success: true,
            stdout: "",
            stderr: "",
            durationMs: 100,
        }));
    });

    function makePolkadotSigner(fill: number): PolkadotSigner {
        return {
            publicKey: new Uint8Array(32).fill(fill),
            signTx: vi.fn(async () => new Uint8Array(65).fill(fill)),
            signBytes: vi.fn(async () => new Uint8Array(64).fill(fill)),
        };
    }

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

        test("rejects duplicate CDM package names", async () => {
            (mockDetect as any).mockReturnValue(
                makeOrder([["a", "b"]], {}, { a: "@example/counter", b: "@example/counter" }),
            );
            await expect(buildContracts({ rootDir: "/fake" })).rejects.toThrow(
                'Duplicate CDM package "@example/counter"',
            );
        });

        test("features option is forwarded to pvmContractBuildAsync", async () => {
            (mockDetect as any).mockReturnValue(makeOrder([["a"]]));
            await buildContracts({ rootDir: "/fake", features: "my-feature" });
            expect(mockBuild).toHaveBeenCalledWith(
                "/fake",
                "a",
                expect.any(Function),
                "my-feature",
                undefined,
            );
        });

        test("features is undefined when not provided", async () => {
            (mockDetect as any).mockReturnValue(makeOrder([["a"]]));
            await buildContracts({ rootDir: "/fake" });
            expect(mockBuild).toHaveBeenCalledWith(
                "/fake",
                "a",
                expect.any(Function),
                undefined,
                undefined,
            );
        });

        test("overwrites local Solidity imports with build stubs before compiling Solidity targets", async () => {
            (mockDetect as any).mockReturnValue(makeOrder([]));
            (mockDetectSolidity as any).mockReturnValue([
                {
                    name: "@example/counter-a",
                    displayName: "@example/counter-a",
                    toolchain: "foundry",
                    cdmPackage: "@example/counter-a",
                    description: null,
                    authors: [],
                    homepage: null,
                    repository: null,
                    readmePath: null,
                    path: "/fake/contracts",
                    dependsOnCrates: [],
                    sourcePath: "/fake/contracts/CounterA.sol",
                    contractName: "CounterA",
                },
            ]);
            (mockBuildSolidity as any).mockResolvedValue({
                result: { success: true, stdout: "", stderr: "", durationMs: 10 },
                artifacts: [
                    {
                        target: {
                            name: "@example/counter-a",
                            displayName: "@example/counter-a",
                            toolchain: "foundry",
                            cdmPackage: "@example/counter-a",
                            sourcePath: "/fake/contracts/CounterA.sol",
                            contractName: "CounterA",
                        },
                        bytecodePath: "/fake/target/cdm/foundry/counter-a.polkavm",
                        artifactPath: "/fake/out/CounterA.sol/CounterA.json",
                        abiPath: "/fake/out/CounterA.sol/CounterA.json",
                        bytecodeSize: 42,
                        durationMs: 10,
                    },
                ],
                missing: [],
            });

            await buildContracts({ rootDir: "/fake" });

            expect(mockWriteFileSync).toHaveBeenCalledWith(
                "/fake/.cdm/solidity/example/counter-a.sol",
                expect.stringContaining('import "../../../contracts/CounterA.sol";'),
            );
            expect(mockBuildSolidity).toHaveBeenCalledWith(
                "/fake",
                "foundry",
                expect.any(Array),
                expect.any(Object),
            );
        });
    });

    describe("deployContracts", () => {
        test("deploys each layer before building its dependents", async () => {
            (mockDetect as any).mockReturnValue(
                makeOrder([["a"], ["b"]], { b: ["a"] }, { a: "@example/a", b: "@example/b" }),
            );

            const events: string[] = [];
            const deploySigner = makePolkadotSigner(1);
            const metadataSigner = makePolkadotSigner(2);
            await deployContracts({
                rootDir: "/fake",
                client: {
                    assetHub: {
                        apis: {
                            ReviveApi: {
                                instantiate: vi.fn(async () => ({
                                    result: {
                                        success: true,
                                        value: {
                                            addr: "0x0000000000000000000000000000000000000001",
                                        },
                                    },
                                })),
                            },
                        },
                    },
                    bulletin: {},
                    raw: { assetHub: {}, bulletin: {} },
                    descriptors: { assetHub: {} },
                } as any,
                signer: deploySigner,
                origin: "5GrwvaEF5zXb26Fz9rcQpDWSJm8VAz5tK7gU3QF8JKpt5M7" as SS58String,
                registryAddress: "0xa7ae171c78f06c248a9b2556c793aa1df5c9173a",
                metadataSigner,
                onEvent: (event) => {
                    if (event.type === "build-start") events.push(`build-start:${event.crate}`);
                    if (event.type === "deploy-register-start") {
                        events.push(`deploy-start:${event.crates.join(",")}`);
                    }
                    if (event.type === "deploy-register-done") {
                        events.push(`deploy-done:${Object.keys(event.addresses).join(",")}`);
                    }
                },
            });

            expect(events.indexOf("deploy-done:a")).toBeLessThan(events.indexOf("build-start:b"));
            expect(mockMetadataPublisher).toHaveBeenCalledWith(
                metadataSigner,
                expect.anything(),
                expect.anything(),
            );
        });
    });
}
