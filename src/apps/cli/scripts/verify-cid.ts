import { createClient, Binary } from "polkadot-api";
import { getWsProvider } from "polkadot-api/ws-provider/node";
import { withPolkadotSdkCompat } from "polkadot-api/polkadot-sdk-compat";
import { bulletin } from "@polkadot-api/descriptors";
import { getPolkadotSigner } from "polkadot-api/signer";
import { sr25519CreateDerive } from "@polkadot-labs/hdkd";
import { DEV_PHRASE, entropyToMiniSecret, mnemonicToEntropy } from "@polkadot-labs/hdkd-helpers";
import { CID } from "multiformats/cid";
import * as Digest from "multiformats/hashes/digest";
import { blake2AsU8a } from "@polkadot/util-crypto";

const BLAKE2B_256_CODE = 0xb220;
const RAW_CODEC = 0x55;

const endpoint = process.argv[2] || "wss://previewnet.substrate.dev/bulletin";

console.log(`Connecting to ${endpoint}...`);

const client = createClient(withPolkadotSdkCompat(getWsProvider(endpoint)));
const api = client.getTypedApi(bulletin);

// Set up Alice signer
const entropy = mnemonicToEntropy(DEV_PHRASE);
const miniSecret = entropyToMiniSecret(entropy);
const derive = sr25519CreateDerive(miniSecret);
const hdkdKeyPair = derive("//Alice");
const signer = getPolkadotSigner(hdkdKeyPair.publicKey, "Sr25519", hdkdKeyPair.sign);

// Prepare test data
const testPayload = JSON.stringify({
    test: true,
    timestamp: Date.now(),
    message: "CID verification script",
});
const data = Binary.fromText(testPayload);

console.log(`Test payload: ${testPayload}`);
console.log(`Payload bytes length: ${data.asBytes().length}`);

// Compute CID locally before submitting
const hash = blake2AsU8a(data.asBytes(), 256);
const digest = Digest.create(BLAKE2B_256_CODE, hash);
const localCid = CID.createV1(RAW_CODEC, digest);

console.log(`\nLocal CID: ${localCid.toString()}`);

// Submit to chain
console.log("\nSubmitting to TransactionStorage.store()...");
const result = await api.tx.TransactionStorage.store({ data }).signAndSubmit(signer);
console.log(`Transaction included in block: ${result.block.hash}`);

// Extract CID from Stored event
const storedEvents = api.event.TransactionStorage.Stored.filter(result.events);

if (storedEvents.length === 0) {
    console.error("No Stored event found in transaction result!");
    client.destroy();
    process.exit(1);
}

const { cid: cidBytes } = storedEvents[0];

if (!cidBytes) {
    console.error("Stored event has no CID field (it was undefined).");
    client.destroy();
    process.exit(1);
}

const chainCid = CID.decode(cidBytes.asBytes());

console.log(`Chain CID:  ${chainCid.toString()}`);

// Compare
const match = localCid.toString() === chainCid.toString();
console.log(`\nCIDs match: ${match}`);

if (!match) {
    console.log("\n--- Debug info ---");
    console.log(`Local CID bytes: ${Buffer.from(localCid.bytes).toString("hex")}`);
    console.log(`Chain CID bytes: ${Buffer.from(chainCid.bytes).toString("hex")}`);
    console.log(`Local CID version: ${localCid.version}`);
    console.log(`Chain CID version: ${chainCid.version}`);
    console.log(`Local CID codec: 0x${localCid.code.toString(16)}`);
    console.log(`Chain CID codec: 0x${chainCid.code.toString(16)}`);
    console.log(`Local multihash code: 0x${localCid.multihash.code.toString(16)}`);
    console.log(`Chain multihash code: 0x${chainCid.multihash.code.toString(16)}`);
    console.log(`Local hash hex: ${Buffer.from(localCid.multihash.digest).toString("hex")}`);
    console.log(`Chain hash hex: ${Buffer.from(chainCid.multihash.digest).toString("hex")}`);
}

client.destroy();
process.exit(match ? 0 : 1);
