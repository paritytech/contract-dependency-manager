import { Binary, Enum, type PolkadotClient, type SizedHex } from "polkadot-api";
import { readFileSync } from "fs";
import { prepareSigner, type CdmDeployAssetHubApi } from "@parity/cdm-env";
import { stringifyBigInt, STORAGE_DEPOSIT_LIMIT, GAS_LIMIT } from "@parity/cdm-utils";
import { blake2b } from "@noble/hashes/blake2.js";
import {
    submitAndWatch,
    batchSubmitAndWatch,
    applyWeightBuffer,
    type SubmittableTransaction,
} from "@parity/product-sdk-tx";
import type { Contract, ContractDef } from "@parity/product-sdk-contracts";

/**
 * Registry version index used to make CREATE2 salts unique across publishes
 * of the same CDM package.
 */
export type DeploySaltVersion = number | bigint;

/**
 * Compute a deterministic 32-byte CREATE2 salt from a CDM package name, the
 * registry version index this deployment will publish, and optionally the
 * registry address the deployment is being published into.
 *
 * With no version this preserves the original package-only salt, which keeps
 * existing callers such as the universal ContractRegistry deployment stable.
 * CDM package deployments should pass the next registry version index so each
 * publish derives a fresh address even if the deployer and bytecode repeat.
 * Passing `registryAddress` additionally scopes version numbers to a specific
 * registry generation, so a fresh registry can republish version 0 packages on
 * a chain that already has older CDM deployments.
 */
export function computeDeploySalt(
    cdmPackage: string,
    version?: DeploySaltVersion,
    registryAddress?: string,
): SizedHex<32> {
    const material =
        registryAddress === undefined
            ? version === undefined
                ? cdmPackage
                : JSON.stringify([cdmPackage, version.toString()])
            : JSON.stringify([
                  registryAddress.toLowerCase(),
                  cdmPackage,
                  version?.toString() ?? "",
              ]);
    const hash = blake2b(new TextEncoder().encode(material), { dkLen: 32 });
    return Binary.toHex(hash) as SizedHex<32>;
}

export interface WeightLike {
    ref_time: bigint;
    proof_size: bigint;
}

/**
 * Static per-call weight that the `Revive.instantiate_with_code` dispatchable
 * declares in addition to whatever execution weight its inner constructor
 * uses. The dispatchable's declared weight function includes the code upload,
 * PolkaVM validation, and account creation costs — all roughly constant per
 * call — on top of the `weight_limit` argument we pass. The dry-run's
 * `weight_required` reports ONLY the execution component, so the chunker
 * would wildly under-predict the real extrinsic weight without this constant
 * folded in (observed ratio ≈ 700× on a typical 50KB contract).
 *
 * Values are empirically calibrated against Paseo AssetHub runtime v2001000
 * where `System.BlockWeights.per_class.normal.max_extrinsic.ref_time` =
 * 1.6×10¹² and a 4-call `batch_all` rejects but a 3-call batch accepts.
 * Setting ref_time ≈ budget/3 gives the chunker floor(1.6/0.53) = 3
 * contracts per chunk, matching observed behavior.
 *
 * Re-verify after AssetHub runtime upgrades. If a deploy hits
 * ExhaustsResources for ≤3 contracts, this constant is likely stale.
 */
export const INSTANTIATE_WITH_CODE_STATIC_WEIGHT: WeightLike = {
    ref_time: 530_000_000_000n,
    proof_size: 1_000_000n,
};

/**
 * Output of {@link ContractDeployer.planDeploy}. Exposes everything the
 * pipeline needs to emit a `deploy-plan` diagnostic event BEFORE submission,
 * and everything `deployBatch` / `deployAndRegisterBatch` need to skip
 * re-running the dry-run when the plan is passed back in.
 *
 * `prepared[i].tx` is the fully-formed (unsigned) `Revive.instantiate_with_code`
 * call with the gas / storage limits already applied.
 */
export interface DeployPlan {
    budget: WeightLike;
    prepared: Array<{
        tx: ReturnType<CdmDeployAssetHubApi["tx"]["Revive"]["instantiate_with_code"]>;
        /** Execution-only weight limit passed to the extrinsic. */
        gasLimit: WeightLike;
        /**
         * Full declared weight the dispatchable will assert at submission —
         * `gasLimit + INSTANTIATE_WITH_CODE_STATIC_WEIGHT`. This is what
         * block validation checks against `max_extrinsic` and what the
         * chunker sums against the budget.
         */
        extrinsicWeight: WeightLike;
        storageDeposit: bigint;
        address: string;
    }>;
    /** Index groups into `prepared` — each inner array is one on-chain chunk. */
    chunks: number[][];
}

/**
 * Greedy weight-aware chunker. Given a list of per-item weights and a budget,
 * returns a list of chunks (index arrays) whose cumulative weight stays within
 * the budget on both dimensions. A single oversized item becomes its own
 * chunk (it will fail with a clearer on-chain error than the chunker itself
 * could provide). Input order is preserved.
 */
export function chunkByWeight(weights: ReadonlyArray<WeightLike>, budget: WeightLike): number[][] {
    if (weights.length === 0) return [];
    const chunks: number[][] = [];
    let current: number[] = [];
    let curRef = 0n;
    let curProof = 0n;
    for (let i = 0; i < weights.length; i++) {
        const w = weights[i];
        const nextRef = curRef + w.ref_time;
        const nextProof = curProof + w.proof_size;
        const fitsWeight = nextRef <= budget.ref_time && nextProof <= budget.proof_size;
        // An empty `current` always takes the item (guarantees forward
        // progress; oversized singletons become their own chunk and fail
        // with a clearer on-chain error).
        if (current.length === 0 || fitsWeight) {
            current.push(i);
            curRef = nextRef;
            curProof = nextProof;
        } else {
            chunks.push(current);
            current = [i];
            curRef = w.ref_time;
            curProof = w.proof_size;
        }
    }
    if (current.length > 0) chunks.push(current);
    return chunks;
}

export interface AbiParam {
    name: string;
    type: string;
    components?: AbiParam[];
}

export interface AbiEntry {
    type: string;
    name?: string;
    inputs: AbiParam[];
    outputs?: AbiParam[];
    stateMutability?: string;
    anonymous?: boolean;
}

export interface Metadata {
    publish_block: number;
    published_at: string;
    description: string;
    readme: string;
    authors: string[];
    homepage: string;
    repository: string;
    abi: AbiEntry[];
}

/**
 * Thin wrapper around `Revive.instantiate_with_code` that uses
 * `@parity/product-sdk-tx` for submission lifecycle management (retries/timeouts,
 * best-block vs. finalized gating, onStatus hooks) and `applyWeightBuffer` for
 * weight scaling.
 *
 * Kept as a class with the original surface so downstream callers
 * (deploy-pipeline.ts) don't need to change in this migration step.
 * Later steps will collapse the orchestration into free functions.
 *
 * `dryRunDeploy` still uses `ReviveApi.instantiate` directly — that runtime
 * API is the correct primitive for weight/storage estimation of a raw code
 * upload (`extractTransaction` from `@parity/product-sdk-tx` targets ink-SDK-shaped
 * dry-run results, which is a different path).
 */
export class ContractDeployer {
    public signer: ReturnType<typeof prepareSigner>;
    public origin: string;
    public api: CdmDeployAssetHubApi;
    public client: PolkadotClient;

    constructor(
        signer: ReturnType<typeof prepareSigner>,
        origin: string,
        client: PolkadotClient,
        api: CdmDeployAssetHubApi,
    ) {
        this.signer = signer;
        this.origin = origin;
        this.client = client;
        this.api = api;
    }

    /**
     * Deploy a PVM contract and return its address.
     * Uses a dry-run to estimate gas, then submits with the estimated values.
     * When cdmPackage is provided, uses CREATE2 (deterministic address via salt).
     */
    async deploy(
        pvmPath: string,
        cdmPackage?: string,
        saltVersion?: DeploySaltVersion,
        saltScope?: string,
    ): Promise<{ address: string; txHash: string; blockHash: string }> {
        const { tx } = await this.dryRunDeploy(pvmPath, cdmPackage, saltVersion, saltScope);

        const result = await submitAndWatch(tx as unknown as SubmittableTransaction, this.signer, {
            waitFor: "best-block",
        });
        if (!result.ok) {
            throw new Error(`[AssetHub deploy] ${result.error.message}`, { cause: result.error });
        }

        const instantiated = this.api.event.Revive.Instantiated.filter(
            result.value.events as Parameters<typeof this.api.event.Revive.Instantiated.filter>[0],
        );
        if (instantiated.length === 0) {
            throw new Error(
                "[AssetHub deploy] Contract instantiation failed - no Instantiated event",
            );
        }

        const address = instantiated[0].payload.contract;
        return { address, txHash: result.value.txHash, blockHash: result.value.block.hash };
    }

    /**
     * Dry-run a contract deploy to estimate gas/storage, returning the
     * transaction descriptor (unsigned), bytecode info for later batching, and
     * the dry-run-computed contract address (CREATE2-derived when
     * `cdmPackage` is provided; otherwise the pallet's default non-CREATE2
     * scheme — that address is still valid for deploy bookkeeping even if it
     * isn't deterministic cross-chain).
     *
     * Returning `address` here eliminates the redundant second
     * `ReviveApi.instantiate` round-trip that `deployAndRegisterBatch` used
     * to perform purely to recover the CREATE2 address.
     */
    async dryRunDeploy(
        pvmPath: string,
        cdmPackage?: string,
        saltVersion?: DeploySaltVersion,
        saltScope?: string,
    ) {
        const code = new Uint8Array(readFileSync(pvmPath));
        const data = new Uint8Array(0);
        const salt = cdmPackage ? computeDeploySalt(cdmPackage, saltVersion, saltScope) : undefined;
        const dryRun = await this.api.apis.ReviveApi.instantiate(
            this.origin,
            0n,
            undefined,
            undefined,
            Enum("Upload", code),
            data,
            salt,
            { at: "best" },
        );

        if (dryRun.result.success === false) {
            throw new Error(`Dry-run failed: ${stringifyBigInt(dryRun.result)}`);
        }

        // 20% headroom — matches the pre-migration behavior (`applyWeightBuffer`
        // defaults to 25% so pass `percent: 20` to preserve exact semantics).
        const gasLimit = applyWeightBuffer(dryRun.weight_required, { percent: 20 });

        let storageDeposit = STORAGE_DEPOSIT_LIMIT;
        if (dryRun.storage_deposit.type === "Charge") {
            storageDeposit = (dryRun.storage_deposit.value * 120n) / 100n;
        }

        const address = dryRun.result.value.addr;

        // The dispatchable's declared weight at submission time ≈
        // dry-run execution weight + pallet-declared static weight. This is
        // what block validation checks against `max_extrinsic`. See the
        // INSTANTIATE_WITH_CODE_STATIC_WEIGHT doc for why the static term
        // has to be added by hand.
        const extrinsicWeight: WeightLike = {
            ref_time: gasLimit.ref_time + INSTANTIATE_WITH_CODE_STATIC_WEIGHT.ref_time,
            proof_size: gasLimit.proof_size + INSTANTIATE_WITH_CODE_STATIC_WEIGHT.proof_size,
        };

        return {
            tx: this.api.tx.Revive.instantiate_with_code({
                value: 0n,
                weight_limit: gasLimit,
                storage_deposit_limit: storageDeposit,
                code,
                data,
                salt,
            }),
            gasLimit,
            storageDeposit,
            address,
            extrinsicWeight,
        };
    }

    /**
     * Fetch the original uploaded bytecode for the contract at the given address.
     * Uses ContractInfoOf → PristineCode to get the exact bytes that were deployed,
     * avoiding any runtime transformation the pallet applies to stored code.
     * Returns null if no contract exists or the query fails.
     */
    async getOnChainCode(address: string): Promise<Uint8Array | null> {
        try {
            const addr = address as SizedHex<20>;
            const info = await this.api.query.Revive.AccountInfoOf.getValue(addr);
            if (!info || info.account_type.type !== "Contract") return null;
            const codeHash = info.account_type.value.code_hash;
            const pristine = await this.api.query.Revive.PristineCode.getValue(codeHash);
            if (!pristine) return null;
            return pristine;
        } catch {
            return null;
        }
    }

    /**
     * Resolve the per-extrinsic weight budget used for weight-aware chunking.
     * Reads `System.BlockWeights().per_class.normal.max_extrinsic` from the
     * runtime and returns it verbatim — no safety factor. The per-item
     * weight fed into the chunker already includes the dispatchable's
     * declared static overhead (see `INSTANTIATE_WITH_CODE_STATIC_WEIGHT`),
     * so the budget and the accumulated weight use the same scale.
     */
    private async resolveChunkBudget(): Promise<WeightLike> {
        const weights = await this.api.constants.System.BlockWeights();
        const maxExtrinsic = weights?.per_class?.normal?.max_extrinsic;
        if (
            !maxExtrinsic ||
            typeof maxExtrinsic.ref_time !== "bigint" ||
            typeof maxExtrinsic.proof_size !== "bigint"
        ) {
            throw new Error(
                "Runtime does not expose System.BlockWeights.per_class.normal.max_extrinsic — " +
                    "cannot determine chunk budget.",
            );
        }
        return { ref_time: maxExtrinsic.ref_time, proof_size: maxExtrinsic.proof_size };
    }

    /**
     * Pre-compute the dry-run + chunking decisions for a set of contracts
     * WITHOUT submitting anything on-chain. Returns the budget used, per-item
     * weights / addresses / storage deposits, the unsigned txs (so callers can
     * pass the plan back into `deployBatch` / `deployAndRegisterBatch` to
     * avoid re-doing the dry-run), and the chunk index groups.
     *
     * Callers that need to inspect the plan (e.g. the pipeline's
     * `deploy-plan` diagnostic event) should call this, inspect the returned
     * fields, then forward the plan to `deployBatch` / `deployAndRegisterBatch`
     * via the optional `plan` arg so the dry-run work isn't duplicated.
     */
    async planDeploy(
        pvmPaths: string[],
        cdmPackages?: (string | undefined)[],
        saltVersions?: (DeploySaltVersion | undefined)[],
        saltScope?: string,
    ): Promise<DeployPlan> {
        const prepared = await Promise.all(
            pvmPaths.map((p, i) =>
                this.dryRunDeploy(p, cdmPackages?.[i], saltVersions?.[i], saltScope),
            ),
        );
        const budget = await this.resolveChunkBudget();
        const chunks = chunkByWeight(
            prepared.map((p) => p.extrinsicWeight),
            budget,
        );
        return { budget, prepared, chunks };
    }

    /**
     * Deploy multiple contracts, weight-aware-chunking them into one or more
     * `Utility.batch_all` transactions. Each chunk stays atomic (the whole
     * chunk reverts on any failure inside it); multiple chunks submit
     * sequentially.
     *
     * Returns addresses in the same order as the input paths, plus the number
     * of chunks submitted. When `onChunk` is provided, it's called
     * synchronously after each chunk lands, with the chunk's crate names,
     * addresses, and tx/block hashes.
     *
     * NOTE: Cross-chunk atomicity is lost — if chunk 1 lands and chunk 2
     * fails, chunk 1's deploys stay on-chain. Callers must treat each chunk's
     * result as independent.
     */
    async deployBatch(
        pvmPaths: string[],
        cdmPackages?: (string | undefined)[],
        onChunk?: (result: {
            crates: (string | undefined)[];
            addresses: string[];
            txHash: string;
            blockHash: string;
            chunkIndex: number;
            totalChunks: number;
        }) => void,
        opts?: {
            plan?: DeployPlan;
            saltVersions?: (DeploySaltVersion | undefined)[];
            saltScope?: string;
        },
    ): Promise<{ addresses: string[]; chunkCount: number }> {
        if (pvmPaths.length === 0) return { addresses: [], chunkCount: 0 };

        // 1. Dry-run all contracts up front so we have weights + CREATE2-style
        //    addresses for the chunker — unless a precomputed plan was passed in.
        // 2. Chunk by cumulative declared weight (already done inside the plan).
        const plan =
            opts?.plan ??
            (await this.planDeploy(pvmPaths, cdmPackages, opts?.saltVersions, opts?.saltScope));
        const { prepared, chunks } = plan;

        const addresses: string[] = new Array(pvmPaths.length);

        // 3. Submit each chunk sequentially.
        for (let ci = 0; ci < chunks.length; ci++) {
            const idxs = chunks[ci];
            const label = `[AssetHub deploy chunk ${ci + 1}/${chunks.length}]`;

            // Fast path: a single-item chunk via the non-batch path — matches
            // the pre-chunking one-contract behavior so a user deploying one
            // contract doesn't pay the Utility.batch_all overhead.
            let chunkResult: { txHash: string; blockHash: string; addrs: string[] };
            if (idxs.length === 1) {
                const i = idxs[0];
                const r = await this.deploy(
                    pvmPaths[i],
                    cdmPackages?.[i],
                    opts?.saltVersions?.[i],
                    opts?.saltScope,
                );
                addresses[i] = r.address;
                chunkResult = { txHash: r.txHash, blockHash: r.blockHash, addrs: [r.address] };
            } else {
                const result = await batchSubmitAndWatch(
                    idxs.map((i) => prepared[i].tx),
                    this.api,
                    this.signer,
                    { mode: "batch_all", waitFor: "best-block" },
                );
                if (!result.ok) {
                    throw new Error(`${label} Batch deploy failed: ${result.error.message}`, {
                        cause: result.error,
                    });
                }
                const instantiated = this.api.event.Revive.Instantiated.filter(
                    result.value.events as Parameters<
                        typeof this.api.event.Revive.Instantiated.filter
                    >[0],
                );
                if (instantiated.length !== idxs.length) {
                    throw new Error(
                        `${label} Expected ${idxs.length} Instantiated events, got ${instantiated.length}`,
                    );
                }
                const chunkAddrs = instantiated.map(
                    (e: ReturnType<typeof this.api.event.Revive.Instantiated.filter>[number]) =>
                        e.payload.contract,
                );
                for (let j = 0; j < idxs.length; j++) {
                    addresses[idxs[j]] = chunkAddrs[j];
                }
                chunkResult = {
                    txHash: result.value.txHash,
                    blockHash: result.value.block.hash,
                    addrs: chunkAddrs,
                };
            }

            if (onChunk) {
                onChunk({
                    crates: idxs.map((i) => cdmPackages?.[i]),
                    addresses: idxs.map((i) => addresses[i]),
                    txHash: chunkResult.txHash,
                    blockHash: chunkResult.blockHash,
                    chunkIndex: ci,
                    totalChunks: chunks.length,
                });
            }
        }

        return { addresses, chunkCount: chunks.length };
    }

    /**
     * Deploy N contracts AND register each in the on-chain `ContractRegistry`,
     * weight-aware-chunking them into one or more `Utility.batch_all`
     * transactions on AssetHub. Within a chunk, all (deploys + registers)
     * land atomically; across chunks, earlier chunks' successful submissions
     * stand even if a later chunk fails.
     *
     * CREATE2 lets us precompute contract addresses from `(deployer, salt, code)`
     * before the extrinsic lands, so the register calls can be built ahead of
     * time even though the deploys haven't executed yet.
     *
     * Metadata is assumed to be address-independent (CDM metadata depends only
     * on the compiled artifact: ABI + readme + package info), so the caller is
     * expected to have published metadata to Bulletin first and pass the
     * resulting CIDs in `metadataUris`. That ordering constraint stays in the
     * caller (deploy-pipeline) for this migration step.
     *
     * IMPORTANT — cross-chunk non-atomicity: if a layer is too heavy to fit
     * in one extrinsic we split it. A failed later chunk won't roll back
     * already-landed earlier chunks. Callers should treat each `onChunk`
     * callback as an independent commit point.
     *
     * Register-call weight is tiny (<1% of a normal-extrinsic budget per call)
     * and is not accounted for in the chunker — the chunker only uses the
     * dry-run-measured deploy weights. This is deliberate: deploy weight
     * dominates, so it's a fine approximation.
     *
     * @param pvmPaths - filesystem paths to compiled `.polkavm` bytecode, one per contract.
     * @param cdmPackages - CDM package name per contract — required because both CREATE2
     *   salt derivation and `registry.publishLatest.contract_name` need it.
     * @param registry - A product-sdk-contracts `Contract` handle for the on-chain
     *   `ContractRegistry`. Used to `.prepare(...)` the `publishLatest(...)`
     *   calls that get batched alongside the deploys.
     * @param metadataUris - CIDs from a prior Bulletin publish, one per contract (same order
     *   as `pvmPaths` / `cdmPackages`). Pass `""` for crates without metadata.
     * @param onChunk - Called synchronously after each chunk's submission
     *   resolves, with that chunk's crates (cdmPackages), addresses (input
     *   order within the chunk), tx/block hashes, and chunk index.
     * @returns Deployed addresses in input order, plus the number of chunks
     *   submitted.
     */
    async deployAndRegisterBatch(
        pvmPaths: string[],
        cdmPackages: string[],
        registry: Contract<ContractDef>,
        metadataUris: string[],
        onChunk?: (result: {
            crates: string[];
            addresses: string[];
            txHash: string;
            blockHash: string;
            chunkIndex: number;
            totalChunks: number;
        }) => void,
        opts?: { plan?: DeployPlan; saltVersions?: DeploySaltVersion[]; saltScope?: string },
    ): Promise<{ addresses: string[]; chunkCount: number }> {
        if (pvmPaths.length === 0) return { addresses: [], chunkCount: 0 };
        if (pvmPaths.length !== cdmPackages.length || pvmPaths.length !== metadataUris.length) {
            throw new Error(
                `deployAndRegisterBatch: length mismatch — pvmPaths=${pvmPaths.length}, cdmPackages=${cdmPackages.length}, metadataUris=${metadataUris.length}`,
            );
        }

        // 1. Dry-run + chunk (or reuse a caller-supplied plan).
        const plan =
            opts?.plan ??
            (await this.planDeploy(pvmPaths, cdmPackages, opts?.saltVersions, opts?.saltScope));
        const { prepared, chunks } = plan;

        // 2. Build the `publishLatest` BatchableCalls via product-sdk
        //    `.prepare(...)` using the precomputed CREATE2 address + CID.
        const prepareOpts = {
            gasLimit: { ref_time: GAS_LIMIT.refTime, proof_size: GAS_LIMIT.proofSize },
            storageDepositLimit: STORAGE_DEPOSIT_LIMIT,
        };
        const preparedRegisterCalls = await Promise.all(
            cdmPackages.map((pkg, i) =>
                registry.publishLatest.prepare(pkg, prepared[i].address, metadataUris[i], {
                    origin: this.origin,
                    ...prepareOpts,
                }),
            ),
        );
        const registerCalls = preparedRegisterCalls.map((r, i) => {
            if (!r.ok) {
                throw new Error(
                    `[AssetHub deploy+register] Failed to prepare publishLatest for ${cdmPackages[i]}: ${r.error.message}`,
                    { cause: r.error },
                );
            }
            return r.value;
        });

        const addresses: string[] = new Array(pvmPaths.length);

        // 3. Submit each chunk sequentially as an atomic batch_all of
        //    (chunk's deploys) + (chunk's registers).
        for (let ci = 0; ci < chunks.length; ci++) {
            const idxs = chunks[ci];
            const label = `[AssetHub deploy+register chunk ${ci + 1}/${chunks.length}]`;
            const chunkCalls = [
                ...idxs.map((i) => prepared[i].tx),
                ...idxs.map((i) => registerCalls[i]),
            ];

            const result = await batchSubmitAndWatch(chunkCalls, this.api, this.signer, {
                mode: "batch_all",
                waitFor: "best-block",
            });
            if (!result.ok) {
                throw new Error(`${label} Batch deploy+register failed: ${result.error.message}`, {
                    cause: result.error,
                });
            }

            // Verify on-chain Instantiated events match our precomputed
            // addresses (sanity check — CREATE2 is deterministic, so any
            // mismatch indicates a bug or chain version skew).
            const instantiated = this.api.event.Revive.Instantiated.filter(
                result.value.events as Parameters<
                    typeof this.api.event.Revive.Instantiated.filter
                >[0],
            );
            if (instantiated.length !== idxs.length) {
                throw new Error(
                    `${label} Expected ${idxs.length} Instantiated events, got ${instantiated.length}`,
                );
            }
            const chunkAddrs = instantiated.map(
                (e: ReturnType<typeof this.api.event.Revive.Instantiated.filter>[number]) =>
                    e.payload.contract,
            );
            for (let j = 0; j < idxs.length; j++) {
                const expected = prepared[idxs[j]].address;
                if (chunkAddrs[j].toLowerCase() !== expected.toLowerCase()) {
                    throw new Error(
                        `${label} Address mismatch for ${cdmPackages[idxs[j]]}: precomputed ${expected}, on-chain ${chunkAddrs[j]}`,
                    );
                }
                addresses[idxs[j]] = chunkAddrs[j];
            }

            if (onChunk) {
                onChunk({
                    crates: idxs.map((i) => cdmPackages[i]),
                    addresses: idxs.map((i) => addresses[i]),
                    txHash: result.value.txHash,
                    blockHash: result.value.block.hash,
                    chunkIndex: ci,
                    totalChunks: chunks.length,
                });
            }
        }

        return { addresses, chunkCount: chunks.length };
    }
}

if (import.meta.vitest) {
    const { describe, test, expect } = import.meta.vitest;

    describe("computeDeploySalt", () => {
        test("preserves package-only salt when version is omitted", () => {
            expect(computeDeploySalt("@cdm/example")).toBe(
                computeDeploySalt("@cdm/example", undefined),
            );
        });

        test("includes registry version when provided", () => {
            const unversioned = computeDeploySalt("@cdm/example");
            const version0 = computeDeploySalt("@cdm/example", 0);
            const version1 = computeDeploySalt("@cdm/example", 1);

            expect(version0).not.toBe(unversioned);
            expect(version1).not.toBe(version0);
            expect(computeDeploySalt("@cdm/example", 1n)).toBe(version1);
        });

        test("scopes salts by registry address when provided", () => {
            const v0OldRegistry = computeDeploySalt(
                "@cdm/example",
                0,
                "0x1111111111111111111111111111111111111111",
            );
            const v0NewRegistry = computeDeploySalt(
                "@cdm/example",
                0,
                "0x2222222222222222222222222222222222222222",
            );

            expect(v0NewRegistry).not.toBe(v0OldRegistry);
            expect(
                computeDeploySalt("@cdm/example", 0, "0x2222222222222222222222222222222222222222"),
            ).toBe(v0NewRegistry);
        });
    });

    describe("chunkByWeight", () => {
        const budget: WeightLike = { ref_time: 1000n, proof_size: 1000n };

        test("empty input returns empty", () => {
            expect(chunkByWeight([], budget)).toEqual([]);
        });

        test("three items at 0.4x budget pack as [[0,1],[2]]", () => {
            const w: WeightLike = { ref_time: 400n, proof_size: 400n };
            expect(chunkByWeight([w, w, w], budget)).toEqual([[0, 1], [2]]);
        });

        test("single oversized item gets its own single-item chunk", () => {
            const w: WeightLike = { ref_time: 1200n, proof_size: 1200n };
            expect(chunkByWeight([w], budget)).toEqual([[0]]);
        });

        test("mixed sizes respect both dimensions", () => {
            // ref_time fits but proof_size would overflow
            const a: WeightLike = { ref_time: 100n, proof_size: 900n };
            const b: WeightLike = { ref_time: 100n, proof_size: 200n };
            expect(chunkByWeight([a, b], budget)).toEqual([[0], [1]]);
        });

        test("preserves input order across chunks", () => {
            const big: WeightLike = { ref_time: 1200n, proof_size: 100n };
            const small: WeightLike = { ref_time: 100n, proof_size: 100n };
            expect(chunkByWeight([small, big, small], budget)).toEqual([[0], [1], [2]]);
        });

        test("packs as many as the budget allows", () => {
            // Budget is effectively unlimited — chunker should pack everything
            // into a single chunk in input order.
            const small: WeightLike = { ref_time: 1n, proof_size: 1n };
            const hugeBudget: WeightLike = {
                ref_time: 1_000_000_000_000n,
                proof_size: 1_000_000_000_000n,
            };
            expect(chunkByWeight([small, small, small, small], hugeBudget)).toEqual([[0, 1, 2, 3]]);
        });
    });
}
