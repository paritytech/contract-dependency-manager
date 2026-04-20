import { TypedApi } from "polkadot-api";
import { Bulletin } from "@dotdm/descriptors";
import { prepareSigner } from "@dotdm/env";
import { upload, batchUpload, type BulletinApi } from "@polkadot-apps/bulletin";
import type { Metadata } from "./deployer";

/**
 * Thin wrapper around `@polkadot-apps/bulletin` `upload` / `batchUpload`.
 *
 * Kept as a class with the original surface so downstream callers
 * (deploy-pipeline.ts) don't need to change in this migration step.
 * Later steps will collapse this into free functions inside
 * `deployContracts()` and the class can be removed.
 *
 * Behavioral shift vs. the previous implementation:
 * - `publishBatch` is sequential (N txs, N signatures) rather than a single
 *   `Utility.batch_all`. This matches Bulletin's nonce-ordering requirement.
 * - The returned `txHash` for batches is the hash of the LAST item's tx (the
 *   old API returned a single tx hash for the whole batch). The
 *   `@polkadot-apps/bulletin` `UploadResult` does not expose a txHash, so
 *   we fall back to `blockHash` where needed and `blockNumber` is not
 *   available (returned as 0).
 */
export class MetadataPublisher {
    public signer: ReturnType<typeof prepareSigner>;
    public bulletinApi: TypedApi<Bulletin>;

    constructor(signer: ReturnType<typeof prepareSigner>, api: TypedApi<Bulletin>) {
        this.signer = signer;
        this.bulletinApi = api;
    }

    /**
     * `@dotdm/descriptors` Bulletin and `@polkadot-apps/descriptors` bulletin
     * are generated from the same chain metadata and are structurally
     * equivalent at runtime, but their TS types don't unify. Cast through
     * unknown — will be unnecessary once we move to `@polkadot-apps/chain-client`.
     */
    private get apiForBulletin(): BulletinApi {
        return this.bulletinApi as unknown as BulletinApi;
    }

    async publish(
        metadata: Metadata,
    ): Promise<{ cid: string; blockNumber: number; txHash: string; blockHash: string }> {
        const data = new TextEncoder().encode(JSON.stringify(metadata));

        const result = await upload(this.apiForBulletin, data, this.signer, {
            waitFor: "best-block",
        });

        if (result.kind !== "transaction") {
            throw new Error(
                `Expected transaction upload (standalone CLI), got kind="${result.kind}"`,
            );
        }

        return {
            cid: result.cid,
            // @polkadot-apps/bulletin does not expose blockNumber or txHash;
            // callers only use these for display.
            blockNumber: 0,
            txHash: "",
            blockHash: result.blockHash,
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

        const results = await batchUpload(this.apiForBulletin, items, this.signer, {
            waitFor: "best-block",
        });

        const cids: string[] = [];
        let lastBlockHash = "";
        for (const r of results) {
            if (!r.success) {
                throw new Error(`Batch metadata publish failed (${r.label}): ${r.error}`);
            }
            cids.push(r.cid);
            if (r.kind !== "transaction") {
                throw new Error(
                    `Expected transaction upload (standalone CLI), got kind="${r.kind}"`,
                );
            }
            lastBlockHash = r.blockHash;
        }

        return {
            cids,
            blockNumber: 0,
            txHash: "",
            blockHash: lastBlockHash,
        };
    }
}
