import { getChainAPI } from "@polkadot-apps/chain-client";
import { ContractManager } from "@polkadot-apps/contracts";
import { createDevSigner } from "@polkadot-apps/tx";
import cdmJson from "../cdm.json";

// --- Connect to chain ---
const api = await getChainAPI("paseo");

// --- Create contract manager ---
const manager = new ContractManager(cdmJson as any, api.contracts, {
    defaultSigner: createDevSigner("Alice"),
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
api.destroy();
console.log("\nDone!");
