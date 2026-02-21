import { CID } from "multiformats/cid";
import * as Digest from "multiformats/hashes/digest";
import { blake2b } from "@noble/hashes/blake2.js";

const BLAKE2B_256 = 0xb220;
const RAW_CODEC = 0x55;

export function computeCid(data: Uint8Array): string {
    const hash = blake2b(data, { dkLen: 32 });
    return CID.createV1(RAW_CODEC, Digest.create(BLAKE2B_256, hash)).toString();
}
