// End-to-end validation of the CREATE3 address derivation against a local
// PPN (product-preview-net) — the ground truth for the whole scheme: after the
// harness deploys the registry through the factory, the factory's on-chain
// `predict(salt)`, the offline TS mirror (`predictCreate3Address`), and the
// address the registry actually landed at must all agree.
//
// Gated to the `e2e/` directory by `vitest.e2e.config.ts` so `pnpm test`
// (unit only) stays fast; run this suite via `pnpm test:e2e`.

import { describe, test, expect, beforeAll, afterAll } from "vitest";
import { createCdmAssetHubClient, prepareSigner, type CdmAssetHubClient } from "@parity/cdm-env";
import { ALICE_SS58, CONTRACTS_REGISTRY_PACKAGE } from "@parity/cdm-utils";
import {
    createContractFromClient,
    type Contract,
    type ContractDef,
} from "@parity/product-sdk-contracts";
// Subpath import for the same reason as registry.e2e.test.ts (vitest's Vite
// resolver tree-shakes the package root and constants come back undefined);
// pure functions come straight from the source modules.
import { CREATE3_FACTORY_ABI } from "@parity/cdm-builder/abi";
import { CREATE3_CHILD_CODE_HASH, predictCreate3Address } from "../../src/create3";
import { computeDeploySalt } from "../../src/deployer";
import { hexToBytes } from "../../src/solidity";
import { connectPpn, deployRegistry, type PpnHandle, type DeployedRegistry } from "./harness";

let ppn: PpnHandle;
let chainClient: CdmAssetHubClient;
let deployed: DeployedRegistry;
let factory: Contract<ContractDef>;

const REGISTRY_SALT = computeDeploySalt(CONTRACTS_REGISTRY_PACKAGE);

function lc(v: unknown): string {
    return String(v).toLowerCase();
}

beforeAll(async () => {
    ppn = await connectPpn();
    deployed = await deployRegistry(ppn.wsUrl);

    const signer = prepareSigner("Alice");
    chainClient = await createCdmAssetHubClient(ppn.wsUrl, "local");
    await chainClient.raw.assetHub.getChainSpecData();
    factory = createContractFromClient(
        chainClient.raw.assetHub,
        chainClient.descriptors.assetHub,
        deployed.factoryAddress,
        CREATE3_FACTORY_ABI,
        { defaultSigner: signer, defaultOrigin: ALICE_SS58 },
    );
}, 300_000);

afterAll(async () => {
    chainClient?.destroy();
});

describe("CREATE3 address derivation", () => {
    test("on-chain predict(salt) returns the deployed registry address", async () => {
        const r = await factory.predict.query(REGISTRY_SALT);
        expect(r.success).toBe(true);
        expect(lc(r.value)).toBe(lc(deployed.address));
    });

    test("offline predictCreate3Address agrees with the deployed registry address", () => {
        expect(lc(predictCreate3Address(deployed.factoryAddress, hexToBytes(REGISTRY_SALT)))).toBe(
            lc(deployed.address),
        );
    });

    test("the factory was constructed with the committed child code hash", async () => {
        const r = await factory.getChildCodeHash.query();
        expect(r.success).toBe(true);
        expect(lc(r.value)).toBe(CREATE3_CHILD_CODE_HASH);
    });

    test("the registry address is a real contract account", async () => {
        const info = await chainClient.assetHub.query.Revive.AccountInfoOf.getValue(
            deployed.address,
        );
        expect(info?.account_type.type).toBe("Contract");
    });
});
