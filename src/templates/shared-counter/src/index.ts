import { createCdm } from "@dotdm/cdm";
import { DEV_PHRASE } from "@polkadot-labs/hdkd-helpers";
import { sr25519CreateDerive } from "@polkadot-labs/hdkd";
import { getPolkadotSigner } from "polkadot-api/signer";
import {
    entropyToMiniSecret,
    mnemonicToEntropy,
} from "@polkadot-labs/hdkd-helpers";
import { FixedSizeBinary } from "polkadot-api";

// --- Setup signer (Alice) ---
const entropy = mnemonicToEntropy(DEV_PHRASE);
const miniSecret = entropyToMiniSecret(entropy);
const derive = sr25519CreateDerive(miniSecret);
const aliceKeyPair = derive("//Alice");
const signer = getPolkadotSigner(
    aliceKeyPair.publicKey,
    "Sr25519",
    aliceKeyPair.sign,
);

// --- Create CDM instance ---
const cdm = createCdm();

// --- Get typed contract handles ---
const counter = cdm.getContract("@example/counter");
const counterWriter = cdm.getContract("@example/counter-writer");
const counterReader = cdm.getContract("@example/counter-reader");
const gigs = cdm.getContract("@parity/gigs");

const task = await gigs.getTask.query(FixedSizeBinary.fromHex("0x0000000000000000000000000000000000000000000000000000000000000042"));

// --- Query counter ---
console.log("Querying counter.getCount...");
const count = await counter.getCount.query();
console.log("getCount result:", count);

// --- Write increment ---
console.log("\nCalling counterWriter.writeIncrement...");
await counterWriter.writeIncrement.tx();

console.log("Querying counter.getCount...");
const count2 = await counter.getCount.query();
const readCount2 = await counterReader.readCount.query();
console.log("getCount result:", count2);
console.log("readCount result:", readCount2);

// console.log("\nQuerying reputation.getReviewCount...");
// const reviewCount = await reputation.getReviewCount.query(
//     "0x0000000000000000000000000000000000000000",
// );
// console.log("getReviewCount result:", reviewCount);

// --- Clean up ---
cdm.destroy();
console.log("\nDone!");
