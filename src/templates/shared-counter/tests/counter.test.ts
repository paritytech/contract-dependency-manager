import { afterAll, describe, expect, test } from "vitest";
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

// `cdm test` deploys + installs against the local PPN, then runs this suite.
// Override the URL to point the tests at another chain.
const ASSETHUB_URL = process.env.CDM_ASSETHUB_URL ?? "ws://127.0.0.1:10020";

// Rename "@example" to match the org you set in lib.rs before running.
const COUNTER = "@example/counter";
const COUNTER_WRITER = "@example/counter-writer";
const COUNTER_READER = "@example/counter-reader";

const signer = createDevSigner("Alice");
const aliceAddress = ss58Address(getDevPublicKey("Alice"), 42) as SS58String;

// The local PPN chain reuses the paseo descriptors — the Revive/contract
// surface is identical across the two.
const client = createClient(getWsProvider(ASSETHUB_URL));
const contracts = ContractManager.fromClient(cdmJson as CdmJson, client, paseo_asset_hub, {
    defaultOrigin: aliceAddress,
    defaultSigner: signer,
});

afterAll(() => client.destroy());

describe("shared counter", () => {
    test("Alice is mapped on Revive", async () => {
        const mapped = await ensureContractAccountMapped(
            contracts.getRuntime(),
            aliceAddress,
            signer,
        );
        expect(mapped.ok).toBe(true);
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
