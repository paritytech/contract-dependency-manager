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
// TRY : running `cdm i -n preview-net @example/counter @example/counter-writer @example/counter-reader`
//       and see that a cdm.json file willl appear & types will be resolved
const counter = cdm.getContract("@example/counter");
const counterWriter = cdm.getContract("@example/counter-writer");
const counterReader = cdm.getContract("@example/counter-reader");

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

// --- Clean up ---
cdm.destroy();
console.log("\nDone!");
