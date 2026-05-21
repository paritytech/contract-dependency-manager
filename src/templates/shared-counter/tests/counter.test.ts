import { afterAll, describe, expect, test } from "vitest";
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
            "No CDM target found in cdm.json. Run `cdm test` (which deploys + installs) first.",
        );
    }
    return target;
}

function descriptorFor(target: CdmJsonTarget): ChainDefinition {
    return target["asset-hub"].includes("previewnet") ? previewnet_asset_hub : paseo_asset_hub;
}

// Rename "@example" to match the org you set in lib.rs before running.
const COUNTER = "@example/counter";
const COUNTER_WRITER = "@example/counter-writer";
const COUNTER_READER = "@example/counter-reader";

const signer = createDevSigner("Alice");
const aliceAddress = ss58Address(getDevPublicKey("Alice"), 42) as SS58String;

const target = getTarget(cdmJson as CdmJson);
const client = createClient(getWsProvider(target["asset-hub"]));
const contracts = ContractManager.fromClient(cdmJson as CdmJson, client, descriptorFor(target), {
    defaultOrigin: aliceAddress,
    defaultSigner: signer,
});

afterAll(() => client.destroy());

describe("shared counter", () => {
    test("Alice is mapped on Revive", async () => {
        await ensureContractAccountMapped(contracts.getRuntime(), aliceAddress, signer);
    });

    test("getCount returns a number", async () => {
        const counter = contracts.getContract(COUNTER);
        const result = await counter.getCount.query();
        expect(result.success).toBe(true);
        expect(typeof result.value).toBe("number");
    });

    test("writeIncrement increases the count by 1", async () => {
        const counter = contracts.getContract(COUNTER);
        const counterWriter = contracts.getContract(COUNTER_WRITER);

        const before = await counter.getCount.query();
        expect(before.success).toBe(true);

        await counterWriter.writeIncrement.tx();

        const after = await counter.getCount.query();
        expect(after.success).toBe(true);
        expect(after.value).toBe(before.value + 1);
    });

    test("counter-reader and counter agree", async () => {
        const counter = contracts.getContract(COUNTER);
        const counterReader = contracts.getContract(COUNTER_READER);
        const direct = await counter.getCount.query();
        const viaReader = await counterReader.readCount.query();
        expect(direct.value).toBe(viaReader.value);
    });
});
