import { PolkadotClient, TypedApi, Binary, Enum, FixedSizeBinary } from "polkadot-api";
import { AssetHub } from "@dotdm/descriptors";
import { readFileSync } from "fs";
import { prepareSigner } from "@dotdm/env";
import { stringifyBigInt, ALICE_SS58, STORAGE_DEPOSIT_LIMIT } from "@dotdm/utils";
import { blake2b } from "@noble/hashes/blake2.js";

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

export class ContractDeployer {
    public signer: ReturnType<typeof prepareSigner>;
    public api: TypedApi<AssetHub>;
    public client: PolkadotClient;

    constructor(
        signer: ReturnType<typeof prepareSigner>,
        client: PolkadotClient,
        api: TypedApi<AssetHub>,
    ) {
        this.signer = signer;
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
        const bytecode = readFileSync(pvmPath);
        const code = Binary.fromBytes(bytecode);
        const data = Binary.fromBytes(new Uint8Array(0));
        const salt = cdmPackage ? computeDeploySalt(cdmPackage) : undefined;

        // Dry-run to estimate gas requirements
        const dryRun = await this.api.apis.ReviveApi.instantiate(
            ALICE_SS58,
            0n,
            undefined, // unlimited gas for estimation
            undefined, // unlimited storage deposit for estimation
            Enum("Upload", code),
            data,
            salt,
        );

        if (dryRun.result.success === false) {
            throw new Error(
                `Contract instantiation dry-run failed: ${stringifyBigInt(dryRun.result)}`,
            );
        }

        // Use weight_required from dry-run with 20% headroom
        const gasLimit = {
            ref_time: (dryRun.weight_required.ref_time * 120n) / 100n,
            proof_size: (dryRun.weight_required.proof_size * 120n) / 100n,
        };

        // Derive storage deposit from dry-run
        let storageDeposit = STORAGE_DEPOSIT_LIMIT;
        if (dryRun.storage_deposit.type === "Charge") {
            storageDeposit = (dryRun.storage_deposit.value * 120n) / 100n;
        }

        const result = await this.api.tx.Revive.instantiate_with_code({
            value: 0n,
            weight_limit: gasLimit,
            storage_deposit_limit: storageDeposit,
            code,
            data,
            salt,
        }).signAndSubmit(this.signer);

        const failures = this.api.event.System.ExtrinsicFailed.filter(result.events);
        if (failures.length > 0) {
            throw new Error(`Deployment transaction failed: ${stringifyBigInt(failures[0])}`);
        }

        const instantiated = this.api.event.Revive.Instantiated.filter(result.events);
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
            ALICE_SS58,
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

        const gasLimit = {
            ref_time: (dryRun.weight_required.ref_time * 120n) / 100n,
            proof_size: (dryRun.weight_required.proof_size * 120n) / 100n,
        };

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

        const calls = await Promise.all(
            prepared.map(async (p) => {
                const call = p.tx.decodedCall;
                return call instanceof Promise ? await call : call;
            }),
        );

        const result = await this.api.tx.Utility.batch_all({
            calls,
        }).signAndSubmit(this.signer);

        const failures = this.api.event.System.ExtrinsicFailed.filter(result.events);
        if (failures.length > 0) {
            throw new Error(`Batch deploy failed: ${stringifyBigInt(failures[0])}`);
        }

        const instantiated = this.api.event.Revive.Instantiated.filter(result.events);
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
}
