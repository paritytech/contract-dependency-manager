import type { PolkadotClient, TypedApi } from "polkadot-api";
import { bulletin } from "@parity/product-sdk-descriptors/bulletin";
import { prepareSigner } from "@dotdm/env";
import {
    AsyncBulletinClient,
    BulletinClient,
    type BulletinApi,
    type BulletinTypedApi,
    type StoreBuilder,
    type SubmitFn,
} from "@parity/product-sdk-bulletin";
import type { Metadata } from "./deployer";

/**
 * Thin wrapper around product-sdk's `BulletinClient.store(...).send()`.
 *
 * Kept as a class with the original surface so downstream callers
 * (deploy-pipeline.ts) don't need to change in this migration step.
 * Later steps will collapse this into free functions inside
 * `deployContracts()` and the class can be removed.
 *
 * Behavioral shift vs. the previous implementation:
 * `publishBatch` is sequential (N txs, N signatures), matching Bulletin's
 * nonce-ordering requirement. Product SDK's store result exposes a block
 * number and extrinsic index rather than block/tx hashes, so display-only hash
 * fields are returned as empty strings.
 */
export class MetadataPublisher {
    public signer: ReturnType<typeof prepareSigner>;
    public bulletinApi: TypedApi<typeof bulletin>;
    private bulletin: BulletinClient;

    constructor(
        signer: ReturnType<typeof prepareSigner>,
        api: TypedApi<typeof bulletin>,
        client: PolkadotClient,
    ) {
        this.signer = signer;
        this.bulletinApi = api;
        this.bulletin = BulletinClient.from(
            new AsyncBulletinClient(
                api as unknown as BulletinTypedApi,
                signer,
                client.submit as SubmitFn,
            ),
            api as unknown as BulletinApi,
        );
    }

    async publish(
        metadata: Metadata,
    ): Promise<{ cid: string; blockNumber: number; txHash: string; blockHash: string }> {
        const data = new TextEncoder().encode(JSON.stringify(metadata));

        let result: Awaited<ReturnType<StoreBuilder["send"]>>;
        try {
            result = await this.bulletin.store(data).send();
        } catch (err) {
            const orig = err instanceof Error ? err.message : String(err);
            throw new Error(`[Bulletin publish] ${orig}`, { cause: err });
        }

        const cid = result.cid?.toString();
        if (!cid) {
            throw new Error("[Bulletin publish] Store result did not include a CID");
        }

        return {
            cid,
            blockNumber: result.blockNumber ?? 0,
            txHash: "",
            blockHash: "",
        };
    }

    /**
     * Publish metadata for multiple contracts. Submits sequentially — one tx
     * per item — as required by Bulletin's nonce ordering.
     */
    async publishBatch(
        metadataList: Metadata[],
    ): Promise<{ cids: string[]; blockNumber: number; txHash: string; blockHash: string }> {
        if (metadataList.length === 0)
            return { cids: [], blockNumber: 0, txHash: "", blockHash: "" };

        const items = metadataList.map((metadata, idx) => ({
            data: new TextEncoder().encode(JSON.stringify(metadata)),
            label: `metadata-${idx}`,
        }));

        const N = items.length;
        const cids: string[] = [];
        let lastBlockNumber = 0;
        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            const itemLabel = `[Bulletin publish item ${i + 1}/${N}]`;

            let result: Awaited<ReturnType<StoreBuilder["send"]>>;
            try {
                result = await this.bulletin.store(item.data).send();
            } catch (err) {
                const orig = err instanceof Error ? err.message : String(err);
                throw new Error(`${itemLabel} Metadata publish failed (${item.label}): ${orig}`, {
                    cause: err,
                });
            }

            const cid = result.cid?.toString();
            if (!cid) {
                throw new Error(
                    `${itemLabel} Store result did not include a CID for ${item.label}`,
                );
            }
            cids.push(cid);
            lastBlockNumber = result.blockNumber ?? lastBlockNumber;
        }

        return {
            cids,
            blockNumber: lastBlockNumber,
            txHash: "",
            blockHash: "",
        };
    }
}
