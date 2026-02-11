import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { resolve } from "path";
import { existsSync } from "fs";
import { execSync } from "child_process";
import { connectWebSocket } from "../src/lib/connection.js";
import {
    ContractDeployer,
    pvmContractBuild,
    deployAllContracts,
} from "../src/lib/deployer.js";
import { detectDeploymentOrder } from "../src/lib/detection.js";
import { contracts } from "@polkadot-api/descriptors";
import { createInkSdk } from "@polkadot-api/sdk-ink";
import { CONTRACTS_REGISTRY_CRATE, ALICE_SS58 } from "../src/constants.js";

const NODE_URL = process.env.NODE_URL ?? "ws://127.0.0.1:10020";
const ROOT_DIR = resolve(import.meta.dir, "..");
const TEMPLATE_DIR = resolve(import.meta.dir, "../templates/shared-counter");

let deployer: ContractDeployer;
let registryAddr: string;

beforeAll(async () => {
    // Build the registry contract
    const registryPvm = resolve(
        ROOT_DIR,
        `target/${CONTRACTS_REGISTRY_CRATE}.release.polkavm`,
    );
    if (!existsSync(registryPvm)) {
        console.log("Building ContractRegistry...");
        pvmContractBuild(ROOT_DIR, CONTRACTS_REGISTRY_CRATE);
    }

    // Connect
    const { client, api } = connectWebSocket(NODE_URL);
    deployer = new ContractDeployer("Alice");
    deployer.setConnection(client, api);

    const chain = await client.getChainSpecData();
    console.log(`Connected to: ${chain.name}`);

    // Map account (ignore if already mapped)
    try {
        await api.tx.Revive.map_account().signAndSubmit(deployer.signer);
    } catch {}

    // Deploy registry
    console.log("Deploying ContractRegistry...");
    registryAddr = await deployer.deploy(registryPvm);
    console.log(`  Registry: ${registryAddr}`);
    deployer.setRegistry(registryAddr);
}, 120_000);

afterAll(() => {
    deployer?.client?.destroy();
});

describe("e2e: bootstrap deploy", () => {
    test("registry deploys and returns valid address", () => {
        expect(registryAddr).toMatch(/^0x[0-9a-f]{40}$/);
    }, 30_000);

    test("build shared-counter contracts with registry address", () => {
        const order = detectDeploymentOrder(TEMPLATE_DIR);
        for (const crateName of order.crateNames) {
            pvmContractBuild(TEMPLATE_DIR, crateName, registryAddr);
        }

        // Verify artifacts exist
        for (const crateName of order.crateNames) {
            const pvmPath = resolve(
                TEMPLATE_DIR,
                `target/${crateName}.release.polkavm`,
            );
            expect(existsSync(pvmPath)).toBe(true);
        }
    }, 300_000);

    test("deploy and register all shared-counter contracts", async () => {
        await deployAllContracts(deployer, TEMPLATE_DIR);

        // Verify last deployed address is set
        expect(deployer.lastDeployedAddr).toMatch(/^0x[0-9a-f]{40}$/);
    }, 120_000);

    test("query registry for deployed contract addresses", async () => {
        const inkSdk = createInkSdk(deployer.client);
        const registry = inkSdk.getContract(
            contracts.contractsRegistry,
            registryAddr,
        );

        // The shared-counter template has CDM packages for all 3 contracts
        const order = detectDeploymentOrder(TEMPLATE_DIR);
        for (let i = 0; i < order.crateNames.length; i++) {
            const cdmPackage = order.cdmPackages[i];
            if (!cdmPackage) continue;

            const result = await registry.query("getAddress", {
                origin: ALICE_SS58,
                data: { contract_name: cdmPackage },
            });

            expect(result.success).toBe(true);
            if (result.success) {
                expect(result.value.response).toMatch(/^0x[0-9a-f]{40}$/);
            }
        }
    }, 60_000);

    test("registry contract count matches deployed contracts", async () => {
        const inkSdk = createInkSdk(deployer.client);
        const registry = inkSdk.getContract(
            contracts.contractsRegistry,
            registryAddr,
        );

        const result = await registry.query("getContractCount", {
            origin: ALICE_SS58,
            data: {},
        });

        expect(result.success).toBe(true);
        if (result.success) {
            const order = detectDeploymentOrder(TEMPLATE_DIR);
            const cdmCount = order.cdmPackages.filter(Boolean).length;
            expect(result.value.response).toBe(cdmCount);
        }
    }, 30_000);
});
