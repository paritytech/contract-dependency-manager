import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { resolve } from "path";
import { existsSync } from "fs";
import { connectWebSocket } from "../src/lib/connection.js";
import { ContractDeployer } from "../src/lib/deployer.js";
import { pvmContractBuild } from "../src/lib/builder.js";
import { executePipeline } from "../src/lib/pipeline.js";
import { detectDeploymentOrder } from "../src/lib/detection.js";
import { prepareSigner } from "../src/lib/signer.js";
import { contracts } from "@polkadot-api/descriptors";
import { createInkSdk } from "@polkadot-api/sdk-ink";
import { ALICE_SS58 } from "@dotdm/utils";
import { CONTRACTS_REGISTRY_CRATE } from "../src/constants.js";

const NODE_URL = process.env.NODE_URL ?? "ws://127.0.0.1:10020";
const ROOT_DIR = resolve(import.meta.dir, "../../../..");
const TEMPLATE_DIR = resolve(import.meta.dir, "../../../templates/shared-counter");

let deployer: ContractDeployer;
let client: ReturnType<typeof connectWebSocket>["client"];
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
    const conn = connectWebSocket(NODE_URL);
    client = conn.client;
    const signer = prepareSigner("Alice");
    deployer = new ContractDeployer(signer, conn.client, conn.api);

    const chain = await conn.client.getChainSpecData();
    console.log(`Connected to: ${chain.name}`);

    // Map account (ignore if already mapped)
    try {
        await conn.api.tx.Revive.map_account().signAndSubmit(deployer.signer);
    } catch {}

    // Deploy registry
    console.log("Deploying ContractRegistry...");
    const result = await deployer.deploy(registryPvm);
    registryAddr = result.address;
    console.log(`  Registry: ${registryAddr}`);
}, 120_000);

afterAll(() => {
    client?.destroy();
});

describe("e2e: bootstrap deploy", () => {
    test("registry deploys and returns valid address", () => {
        expect(registryAddr).toMatch(/^0x[0-9a-fA-F]{40}$/);
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

        // Verify CDM metadata files
        for (const crateName of order.crateNames) {
            const cdmPath = resolve(
                TEMPLATE_DIR,
                `target/${crateName}.release.cdm.json`,
            );
            expect(existsSync(cdmPath)).toBe(true);
        }
    }, 300_000);

    test("deploy and register all shared-counter contracts", async () => {
        const result = await executePipeline({ rootDir: TEMPLATE_DIR });
        const addresses = result.addresses;

        // Verify addresses returned for all contracts
        const order = detectDeploymentOrder(TEMPLATE_DIR);
        for (const crateName of order.crateNames) {
            expect(addresses[crateName]).toMatch(/^0x[0-9a-fA-F]{40}$/);
        }
    }, 300_000);

    test("query registry for deployed contract addresses", async () => {
        const inkSdk = createInkSdk(client);
        const registry = inkSdk.getContract(
            contracts.contractsRegistry,
            registryAddr,
        );

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
                expect(result.value.response).toMatch(/^0x[0-9a-fA-F]{40}$/);
            }
        }
    }, 60_000);

    test("counter_writer increments and counter_reader reads the shared counter", async () => {
        const inkSdk = createInkSdk(client);

        // Resolve deployed addresses from registry
        const registry = inkSdk.getContract(
            contracts.contractsRegistry,
            registryAddr,
        );
        const getAddr = async (cdmName: string) => {
            const r = await registry.query("getAddress", {
                origin: ALICE_SS58,
                data: { contract_name: cdmName },
            });
            expect(r.success).toBe(true);
            return r.success ? r.value.response : "";
        };

        const counter = inkSdk.getContract(
            contracts.counter,
            await getAddr("@example/counter"),
        );
        const reader = inkSdk.getContract(
            contracts.counterReader,
            await getAddr("@example/counter-reader"),
        );
        const writer = inkSdk.getContract(
            contracts.counterWriter,
            await getAddr("@example/counter-writer"),
        );

        // Read initial count via counter_reader (goes through CDM to counter)
        const initial = await reader.query("readCount", {
            origin: ALICE_SS58,
            data: {},
        });
        expect(initial.success).toBe(true);
        const initialCount = initial.success ? initial.value.response : 0;

        // Increment via counter_writer (goes through CDM to counter)
        await writer
            .send("writeIncrement", {
                data: {},
                gasLimit: { ref_time: 10_000_000_000n, proof_size: 262_144n },
                storageDepositLimit: 500_000_000_000n,
            })
            .signAndSubmit(deployer.signer);

        // Read count again via counter_reader — should be initialCount + 1
        const after = await reader.query("readCount", {
            origin: ALICE_SS58,
            data: {},
        });
        expect(after.success).toBe(true);
        if (after.success) {
            expect(after.value.response).toBe(initialCount + 1);
        }

        // Also verify directly on counter contract — should match
        const direct = await counter.query("getCount", {
            origin: ALICE_SS58,
            data: {},
        });
        expect(direct.success).toBe(true);
        if (direct.success) {
            expect(direct.value.response).toBe(initialCount + 1);
        }
    }, 120_000);

    test("registry contract count matches deployed contracts", async () => {
        const inkSdk = createInkSdk(client);
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
