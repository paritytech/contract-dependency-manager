import type { PolkadotSigner } from "polkadot-api";
import type { CdmBulletinApi } from "@parity/cdm-env";
import { calculateCid } from "@parity/product-sdk-cloud-storage";
import { submitAndWatch, type SubmittableTransaction } from "@parity/product-sdk-tx";
import type { Metadata } from "./deployer";

/**
 * Thin wrapper around Bulletin `TransactionStorage.store`.
 *
 * Kept as a class with the original surface so downstream callers
 * (deploy-pipeline.ts) don't need to change in this migration step.
 * Later steps will collapse this into free functions inside
 * `deployContracts()` and the class can be removed.
 *
 * Uses direct PAPI submission instead of `CloudStorageClient.store(...).send()`
 * because the higher-level Bulletin SDK has a remaining-quota preflight that
 * can reject still-usable mobile-granted slot accounts before the chain sees
 * the transaction.
 *
 * `publishBatch` is sequential (N txs, N signatures), matching Bulletin's
 * nonce-ordering requirement.
 */
export class MetadataPublisher {
    public signer: PolkadotSigner;
    public bulletinApi: CdmBulletinApi;

    constructor(signer: PolkadotSigner, api: CdmBulletinApi, _client?: unknown) {
        this.signer = signer;
        this.bulletinApi = api;
    }

    async publish(
        metadata: Metadata,
    ): Promise<{ cid: string; blockNumber: number; txHash: string; blockHash: string }> {
        const data = new TextEncoder().encode(JSON.stringify(metadata));
        const cid = (await calculateCid(data)).toString();
        const tx = this.bulletinApi.tx.TransactionStorage.store({ data });

        let result: Awaited<ReturnType<typeof submitAndWatch>>;
        try {
            result = await submitAndWatch(tx as unknown as SubmittableTransaction, this.signer);
        } catch (err) {
            const orig = err instanceof Error ? err.message : String(err);
            throw new Error(`[Bulletin publish] ${orig}`, { cause: err });
        }

        return {
            cid,
            blockNumber: result.block.number,
            txHash: result.txHash,
            blockHash: result.block.hash,
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

        const N = metadataList.length;
        const cids: string[] = [];
        let lastBlockNumber = 0;
        for (let i = 0; i < metadataList.length; i++) {
            const itemLabel = `[Bulletin publish item ${i + 1}/${N}]`;

            let result: Awaited<ReturnType<typeof this.publish>>;
            try {
                result = await this.publish(metadataList[i]);
            } catch (err) {
                const orig = err instanceof Error ? err.message : String(err);
                throw new Error(`${itemLabel} Metadata publish failed (metadata-${i}): ${orig}`, {
                    cause: err,
                });
            }

            cids.push(result.cid);
            lastBlockNumber = result.blockNumber;
        }

        return {
            cids,
            blockNumber: lastBlockNumber,
            txHash: "",
            blockHash: "",
        };
    }
}

if (import.meta.vitest) {
    const { describe, expect, test, vi } = import.meta.vitest;

    const metadata: Metadata = {
        publish_block: 0,
        published_at: "2026-06-17T00:00:00.000Z",
        description: "",
        readme: "",
        authors: [],
        homepage: "",
        repository: "",
        abi: [],
    };

    function fakeStoreTx() {
        return {
            signSubmitAndWatch: vi.fn(() => ({
                subscribe: (handlers: {
                    next: (event: unknown) => void;
                    error: (error: Error) => void;
                }) => {
                    handlers.next({
                        type: "txBestBlocksState",
                        found: true,
                        ok: true,
                        txHash: "0xstore",
                        block: { hash: "0xblock", number: 42, index: 0 },
                        events: [],
                    });
                    return { unsubscribe: vi.fn() };
                },
            })),
        };
    }

    test("publishes metadata through direct TransactionStorage.store", async () => {
        const storeTx = fakeStoreTx();
        const store = vi.fn(() => storeTx);
        const preflight = vi.fn(() => {
            throw new Error("authorization preflight should not run");
        });
        const api = {
            tx: { TransactionStorage: { store } },
            query: {
                TransactionStorage: {
                    Authorizations: {
                        getValue: preflight,
                    },
                },
            },
        } as unknown as CdmBulletinApi;
        const signer = { publicKey: new Uint8Array(32) } as unknown as PolkadotSigner;

        const result = await new MetadataPublisher(signer, api).publish(metadata);

        const data = new TextEncoder().encode(JSON.stringify(metadata));
        expect(store).toHaveBeenCalledWith({ data });
        expect(result).toEqual({
            cid: (await calculateCid(data)).toString(),
            blockNumber: 42,
            txHash: "0xstore",
            blockHash: "0xblock",
        });
        expect(preflight).not.toHaveBeenCalled();
    });

    describe("publishBatch", () => {
        test("publishes sequential metadata items", async () => {
            const calls: Uint8Array[] = [];
            const api = {
                tx: {
                    TransactionStorage: {
                        store: vi.fn(({ data }: { data: Uint8Array }) => {
                            calls.push(data);
                            return fakeStoreTx();
                        }),
                    },
                },
            } as unknown as CdmBulletinApi;
            const signer = { publicKey: new Uint8Array(32) } as unknown as PolkadotSigner;

            const result = await new MetadataPublisher(signer, api).publishBatch([
                metadata,
                { ...metadata, description: "second" },
            ]);

            expect(calls).toHaveLength(2);
            expect(result.cids).toHaveLength(2);
            expect(result.blockNumber).toBe(42);
        });
    });
}
