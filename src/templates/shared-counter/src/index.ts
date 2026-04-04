import { createClient } from "polkadot-api";
import { getWsProvider } from "polkadot-api/ws-provider";
import { withPolkadotSdkCompat } from "polkadot-api/polkadot-sdk-compat";
import { createInkSdk } from "@polkadot-api/sdk-ink";
import { ContractManager } from "@polkadot-apps/contracts";
import { DEV_PHRASE } from "@polkadot-labs/hdkd-helpers";
import { sr25519CreateDerive } from "@polkadot-labs/hdkd";
import { getPolkadotSigner } from "polkadot-api/signer";
import {
    entropyToMiniSecret,
    mnemonicToEntropy,
    ss58Address,
} from "@polkadot-labs/hdkd-helpers";
import cdmJson from "../cdm.json";

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
const origin = ss58Address(aliceKeyPair.publicKey);

// --- Connect to chain ---
const targetHash = Object.keys(cdmJson.targets)[0] as keyof typeof cdmJson.targets;
const target = cdmJson.targets[targetHash];
const client = createClient(withPolkadotSdkCompat(getWsProvider(target["asset-hub"])));
const inkSdk = createInkSdk(client);

// --- Create contract manager ---
const manager = new ContractManager(cdmJson as any, inkSdk, {
    defaultSigner: signer,
    defaultOrigin: origin,
});

// --- Get typed contract handles ---
// TRY : running `cdm i -n preview-net @example/counter @example/counter-writer @example/counter-reader`
//       and see that a cdm.json file will appear & types will be resolved
const counter = manager.getContract("@example/counter");
const counterWriter = manager.getContract("@example/counter-writer");
const counterReader = manager.getContract("@example/counter-reader");

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
client.destroy();
console.log("\nDone!");
