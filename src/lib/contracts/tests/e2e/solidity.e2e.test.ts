// End-to-end Solidity pathway validation against a local PPN.
//
// Drives the REAL pipeline (`deployContracts` from @parity/cdm-builder) on a
// copy of the foundry-counter template and proves the parts of the Solidity
// story that only a live chain can prove:
//
//  - foundry contracts build to plain EVM bytecode (no resolc) and publish at
//    the version declared by the `@custom:cdm @org/name:X.Y.Z` NatSpec tag;
//  - the PolkaVM per-name proxy delegate-calls the EVM implementation —
//    cross-VM delegation is the load-bearing assumption of putting Solidity
//    contracts behind CDM's proxies;
//  - the layered deploy bakes dependency proxy addresses into downstream
//    contracts, so an EVM contract calls its dependency through the
//    dependency's stable address;
//  - the NatSpec version gates deploys end to end: redeploys skip as
//    up-to-date, a tag bump republished behind the same proxy keeps storage,
//    and `[MAGIC][key]` versioned calls pin the older version over it;
//  - initializations: the template's `initializations/CounterA/0.1.0.sol`
//    runs once inside the first publish and sets the owner, and a reverting
//    initialization rolls the whole publish back.
//
// Requires a running PPN and `forge` (foundry-polkadot fork) on PATH.

import { describe, test, expect, beforeAll, afterAll } from "vitest";
import {
    cpSync,
    mkdirSync,
    mkdtempSync,
    readdirSync,
    readFileSync,
    rmSync,
    writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { keccak_256 } from "@noble/hashes/sha3.js";
import type { HexString } from "polkadot-api";
import { createCdmChainClient, prepareSigner, type CdmChainClient } from "@parity/cdm-env";
import { ALICE_SS58 } from "@parity/cdm-utils";
import {
    CONTRACTS_REGISTRY_ABI,
    deployContracts,
    encodeVersionedCall,
    eoaH160FromPublicKey,
    generateSolidityLocalBuildImport,
    packVersionKey,
    type DeployEvent,
    type DeploySummary,
} from "@parity/cdm-builder";
import { createContractFromClient } from "@parity/product-sdk-contracts";
import { connectPpn, deployRegistry, dryRunCall, rawCallTx, type PpnHandle } from "./harness";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATE_DIR = resolve(__dirname, "../../../../../src/templates/foundry-counter");

// Unique per run so the suite holds on networks with prior registry state.
const RUN = Date.now().toString(36);
const NAME_A = `@test/sol-a-${RUN}`;
const NAME_B = `@test/sol-b-${RUN}`;
const KEY_0_1_0 = packVersionKey(0, 1, 0);
const KEY_0_2_0 = packVersionKey(0, 2, 0);

// The generated local-build import for NAME_A — its path is what CounterB
// must import and its `library` identifier is what CounterB's source calls.
// Derived through the real generator so the test can never drift from it.
const GENERATED_A = generateSolidityLocalBuildImport({
    library: NAME_A,
    contractName: "CounterA",
    sourceImportPath: "./unused.sol",
});
const LIB_A = GENERATED_A.content.match(/\blibrary (\w+)/)![1];

// keccak256(signature)[..4] as calldata hex.
function selector(signature: string): `0x${string}` {
    const hash = keccak_256(new TextEncoder().encode(signature)).subarray(0, 4);
    return `0x${Array.from(hash)
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("")}` as `0x${string}`;
}

const INCREMENT = selector("increment()");
const COUNT = selector("count()");
const OWNER = selector("owner()");
const INCREMENT_A = selector("incrementA()");
const READ_A = selector("readA()");

const PVM_MAGIC = [0x50, 0x56, 0x4d, 0x00]; // "PVM\0"

let ppn: PpnHandle;
let chainClient: CdmChainClient;
let registryAddress: HexString;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let api: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let signer: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let registry: any;
let projectDir: string;
let proxyA: string;
let proxyB: string;

function lc(v: unknown): string {
    return String(v).toLowerCase();
}

function rewrite(path: string, edits: Array<[string | RegExp, string]>): void {
    let content = readFileSync(path, "utf8");
    for (const [from, to] of edits) {
        content = content.replaceAll(from as string, to);
    }
    writeFileSync(path, content);
}

/** Run the real deploy pipeline on the temp project, collecting events. */
async function deploy(): Promise<{ summary: DeploySummary; events: DeployEvent[] }> {
    const events: DeployEvent[] = [];
    const summary = await deployContracts({
        rootDir: projectDir,
        client: chainClient,
        signer,
        origin: ALICE_SS58,
        registryAddress,
        onEvent: (event) => events.push(event),
    });
    return { summary, events };
}

function byCrate(summary: DeploySummary) {
    return new Map(summary.contracts.map((contract) => [contract.crate, contract]));
}

async function latestKey(name: string): Promise<bigint> {
    const r = await registry.getLatestKey.query(name);
    expect(r.success).toBe(true);
    return BigInt(r.value as bigint);
}

async function stableAddress(name: string): Promise<string> {
    const r = await registry.getAddress.query(name);
    const opt = r.value as { isSome: boolean; value: string };
    expect(opt.isSome).toBe(true);
    return String(opt.value);
}

async function countOf(dest: string): Promise<bigint> {
    const r = await dryRunCall(api, dest, COUNT);
    expect(r.success).toBe(true);
    expect(r.reverted).toBe(false);
    return BigInt(r.data);
}

beforeAll(async () => {
    ppn = await connectPpn();
    const deployed = await deployRegistry(ppn.wsUrl);
    registryAddress = deployed.address;

    signer = prepareSigner("Alice");
    chainClient = await createCdmChainClient({
        assethubUrl: ppn.wsUrl,
        bulletinUrl: ppn.bulletinUrl,
        chainName: "local",
    });
    await chainClient.raw.assetHub.getChainSpecData();
    api = chainClient.raw.assetHub.getUnsafeApi();

    registry = await createContractFromClient(
        chainClient.raw.assetHub,
        chainClient.descriptors.assetHub,
        deployed.address,
        CONTRACTS_REGISTRY_ABI,
        { defaultSigner: signer, defaultOrigin: ALICE_SS58 },
    );

    // A private copy of the template with per-run package names. CounterB's
    // import path and library identifier follow NAME_A's generated import.
    projectDir = mkdtempSync(join(tmpdir(), "cdm-solidity-e2e-"));
    cpSync(TEMPLATE_DIR, projectDir, { recursive: true });
    rewrite(join(projectDir, "contracts", "CounterA.sol"), [["@example/counter-a", NAME_A]]);
    rewrite(join(projectDir, "contracts", "CounterB.sol"), [
        ["@example/counter-b", NAME_B],
        ["../.cdm/solidity/example/counter-a.sol", `../${GENERATED_A.path}`],
        ["ExampleCounterA", LIB_A],
    ]);
}, 300_000);

afterAll(async () => {
    chainClient?.destroy();
    if (projectDir) rmSync(projectDir, { recursive: true, force: true });
});

describe("deploying the foundry template", () => {
    test("publishes both contracts at the NatSpec-tagged version, dependency first", async () => {
        const { summary, events } = await deploy();
        const detect = events.find((event) => event.type === "detect");
        expect(detect && detect.type === "detect").toBe(true);
        if (detect?.type !== "detect") throw new Error("unreachable");

        // Detection: two foundry targets, versions from the :X.Y.Z tag
        // suffix, CounterB layered after its CounterA dependency.
        const detected = new Map(detect.contracts.map((c) => [c.name, c]));
        expect(detected.get(NAME_A)?.toolchain).toBe("foundry");
        expect(detected.get(NAME_A)?.version).toBe("0.1.0");
        expect(detected.get(NAME_B)?.version).toBe("0.1.0");
        expect(detected.get(NAME_B)?.dependsOnCrates).toEqual([NAME_A]);
        expect(detect.layers).toEqual([[NAME_A], [NAME_B]]);

        // The template ships initializations/CounterA/0.1.0.sol — the
        // pipeline announces it for exactly this publish; CounterB has none.
        const initEvents = events.filter((event) => event.type === "initialization");
        expect(initEvents).toHaveLength(1);
        expect(initEvents[0]).toMatchObject({ crate: NAME_A, version: "0.1.0" });

        const contracts = byCrate(summary);
        expect(contracts.get(NAME_A)).toMatchObject({ status: "done", version: "0.1.0" });
        expect(contracts.get(NAME_B)).toMatchObject({ status: "done", version: "0.1.0" });

        // The published key is exactly the tag's version.
        expect(await latestKey(NAME_A)).toBe(KEY_0_1_0);
        expect(await latestKey(NAME_B)).toBe(KEY_0_1_0);

        // The summary addresses are the names' stable (per-name proxy)
        // addresses, not the implementation blobs.
        proxyA = await stableAddress(NAME_A);
        proxyB = await stableAddress(NAME_B);
        expect(lc(contracts.get(NAME_A)?.address)).toBe(lc(proxyA));
        expect(lc(contracts.get(NAME_B)?.address)).toBe(lc(proxyB));
    }, 240_000);

    test("the built artifacts are EVM bytecode, not PolkaVM blobs", () => {
        const outDir = join(projectDir, "target", "cdm", "foundry");
        // CounterA, CounterB, and CounterA's 0.1.0 initialization.
        const artifacts = readdirSync(outDir);
        expect(artifacts.length).toBe(3);
        for (const artifact of artifacts) {
            const bytes = readFileSync(join(outDir, artifact));
            expect(bytes.length).toBeGreaterThan(0);
            expect([...bytes.subarray(0, 4)]).not.toEqual(PVM_MAGIC);
        }
    });

    test("the initialization ran once inside the publish: owner is set", async () => {
        // initializations/CounterA/0.1.0.sol (Init_0_1_0 is CounterA) wrote
        // the publisher into CounterA's owner slot — through the proxy's
        // storage, delivered by the registry's callCode meta op.
        const alice = eoaH160FromPublicKey(signer.publicKey);
        const owner = await dryRunCall(api, proxyA, OWNER);
        expect(owner.reverted).toBe(false);
        expect(owner.data).toBe(`0x${alice.toLowerCase().replace(/^0x/, "").padStart(64, "0")}`);
    });

    test("a plain call through the PolkaVM proxy executes the EVM implementation", async () => {
        // THE cross-VM assertion: proxyA is a PolkaVM contract delegate-
        // calling solc-built EVM bytecode over the proxy's own storage.
        expect(await countOf(proxyA)).toBe(0n);
        await rawCallTx(api, signer, proxyA, INCREMENT);
        expect(await countOf(proxyA)).toBe(1n);
    });

    test("an EVM contract calls its dependency through the dependency's proxy", async () => {
        // The layer-two build baked proxyA's stable address into CounterB's
        // generated import: EVM (B) → PolkaVM proxy (A) → EVM (A).
        await rawCallTx(api, signer, proxyB, INCREMENT_A);
        expect(await countOf(proxyA)).toBe(2n);

        const readA = await dryRunCall(api, proxyB, READ_A);
        expect(readA.reverted).toBe(false);
        expect(BigInt(readA.data)).toBe(2n);
    });
});

describe("the NatSpec version gate", () => {
    test("an immediate second deploy skips everything as up-to-date", async () => {
        const { summary } = await deploy();
        const contracts = byCrate(summary);
        expect(contracts.get(NAME_A)).toMatchObject({
            status: "up-to-date",
            version: "0.1.0",
        });
        expect(contracts.get(NAME_B)).toMatchObject({
            status: "up-to-date",
            version: "0.1.0",
        });
        expect(await latestKey(NAME_A)).toBe(KEY_0_1_0);
    }, 120_000);

    test("a tag bump republishes behind the same proxy over the same storage", async () => {
        rewrite(join(projectDir, "contracts", "CounterA.sol"), [
            [`${NAME_A}:0.1.0`, `${NAME_A}:0.2.0`],
        ]);

        const { summary } = await deploy();
        const contracts = byCrate(summary);
        expect(contracts.get(NAME_A)).toMatchObject({ status: "done", version: "0.2.0" });
        expect(contracts.get(NAME_B)).toMatchObject({
            status: "up-to-date",
            version: "0.1.0",
        });
        expect(await latestKey(NAME_A)).toBe(KEY_0_2_0);

        // Same stable address, same storage: the counter written through
        // v0.1.0 reads back through v0.2.0.
        expect(lc(await stableAddress(NAME_A))).toBe(lc(proxyA));
        expect(await countOf(proxyA)).toBe(2n);
    }, 240_000);

    test("versioned calls pin the previous EVM implementation over shared storage", async () => {
        const pinnedRead = await dryRunCall(api, proxyA, encodeVersionedCall(KEY_0_1_0, COUNT));
        expect(pinnedRead.reverted).toBe(false);
        expect(BigInt(pinnedRead.data)).toBe(2n);

        // Write via pinned 0.1.0, read via latest 0.2.0: one counter.
        await rawCallTx(api, signer, proxyA, encodeVersionedCall(KEY_0_1_0, INCREMENT));
        expect(await countOf(proxyA)).toBe(3n);
    });
});

describe("a reverting initialization", () => {
    test("rolls back the entire publish", async () => {
        // Address 0.3.0 with an initialization that always reverts, then bump
        // CounterA's tag to 0.3.0: the version registration and both deploys
        // share one batch_all, so nothing lands.
        mkdirSync(join(projectDir, "contracts", "initializations", "CounterA"), {
            recursive: true,
        });
        writeFileSync(
            join(projectDir, "contracts", "initializations", "CounterA", "0.3.0.sol"),
            `// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.28;

import "../../CounterA.sol";

contract Init_0_3_0 is CounterA {
    error InitializationFailed();

    function initialize(uint128, address) external pure {
        revert InitializationFailed();
    }
}
`,
        );
        rewrite(join(projectDir, "contracts", "CounterA.sol"), [
            [`${NAME_A}:0.2.0`, `${NAME_A}:0.3.0`],
        ]);

        const { summary } = await deploy();
        const contracts = byCrate(summary);
        expect(contracts.get(NAME_A)?.status).toBe("error");

        // The registry never saw 0.3.0 and the storage is untouched.
        expect(await latestKey(NAME_A)).toBe(KEY_0_2_0);
        expect(await countOf(proxyA)).toBe(3n);
    }, 240_000);
});
