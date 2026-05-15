import {
    ContractManager,
    ensureContractAccountMapped,
    type CdmJson,
    type CdmJsonTarget,
} from "@parity/product-sdk-contracts";
import { paseo_asset_hub } from "@parity/product-sdk-descriptors/paseo-asset-hub";
import { previewnet_asset_hub } from "@parity/product-sdk-descriptors/previewnet-asset-hub";
import { createDevSigner, getDevPublicKey } from "@parity/product-sdk-tx";
import { ss58Address } from "@polkadot-labs/hdkd-helpers";
import { createClient, type ChainDefinition, type SS58String } from "polkadot-api";
import { getWsProvider } from "polkadot-api/ws";
import cdmJson from "../cdm.json";

function getTarget(config: CdmJson): CdmJsonTarget {
    const target = Object.values(config.targets)[0];
    if (!target) {
        throw new Error(
            "No CDM target found. Run `cdm i -n paseo @example/counter @example/counter-writer @example/counter-reader` first.",
        );
    }
    return target;
}

function isPreviewnet(target: CdmJsonTarget): boolean {
    return target["asset-hub"].includes("previewnet");
}

function descriptorFor(target: CdmJsonTarget): ChainDefinition {
    return isPreviewnet(target) ? previewnet_asset_hub : paseo_asset_hub;
}

// --- Setup signer (Alice) ---
const signer = createDevSigner("Alice");
const aliceAddress = ss58Address(getDevPublicKey("Alice"), 42) as SS58String;

// --- Create Product SDK contract manager from cdm.json ---
const target = getTarget(cdmJson as CdmJson);
const client = createClient(getWsProvider(target["asset-hub"]));
const contracts = ContractManager.fromClient(
    cdmJson as CdmJson,
    client,
    descriptorFor(target),
    {
        defaultOrigin: aliceAddress,
        defaultSigner: signer,
    },
);

await ensureContractAccountMapped(contracts.getRuntime(), aliceAddress, signer);

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
await counterWriter.writeIncrement.tx();

console.log("Querying counter.getCount...");
const { value: count2 } = await counter.getCount.query();
const { value: readCount2 } = await counterReader.readCount.query();
console.log("getCount result:", count2);
console.log("readCount result:", readCount2);

// --- Clean up ---
client.destroy();
console.log("\nDone!");
