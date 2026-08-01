import { BulletinPreparer, DEFAULT_CLIENT_CONFIG } from "@parity/product-sdk-cloud-storage";

const bulletinPreparer = new BulletinPreparer();

export async function computeBulletinStoreCid(data: Uint8Array): Promise<string> {
    if (data.length > DEFAULT_CLIENT_CONFIG.chunkingThreshold) {
        const prepared = await bulletinPreparer.prepareStoreChunked(data);
        const cid = prepared.manifest?.cid;
        if (!cid) {
            throw new Error("Bulletin store CID precompute did not produce a manifest CID");
        }
        return cid.toString();
    }

    const { cid } = await bulletinPreparer.prepareStore(data);
    return cid.toString();
}
