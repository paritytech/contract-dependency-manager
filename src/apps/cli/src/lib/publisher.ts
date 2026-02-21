import { TypedApi, Binary } from "polkadot-api";
import { Bulletin } from "@polkadot-api/descriptors";
import { CID } from "multiformats/cid";
import { prepareSigner } from "./signer.js";
import { stringifyBigInt } from "@dotdm/utils";
import type { Metadata } from "./deployer.js";

export class MetadataPublisher {
    public signer: ReturnType<typeof prepareSigner>;
    public bulletinApi: TypedApi<Bulletin>;

    constructor(signer: ReturnType<typeof prepareSigner>, api: TypedApi<Bulletin>) {
        this.signer = signer;
        this.bulletinApi = api;
    }

    async publish(
        metadata: Metadata,
    ): Promise<{ cid: string; blockNumber: number; txHash: string; blockHash: string }> {
        const jsonString = JSON.stringify(metadata);
        const data = Binary.fromText(jsonString);

        const result = await this.bulletinApi.tx.TransactionStorage.store({
            data,
        }).signAndSubmit(this.signer);

        const storedEvents =
            this.bulletinApi.event.TransactionStorage.Stored.filter(
                result.events,
            );
        if (storedEvents.length === 0) {
            throw new Error(
                "Metadata publishing failed - no Stored event found",
            );
        }

        const { cid: cidBytes } = storedEvents[0];
        if (!cidBytes) {
            throw new Error(
                "Metadata publishing failed - no CID in Stored event",
            );
        }

        // cidBytes is a Binary (Vec<u8> from the chain) containing serialized CIDv1
        const cid = CID.decode(cidBytes.asBytes());
        return { cid: cid.toString(), blockNumber: result.block.number, txHash: result.txHash, blockHash: result.block.hash };
    }

    /**
     * Publish metadata for multiple contracts in a single Utility.batch_all transaction.
     */
    async publishBatch(
        metadataList: Metadata[],
    ): Promise<{ cids: string[]; blockNumber: number; txHash: string; blockHash: string }> {
        if (metadataList.length === 0) return { cids: [], blockNumber: 0, txHash: "", blockHash: "" };
        if (metadataList.length === 1) {
            const result = await this.publish(metadataList[0]);
            return { cids: [result.cid], blockNumber: result.blockNumber, txHash: result.txHash, blockHash: result.blockHash };
        }

        const txs = metadataList.map((metadata) => {
            const jsonString = JSON.stringify(metadata);
            const data = Binary.fromText(jsonString);
            return this.bulletinApi.tx.TransactionStorage.store({ data });
        });

        const calls = await Promise.all(
            txs.map(async (tx) => {
                const call = tx.decodedCall;
                return call instanceof Promise ? await call : call;
            }),
        );

        const result = await this.bulletinApi.tx.Utility.batch_all({
            calls,
        }).signAndSubmit(this.signer);

        const failures = this.bulletinApi.event.System.ExtrinsicFailed.filter(
            result.events,
        );
        if (failures.length > 0) {
            throw new Error(
                `Batch metadata publish failed: ${stringifyBigInt(failures[0])}`,
            );
        }

        const storedEvents =
            this.bulletinApi.event.TransactionStorage.Stored.filter(
                result.events,
            );
        if (storedEvents.length !== metadataList.length) {
            throw new Error(
                `Expected ${metadataList.length} Stored events, got ${storedEvents.length}`,
            );
        }

        const cids = storedEvents.map((event) => {
            const { cid: cidBytes } = event;
            if (!cidBytes) {
                throw new Error(
                    "Metadata publishing failed - no CID in Stored event",
                );
            }
            return CID.decode(cidBytes.asBytes()).toString();
        });

        return { cids, blockNumber: result.block.number, txHash: result.txHash, blockHash: result.block.hash };
    }
}
