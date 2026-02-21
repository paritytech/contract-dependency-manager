import { PolkadotClient, TypedApi } from "polkadot-api";
import { AssetHub, contracts } from "@polkadot-api/descriptors";
import { createInkSdk } from "@polkadot-api/sdk-ink";
import { prepareSigner } from "./signer.js";
import { stringifyBigInt } from "@dotdm/utils";
import { GAS_LIMIT, STORAGE_DEPOSIT_LIMIT } from "../constants.js";

export function getRegistryContract(client: PolkadotClient, addr: string) {
    const inkSdk = createInkSdk(client);
    return inkSdk.getContract(contracts.contractsRegistry, addr);
}

export type RegistryContract = ReturnType<typeof getRegistryContract>;

export class RegistryManager {
    public signer: ReturnType<typeof prepareSigner>;
    public api: TypedApi<AssetHub>;
    public client: PolkadotClient;
    public registry: RegistryContract;

    constructor(
        signer: ReturnType<typeof prepareSigner>,
        api: TypedApi<AssetHub>,
        client: PolkadotClient,
        registryAddress: string,
    ) {
        this.signer = signer;
        this.api = api;
        this.client = client;
        this.registry = getRegistryContract(client, registryAddress);
    }

    /**
     * Register a contract in the contracts registry via ink SDK.
     */
    async register(
        cdmPackage: string,
        contractAddr: string,
        metadataUri: string = "",
    ): Promise<{ txHash: string; blockHash: string }> {
        const result = await this.registry
            .send("publishLatest", {
                data: {
                    contract_name: cdmPackage,
                    contract_address: contractAddr,
                    metadata_uri: metadataUri,
                },
                gasLimit: {
                    ref_time: GAS_LIMIT.refTime,
                    proof_size: GAS_LIMIT.proofSize,
                },
                storageDepositLimit: STORAGE_DEPOSIT_LIMIT,
            })
            .signAndSubmit(this.signer);

        return { txHash: result.txHash, blockHash: result.block.hash };
    }

    /**
     * Register multiple contracts in a single Utility.batch_all transaction.
     */
    async registerBatch(
        entries: {
            cdmPackage: string;
            contractAddr: string;
            metadataUri: string;
        }[],
    ): Promise<{ txHash: string; blockHash: string }> {
        if (entries.length === 0) return { txHash: "", blockHash: "" };
        if (entries.length === 1) {
            return this.register(
                entries[0].cdmPackage,
                entries[0].contractAddr,
                entries[0].metadataUri,
            );
        }

        const txs = entries.map((entry) =>
            this.registry.send("publishLatest", {
                data: {
                    contract_name: entry.cdmPackage,
                    contract_address: entry.contractAddr,
                    metadata_uri: entry.metadataUri,
                },
                gasLimit: {
                    ref_time: GAS_LIMIT.refTime,
                    proof_size: GAS_LIMIT.proofSize,
                },
                storageDepositLimit: STORAGE_DEPOSIT_LIMIT,
            }),
        );

        const calls = await Promise.all(
            txs.map(async (tx) => {
                const call = tx.decodedCall;
                return call instanceof Promise ? await call : call;
            }),
        );

        const result = await this.api.tx.Utility.batch_all({
            calls,
        }).signAndSubmit(this.signer);

        const failures = this.api.event.System.ExtrinsicFailed.filter(
            result.events,
        );
        if (failures.length > 0) {
            throw new Error(`Batch register failed: ${stringifyBigInt(failures[0])}`);
        }

        return { txHash: result.txHash, blockHash: result.block.hash };
    }
}
