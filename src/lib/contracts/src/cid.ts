import { CID } from "multiformats/cid";
import * as Digest from "multiformats/hashes/digest";
import { blake2b } from "@noble/hashes/blake2.js";
import { BulletinPreparer, DEFAULT_CLIENT_CONFIG } from "@parity/product-sdk-cloud-storage";

const BLAKE2B_256 = 0xb220;
const RAW_CODEC = 0x55;
const bulletinPreparer = new BulletinPreparer();

export function computeCid(data: Uint8Array): string {
    const hash = blake2b(data, { dkLen: 32 });
    return CID.createV1(RAW_CODEC, Digest.create(BLAKE2B_256, hash)).toString();
}

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
