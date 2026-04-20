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
     * transaction descriptor (unsigned) and the bytecode for later batching.
     * When cdmPackage is provided, uses CREATE2 (deterministic address via salt).
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
     * Deploy multiple contracts in a single Utility.batch_all transaction.
     * Returns addresses in the same order as the input paths.
     * When cdmPackages is provided, each contract uses CREATE2 with a salt derived from its package name.
     */
    async deployBatch(
        pvmPaths: string[],
        cdmPackages?: (string | undefined)[],
    ): Promise<{ addresses: string[]; txHash: string; blockHash: string }> {
        if (pvmPaths.length === 0) return { addresses: [], txHash: "", blockHash: "" };
        if (pvmPaths.length === 1) {
            const result = await this.deploy(pvmPaths[0], cdmPackages?.[0]);
            return {
                addresses: [result.address],
                txHash: result.txHash,
                blockHash: result.blockHash,
            };
        }

        const prepared = await Promise.all(
            pvmPaths.map((p, i) => this.dryRunDeploy(p, cdmPackages?.[i])),
        );

        const result = await batchSubmitAndWatch(
            prepared.map((p) => p.tx),
            this.api as unknown as BatchApi,
            this.signer,
            { mode: "batch_all", waitFor: "best-block" },
        );

        if (!result.ok) {
            throw new Error(
                `Batch deploy failed: ${stringifyBigInt(result.dispatchError ?? "unknown dispatch error")}`,
            );
        }

        const instantiated = this.api.event.Revive.Instantiated.filter(
            result.events as Parameters<typeof this.api.event.Revive.Instantiated.filter>[0],
        );
        if (instantiated.length !== pvmPaths.length) {
            throw new Error(
                `Expected ${pvmPaths.length} Instantiated events, got ${instantiated.length}`,
            );
        }

        const addresses = instantiated.map((e) => e.contract.asHex());
        return {
            addresses,
            txHash: result.txHash,
            blockHash: result.block.hash,
        };
    }

    /**
     * Deploy N contracts AND register each in the on-chain `ContractRegistry`
     * in a single `Utility.batch_all` on AssetHub.
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
     * Atomicity: `batch_all` reverts the whole batch on any single failure, so
     * a register revert (e.g., ownership check) will also unwind the deploy.
     *
     * @param pvmPaths - filesystem paths to compiled `.polkavm` bytecode, one per contract.
     * @param cdmPackages - CDM package name per contract — required because both CREATE2
     *   salt derivation and `registry.publishLatest.contract_name` need it.
     * @param registry - A `@polkadot-apps/contracts` `Contract` handle for the on-chain
     *   `ContractRegistry` (from `RegistryManager.contract`). Used to `.prepare(...)` the
     *   `publishLatest(...)` calls that get batched alongside the deploys.
     * @param metadataUris - CIDs from a prior Bulletin publish, one per contract (same order
     *   as `pvmPaths` / `cdmPackages`). Pass `""` for crates without metadata.
     * @returns Deployed addresses (in input order), plus the single batch tx hash / block hash.
     */
    async deployAndRegisterBatch(
        pvmPaths: string[],
        cdmPackages: string[],
        registry: Contract<ContractDef>,
        metadataUris: string[],
    ): Promise<{ addresses: string[]; txHash: string; blockHash: string }> {
        if (pvmPaths.length === 0) return { addresses: [], txHash: "", blockHash: "" };
        if (pvmPaths.length !== cdmPackages.length || pvmPaths.length !== metadataUris.length) {
            throw new Error(
                `deployAndRegisterBatch: length mismatch — pvmPaths=${pvmPaths.length}, cdmPackages=${cdmPackages.length}, metadataUris=${metadataUris.length}`,
            );
        }

        // 1. Dry-run each deploy to get weight/storage and the unsigned tx,
        //    plus read the precomputed CREATE2 contract address so we can pass
        //    it to `registry.publishLatest(...)`.
        const prepared = await Promise.all(
            pvmPaths.map(async (p, i) => {
                const pkg = cdmPackages[i];
                const { tx } = await this.dryRunDeploy(p, pkg);
                const bytecode = readFileSync(p);
                const code = Binary.fromBytes(bytecode);
                const salt = computeDeploySalt(pkg);
                // Use ReviveApi.instantiate a second time but capture the
                // precomputed `addr` from the dry-run result. We already have
                // `tx`, but not the address; ReviveApi.instantiate returns
                // `.addr` on success which is exactly the CREATE2 address
                // without consuming any weight.
                const addrResult = await this.api.apis.ReviveApi.instantiate(
                    this.origin,
                    0n,
                    undefined,
                    undefined,
                    Enum("Upload", code),
                    Binary.fromBytes(new Uint8Array(0)),
                    salt,
                );
                if (addrResult.result.success === false) {
                    throw new Error(
                        `Precompute address dry-run failed for ${pkg}: ${stringifyBigInt(addrResult.result)}`,
                    );
                }
                return { tx, address: addrResult.result.value.addr.asHex() };
            }),
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

        // 3. Submit N deploys + N registers in one atomic batch_all.
        //    `batchSubmitAndWatch` resolves each call's `.waited` for us.
        const result = await batchSubmitAndWatch(
            [...prepared.map((p) => p.tx), ...registerCalls],
            this.api as unknown as BatchApi,
            this.signer,
            { mode: "batch_all", waitFor: "best-block" },
        );

        if (!result.ok) {
            throw new Error(
                `Batch deploy+register failed: ${stringifyBigInt(result.dispatchError ?? "unknown dispatch error")}`,
            );
        }

        // 4. Verify on-chain Instantiated events match our precomputed
        //    addresses (sanity check — CREATE2 is deterministic, so a mismatch
        //    indicates a bug or a chain version skew).
        const instantiated = this.api.event.Revive.Instantiated.filter(
            result.events as Parameters<typeof this.api.event.Revive.Instantiated.filter>[0],
        );
        if (instantiated.length !== pvmPaths.length) {
            throw new Error(
                `Expected ${pvmPaths.length} Instantiated events, got ${instantiated.length}`,
            );
        }
        const addresses = instantiated.map((e) => e.contract.asHex());
        for (let i = 0; i < addresses.length; i++) {
            if (addresses[i].toLowerCase() !== prepared[i].address.toLowerCase()) {
                throw new Error(
                    `Address mismatch for ${cdmPackages[i]}: precomputed ${prepared[i].address}, on-chain ${addresses[i]}`,
                );
            }
        }

        return {
            addresses,
            txHash: result.txHash,
            blockHash: result.block.hash,
        };
    }
}
