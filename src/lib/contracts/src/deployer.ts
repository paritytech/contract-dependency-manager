import { PolkadotClient, TypedApi, Binary, Enum, FixedSizeBinary } from "polkadot-api";
import { AssetHub } from "@dotdm/descriptors";
import { readFileSync } from "fs";
import { prepareSigner } from "@dotdm/env";
import { stringifyBigInt, STORAGE_DEPOSIT_LIMIT, GAS_LIMIT } from "@dotdm/utils";
import { blake2b } from "@noble/hashes/blake2.js";
import {
    submitAndWatch,
    batchSubmitAndWatch,
    applyWeightBuffer,
    type BatchApi,
    type SubmittableTransaction,
} from "@polkadot-apps/tx";
import type { Contract, ContractDef } from "@polkadot-apps/contracts";

/**
 * Compute a deterministic 32-byte CREATE2 salt from a CDM package name.
 * Using CREATE2 ensures the same contract gets the same address on every chain
 * (given the same deployer, salt, and bytecode).
 */
export function computeDeploySalt(cdmPackage: string): FixedSizeBinary<32> {
    const hash = blake2b(new TextEncoder().encode(cdmPackage), { dkLen: 32 });
    return FixedSizeBinary.fromBytes(hash) as FixedSizeBinary<32>;
}

/**
 * Fallback per-extrinsic weight budget used when the runtime doesn't expose
 * `System.BlockWeights().per_class.normal.max_extrinsic` (or it's `undefined`).
 * Ballparked against Paseo AssetHub normal-extrinsic limits; deliberately
 * conservative.
 */
export const FALLBACK_MAX_EXTRINSIC_WEIGHT = {
    ref_time: 1_500_000_000_000n,
    proof_size: 3_500_000n,
} as const;

/** Safety factor applied to the chosen per-extrinsic budget before chunking. */
export const WEIGHT_BUDGET_SAFETY_FACTOR = 85n; // percent, i.e. 0.85

export interface WeightLike {
    ref_time: bigint;
    proof_size: bigint;
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
        const fits = nextRef <= budget.ref_time && nextProof <= budget.proof_size;
        if (current.length === 0 || fits) {
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
 * `@polkadot-apps/tx` for submission lifecycle management (retries/timeouts,
 * best-block vs. finalized gating, onStatus hooks) and `applyWeightBuffer` for
 * weight scaling.
 *
 * Kept as a class with the original surface so downstream callers
 * (deploy-pipeline.ts) don't need to change in this migration step.
 * Later steps will collapse the orchestration into free functions.
 *
 * `dryRunDeploy` still uses `ReviveApi.instantiate` directly — that runtime
 * API is the correct primitive for weight/storage estimation of a raw code
 * upload (`extractTransaction` from `@polkadot-apps/tx` targets ink-SDK-shaped
 * dry-run results, which is a different path).
 */
export class ContractDeployer {
    public signer: ReturnType<typeof prepareSigner>;
    public origin: string;
    public api: TypedApi<AssetHub>;
    public client: PolkadotClient;

    constructor(
        signer: ReturnType<typeof prepareSigner>,
        origin: string,
        client: PolkadotClient,
        api: TypedApi<AssetHub>,
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
    ): Promise<{ address: string; txHash: string; blockHash: string }> {
        const { tx } = await this.dryRunDeploy(pvmPath, cdmPackage);

        const result = await submitAndWatch(tx as unknown as SubmittableTransaction, this.signer, {
            waitFor: "best-block",
        });

        if (!result.ok) {
            throw new Error(
                `Deployment transaction failed: ${stringifyBigInt(result.dispatchError ?? "unknown dispatch error")}`,
            );
        }

        const instantiated = this.api.event.Revive.Instantiated.filter(
            result.events as Parameters<typeof this.api.event.Revive.Instantiated.filter>[0],
        );
        if (instantiated.length === 0) {
            throw new Error("Contract instantiation failed - no Instantiated event");
        }

        const address = instantiated[0].contract.asHex();
        return { address, txHash: result.txHash, blockHash: result.block.hash };
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
    async dryRunDeploy(pvmPath: string, cdmPackage?: string) {
        const bytecode = readFileSync(pvmPath);
        const code = Binary.fromBytes(bytecode);
        const data = Binary.fromBytes(new Uint8Array(0));
        const salt = cdmPackage ? computeDeploySalt(cdmPackage) : undefined;

        const dryRun = await this.api.apis.ReviveApi.instantiate(
            this.origin,
            0n,
            undefined,
            undefined,
            Enum("Upload", code),
            data,
            salt,
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

        const address = dryRun.result.value.addr.asHex();

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
            const addr = FixedSizeBinary.fromHex(address) as FixedSizeBinary<20>;
            const info = await this.api.query.Revive.AccountInfoOf.getValue(addr);
            if (!info || info.account_type.type !== "Contract") return null;
            const codeHash = info.account_type.value.code_hash;
            const pristine = await this.api.query.Revive.PristineCode.getValue(codeHash);
            if (!pristine) return null;
            return pristine.asBytes();
        } catch {
            return null;
        }
    }

    /**
     * Resolve the per-extrinsic weight budget used for weight-aware chunking.
     * Queries `System.BlockWeights().per_class.normal.max_extrinsic` on the
     * runtime, falling back to `FALLBACK_MAX_EXTRINSIC_WEIGHT` if the runtime
     * doesn't expose it (or returns `undefined`). A 0.85 safety factor is
     * applied so we don't nudge the real extrinsic limit.
     */
    private async resolveChunkBudget(): Promise<WeightLike> {
        let base: WeightLike = FALLBACK_MAX_EXTRINSIC_WEIGHT;
        try {
            const weights = await this.api.constants.System.BlockWeights();
            const maxExtrinsic = weights?.per_class?.normal?.max_extrinsic;
            if (
                maxExtrinsic &&
                typeof maxExtrinsic.ref_time === "bigint" &&
                typeof maxExtrinsic.proof_size === "bigint"
            ) {
                base = { ref_time: maxExtrinsic.ref_time, proof_size: maxExtrinsic.proof_size };
            }
        } catch {
            // fall through to hardcoded budget
        }
        return {
            ref_time: (base.ref_time * WEIGHT_BUDGET_SAFETY_FACTOR) / 100n,
            proof_size: (base.proof_size * WEIGHT_BUDGET_SAFETY_FACTOR) / 100n,
        };
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
    ): Promise<{ addresses: string[]; chunkCount: number }> {
        if (pvmPaths.length === 0) return { addresses: [], chunkCount: 0 };

        // 1. Dry-run all contracts up front so we have weights + CREATE2-style
        //    addresses for the chunker.
        const prepared = await Promise.all(
            pvmPaths.map((p, i) => this.dryRunDeploy(p, cdmPackages?.[i])),
        );

        // 2. Chunk by cumulative declared weight.
        const budget = await this.resolveChunkBudget();
        const chunks = chunkByWeight(
            prepared.map((p) => p.gasLimit),
            budget,
        );

        const addresses: string[] = new Array(pvmPaths.length);

        // 3. Submit each chunk sequentially.
        for (let ci = 0; ci < chunks.length; ci++) {
            const idxs = chunks[ci];

            // Fast path: a single-item chunk via the non-batch path — matches
            // the pre-chunking one-contract behavior so a user deploying one
            // contract doesn't pay the Utility.batch_all overhead.
            let chunkResult: { txHash: string; blockHash: string; addrs: string[] };
            if (idxs.length === 1) {
                const i = idxs[0];
                const r = await this.deploy(pvmPaths[i], cdmPackages?.[i]);
                addresses[i] = r.address;
                chunkResult = { txHash: r.txHash, blockHash: r.blockHash, addrs: [r.address] };
            } else {
                const result = await batchSubmitAndWatch(
                    idxs.map((i) => prepared[i].tx),
                    this.api as unknown as BatchApi,
                    this.signer,
                    { mode: "batch_all", waitFor: "best-block" },
                );
                if (!result.ok) {
                    throw new Error(
                        `Batch deploy failed (chunk ${ci + 1}/${chunks.length}): ${stringifyBigInt(result.dispatchError ?? "unknown dispatch error")}`,
                    );
                }
                const instantiated = this.api.event.Revive.Instantiated.filter(
                    result.events as Parameters<
                        typeof this.api.event.Revive.Instantiated.filter
                    >[0],
                );
                if (instantiated.length !== idxs.length) {
                    throw new Error(
                        `Expected ${idxs.length} Instantiated events in chunk ${ci + 1}, got ${instantiated.length}`,
                    );
                }
                const chunkAddrs = instantiated.map((e) => e.contract.asHex());
                for (let j = 0; j < idxs.length; j++) {
                    addresses[idxs[j]] = chunkAddrs[j];
                }
                chunkResult = {
                    txHash: result.txHash,
                    blockHash: result.block.hash,
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
     * @param registry - A `@polkadot-apps/contracts` `Contract` handle for the on-chain
     *   `ContractRegistry` (from `RegistryManager.contract`). Used to `.prepare(...)` the
     *   `publishLatest(...)` calls that get batched alongside the deploys.
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
    ): Promise<{ addresses: string[]; chunkCount: number }> {
        if (pvmPaths.length === 0) return { addresses: [], chunkCount: 0 };
        if (pvmPaths.length !== cdmPackages.length || pvmPaths.length !== metadataUris.length) {
            throw new Error(
                `deployAndRegisterBatch: length mismatch — pvmPaths=${pvmPaths.length}, cdmPackages=${cdmPackages.length}, metadataUris=${metadataUris.length}`,
            );
        }

        // 1. Dry-run each deploy to get weight/storage, the unsigned tx, and
        //    the precomputed CREATE2 address — all in one ReviveApi.instantiate
        //    round-trip per contract (was two, prior to this change).
        const prepared = await Promise.all(
            pvmPaths.map((p, i) => this.dryRunDeploy(p, cdmPackages[i])),
        );

        // 2. Build the `publishLatest` BatchableCalls via `.prepare(...)` using
        //    the precomputed CREATE2 address + the caller-supplied metadata CID.
        const prepareOpts = {
            gasLimit: { ref_time: GAS_LIMIT.refTime, proof_size: GAS_LIMIT.proofSize },
            storageDepositLimit: STORAGE_DEPOSIT_LIMIT,
        };
        const registerCalls = cdmPackages.map((pkg, i) =>
            registry.publishLatest.prepare(pkg, prepared[i].address, metadataUris[i], prepareOpts),
        );

        // 3. Chunk by cumulative deploy weight. Register-call weight is
        //    ignored (see method doc-comment for why).
        const budget = await this.resolveChunkBudget();
        const chunks = chunkByWeight(
            prepared.map((p) => p.gasLimit),
            budget,
        );

        const addresses: string[] = new Array(pvmPaths.length);

        // 4. Submit each chunk sequentially as an atomic batch_all of
        //    (chunk's deploys) + (chunk's registers).
        for (let ci = 0; ci < chunks.length; ci++) {
            const idxs = chunks[ci];
            const chunkCalls = [
                ...idxs.map((i) => prepared[i].tx),
                ...idxs.map((i) => registerCalls[i]),
            ];

            const result = await batchSubmitAndWatch(
                chunkCalls,
                this.api as unknown as BatchApi,
                this.signer,
                { mode: "batch_all", waitFor: "best-block" },
            );
            if (!result.ok) {
                throw new Error(
                    `Batch deploy+register failed (chunk ${ci + 1}/${chunks.length}): ${stringifyBigInt(result.dispatchError ?? "unknown dispatch error")}`,
                );
            }

            // Verify on-chain Instantiated events match our precomputed
            // addresses (sanity check — CREATE2 is deterministic, so any
            // mismatch indicates a bug or chain version skew).
            const instantiated = this.api.event.Revive.Instantiated.filter(
                result.events as Parameters<typeof this.api.event.Revive.Instantiated.filter>[0],
            );
            if (instantiated.length !== idxs.length) {
                throw new Error(
                    `Expected ${idxs.length} Instantiated events in chunk ${ci + 1}, got ${instantiated.length}`,
                );
            }
            const chunkAddrs = instantiated.map((e) => e.contract.asHex());
            for (let j = 0; j < idxs.length; j++) {
                const expected = prepared[idxs[j]].address;
                if (chunkAddrs[j].toLowerCase() !== expected.toLowerCase()) {
                    throw new Error(
                        `Address mismatch for ${cdmPackages[idxs[j]]}: precomputed ${expected}, on-chain ${chunkAddrs[j]}`,
                    );
                }
                addresses[idxs[j]] = chunkAddrs[j];
            }

            if (onChunk) {
                onChunk({
                    crates: idxs.map((i) => cdmPackages[i]),
                    addresses: idxs.map((i) => addresses[i]),
                    txHash: result.txHash,
                    blockHash: result.block.hash,
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
    });
}
