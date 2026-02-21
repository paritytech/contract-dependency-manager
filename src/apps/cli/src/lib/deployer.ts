import { PolkadotClient, TypedApi, Binary, Enum } from "polkadot-api";
import { AssetHub } from "@polkadot-api/descriptors";
import { readFileSync } from "fs";
import { prepareSigner } from "./signer.js";
import { stringifyBigInt, ALICE_SS58 } from "@dotdm/utils";
import { STORAGE_DEPOSIT_LIMIT } from "../constants.js";

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
     */
    async deploy(pvmPath: string): Promise<{ address: string; txHash: string; blockHash: string }> {
        const bytecode = readFileSync(pvmPath);
        const code = Binary.fromBytes(bytecode);
        const data = Binary.fromBytes(new Uint8Array(0));

        // Dry-run to estimate gas requirements
        const dryRun = await this.api.apis.ReviveApi.instantiate(
            ALICE_SS58,
            0n,
            undefined, // unlimited gas for estimation
            undefined, // unlimited storage deposit for estimation
            Enum("Upload", code),
            data,
            undefined, // salt
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
            salt: undefined,
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
     */
    async dryRunDeploy(pvmPath: string) {
        const bytecode = readFileSync(pvmPath);
        const code = Binary.fromBytes(bytecode);
        const data = Binary.fromBytes(new Uint8Array(0));

        const dryRun = await this.api.apis.ReviveApi.instantiate(
            ALICE_SS58,
            0n,
            undefined,
            undefined,
            Enum("Upload", code),
            data,
            undefined,
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
                salt: undefined,
            }),
            gasLimit,
            storageDeposit,
        };
    }

    /**
     * Deploy multiple contracts in a single Utility.batch_all transaction.
     * Returns addresses in the same order as the input paths.
     */
    async deployBatch(
        pvmPaths: string[],
    ): Promise<{ addresses: string[]; txHash: string; blockHash: string }> {
        if (pvmPaths.length === 0) return { addresses: [], txHash: "", blockHash: "" };
        if (pvmPaths.length === 1) {
            const result = await this.deploy(pvmPaths[0]);
            return {
                addresses: [result.address],
                txHash: result.txHash,
                blockHash: result.blockHash,
            };
        }

        const prepared = await Promise.all(pvmPaths.map((p) => this.dryRunDeploy(p)));

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
