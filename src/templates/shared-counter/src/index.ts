import {
    ContractManager,
    ensureContractAccountMapped,
    type CdmJson,
} from "@parity/product-sdk-contracts";
import { paseo_asset_hub } from "@parity/product-sdk-descriptors/paseo-asset-hub";
import { createDevSigner, getDevPublicKey } from "@parity/product-sdk-tx";
import { ss58Address } from "@polkadot-labs/hdkd-helpers";
import { createClient, type SS58String } from "polkadot-api";
import { getWsProvider } from "polkadot-api/ws";
import cdmJson from "../cdm.json";

const PASEO_ASSET_HUB_URL = "wss://paseo-asset-hub-next-rpc.polkadot.io";

// --- Setup signer (Alice) ---
const signer = createDevSigner("Alice");
const aliceAddress = ss58Address(getDevPublicKey("Alice"), 42) as SS58String;

// --- Create Product SDK contract manager from cdm.json ---
const client = createClient(getWsProvider(PASEO_ASSET_HUB_URL));
const contracts = ContractManager.fromClient(
    cdmJson as CdmJson,
    client,
    paseo_asset_hub,
    {
        defaultOrigin: aliceAddress,
        defaultSigner: signer,
    },
);

const mapped = await ensureContractAccountMapped(contracts.getRuntime(), aliceAddress, signer);
if (!mapped.ok) throw mapped.error;

// --- Get typed contract handles ---
// TRY: running `cdm i -n paseo @example/counter @example/counter-writer @example/counter-reader`
//      and see that cdm.json and .cdm/contracts.d.ts resolve the types.
const counter = contracts.getContract("@example/counter");
const counterWriter = contracts.getContract("@example/counter-writer");
const counterReader = contracts.getContract("@example/counter-reader");

// --- Query counter ---
console.log("Querying counter.getCount...");
const { value: count } = await counter.getCount.query();
console.log("getCount result:", count);

// --- Write increment ---
console.log("\nCalling counterWriter.writeIncrement...");
const increment = await counterWriter.writeIncrement.tx();
if (!increment.ok) throw increment.error;

console.log("Querying counter.getCount...");
const { value: count2 } = await counter.getCount.query();
const { value: readCount2 } = await counterReader.readCount.query();
console.log("getCount result:", count2);
console.log("readCount result:", readCount2);

// --- Clean up ---
client.destroy();
console.log("\nDone!");
