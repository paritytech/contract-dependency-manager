// End-to-end initializations validation against a local PPN.
//
// Initializations are version-addressed contracts that run exactly once,
// atomically, inside the publish of their version — delivered by the
// registry through the per-name proxy's admin-only `callCode` meta op,
// directly against the proxy's storage. This suite proves the full Rust
// matrix at the registry level:
//
//  - a first publish WITH an initialization sets state (owner, from = 0);
//  - a publish with no initialization behaves exactly as today;
//  - an upgrade publish's initialization transforms existing storage and
//    sees `from` = the previously-latest key;
//  - an initialization revert rolls back the ENTIRE publish;
//  - the freeze → publish-with-initialization → unfreeze window works, and
//    `callCode` at the proxy is registry-only.
//
// It also publishes the shared-counter template's real 0.1.0 initialization
// blob, so the shipped example is proven on-chain, not just compiled.

import { describe, test, expect, beforeAll, afterAll } from "vitest";
import { keccak_256 } from "@noble/hashes/sha3.js";
import type { HexString } from "polkadot-api";
import { createCdmAssetHubClient, prepareSigner, type CdmAssetHubClient } from "@parity/cdm-env";
import { ALICE_SS58 } from "@parity/cdm-utils";
import { CONTRACTS_REGISTRY_ABI } from "@parity/cdm-builder/abi";
import { eoaH160FromPublicKey } from "@parity/cdm-builder";
import {
    encodeInitialize,
    encodeProxyCallCode,
    encodeVersionedCall,
    packVersionKey,
} from "@parity/cdm-builder/proxy";
import { createContractFromClient } from "@parity/product-sdk-contracts";
import {
    connectPpn,
    deployRegistry,
    deployBlob,
    dryRunCall,
    ensureInitFixturesBuilt,
    ensureTemplateBuilt,
    rawCallTx,
    COUNTER_PVM,
    COUNTER_INIT_PVM,
    FIXTURE_COUNTER_PVM,
    FIXTURE_INIT_SET_OWNER_PVM,
    FIXTURE_INIT_TRANSFORM_PVM,
    FIXTURE_INIT_REVERT_PVM,
    type PpnHandle,
} from "./harness";

// Unique per run so the suite holds on networks with prior registry state.
const RUN = Date.now().toString(36);
const NAME = `@test/init-fix-${RUN}`;
const TEMPLATE_NAME = `@test/init-tpl-${RUN}`;
const URI = "ipfs://bafyinite2e";
const KEY_1_0_0 = packVersionKey(1, 0, 0);
const KEY_1_1_0 = packVersionKey(1, 1, 0);
const KEY_1_2_0 = packVersionKey(1, 2, 0);
const KEY_1_3_0 = packVersionKey(1, 3, 0);
const KEY_2_0_0 = packVersionKey(2, 0, 0);

// keccak256(signature)[..4] as calldata hex.
function selector(signature: string): `0x${string}` {
    const hash = keccak_256(new TextEncoder().encode(signature)).subarray(0, 4);
    return `0x${Array.from(hash)
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("")}` as `0x${string}`;
}

const INCREMENT = selector("increment()");
const GET_COUNT = selector("getCount()");
const GET_OWNER = selector("getOwner()");
const GET_LAST_INIT_FROM = selector("getLastInitFrom()");
const CONTRACT_FROZEN = selector("ContractFrozen()");

let ppn: PpnHandle;
let chainClient: CdmAssetHubClient;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let api: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let signer: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let registry: any;
let alice: string;
let implA: HexString;
let implB: HexString;
let initSetOwner: HexString;
let initTransform: HexString;
let initRevert: HexString;
let proxyAddress: string;

function lc(v: unknown): string {
    return String(v).toLowerCase();
}

async function read(input: string): Promise<bigint> {
    const r = await dryRunCall(api, proxyAddress, input);
    expect(r.success).toBe(true);
    expect(r.reverted).toBe(false);
    return BigInt(r.data);
}

async function versionCount(name: string): Promise<number> {
    const r = await registry.getVersionCount.query(name);
    expect(r.success).toBe(true);
    return Number(r.value);
}

async function latestKey(name: string): Promise<bigint> {
    const r = await registry.getLatestKey.query(name);
    expect(r.success).toBe(true);
    return BigInt(r.value as bigint);
}

beforeAll(async () => {
    ppn = await connectPpn();
    const deployed = await deployRegistry(ppn.wsUrl);
    await ensureTemplateBuilt();
    await ensureInitFixturesBuilt();

    signer = prepareSigner("Alice");
    alice = eoaH160FromPublicKey(signer.publicKey);
    chainClient = await createCdmAssetHubClient(ppn.wsUrl, "local");
    await chainClient.raw.assetHub.getChainSpecData();
    api = chainClient.raw.assetHub.getUnsafeApi();

    registry = await createContractFromClient(
        chainClient.raw.assetHub,
        chainClient.descriptors.assetHub,
        deployed.address,
        CONTRACTS_REGISTRY_ABI,
        { defaultSigner: signer, defaultOrigin: ALICE_SS58 },
    );

    // Two instances of the fixture implementation (versions 1.0.0 / 1.1.0 of
    // one name) plus the three initialization blobs.
    implA = await deployBlob(api, signer, FIXTURE_COUNTER_PVM);
    implB = await deployBlob(api, signer, FIXTURE_COUNTER_PVM);
    initSetOwner = await deployBlob(api, signer, FIXTURE_INIT_SET_OWNER_PVM);
    initTransform = await deployBlob(api, signer, FIXTURE_INIT_TRANSFORM_PVM);
    initRevert = await deployBlob(api, signer, FIXTURE_INIT_REVERT_PVM);
}, 300_000);

afterAll(async () => {
    chainClient?.destroy();
});

describe("built artifacts", () => {
    test("freshly built Rust artifacts carry storage layouts (toolchain regression guard)", async () => {
        const { readFileSync } = await import("node:fs");
        const layout = (pvmPath: string) =>
            JSON.parse(readFileSync(pvmPath.replace(/\.polkavm$/, ".abi.json"), "utf8"))
                .storageLayout;
        // Bare auto-numbered storage emits layouts since cargo-pvm-contract#155
        // — if these go missing, the deploy-time guard has silently degraded.
        const impl = layout(COUNTER_PVM);
        const init = layout(COUNTER_INIT_PVM);
        expect(impl?.storage?.length).toBeGreaterThan(0);
        expect(init?.storage).toEqual(impl.storage);
        expect(layout(FIXTURE_COUNTER_PVM)?.storage?.length).toBeGreaterThan(0);
    });
});

describe("first publish with initialization", () => {
    test("publishWithInit records the version and runs initialize(0, owner)", async () => {
        const r = await registry.publishWithInit.tx(NAME, KEY_1_0_0, implA, URI, initSetOwner);
        expect(r.ok).toBe(true);

        const proxy = await registry.getProxy.query(NAME);
        const opt = proxy.value as { isSome: boolean; value: string };
        expect(opt.isSome).toBe(true);
        proxyAddress = String(opt.value);

        // The initialization ran against the PROXY's storage: the owner and
        // the from key (0 — first publish) read back through the plain plane.
        expect(lc((await dryRunCall(api, proxyAddress, GET_OWNER)).data)).toBe(
            `0x${alice.toLowerCase().replace(/^0x/, "").padStart(64, "0")}`,
        );
        expect(await read(GET_LAST_INIT_FROM)).toBe(0n);
        expect(await latestKey(NAME)).toBe(KEY_1_0_0);
        expect(await versionCount(NAME)).toBe(1);
    });

    test("the initialization contract holds none of the state", async () => {
        // Structural point: initialize wrote through delegatecall, so the state
        // lives in the proxy; the initialization contract only knows initialize.
        const ownerAtProxy = await dryRunCall(api, proxyAddress, GET_OWNER);
        expect(BigInt(ownerAtProxy.data)).not.toBe(0n);
        const direct = await dryRunCall(api, initSetOwner, GET_OWNER);
        expect(direct.reverted).toBe(true);
    });
});

describe("publish with no initialization", () => {
    test("a plain publish behaves exactly as before", async () => {
        await rawCallTx(api, signer, proxyAddress, INCREMENT);
        await rawCallTx(api, signer, proxyAddress, INCREMENT);
        expect(await read(GET_COUNT)).toBe(2n);

        const r = await registry.publish.tx(NAME, KEY_1_1_0, implB, URI);
        expect(r.ok).toBe(true);
        expect(await latestKey(NAME)).toBe(KEY_1_1_0);
        // No initialization: state is untouched.
        expect(await read(GET_COUNT)).toBe(2n);
        expect(await read(GET_LAST_INIT_FROM)).toBe(0n);
    });
});

describe("upgrade publish with a transforming initialization", () => {
    test("the initialization reshapes storage and sees from = previous latest", async () => {
        const r = await registry.publishWithInit.tx(NAME, KEY_1_2_0, implA, URI, initTransform);
        expect(r.ok).toBe(true);

        // count doubled 2 → 4 by the initialization, atomically with the publish.
        expect(await read(GET_COUNT)).toBe(4n);
        expect(await read(GET_LAST_INIT_FROM)).toBe(KEY_1_1_0);
        expect(await latestKey(NAME)).toBe(KEY_1_2_0);
    });

    test("old versions read the transformed state through versioned calls", async () => {
        // One storage: the 1.0.0 implementation sees the transformed count.
        const pinned = await dryRunCall(
            api,
            proxyAddress,
            encodeVersionedCall(KEY_1_0_0, GET_COUNT),
        );
        expect(pinned.reverted).toBe(false);
        expect(BigInt(pinned.data)).toBe(4n);
    });
});

describe("initialization revert rolls back the publish", () => {
    test("a reverting initialize fails the whole publishWithInit", async () => {
        const before = await versionCount(NAME);
        const r = await registry.publishWithInit.tx(NAME, KEY_1_3_0, implB, URI, initRevert);
        expect(r.ok).toBe(false);

        // Nothing moved: version count, latest key, and storage all intact.
        expect(await versionCount(NAME)).toBe(before);
        expect(await latestKey(NAME)).toBe(KEY_1_2_0);
        expect(await read(GET_COUNT)).toBe(4n);
        expect(await read(GET_LAST_INIT_FROM)).toBe(KEY_1_1_0);
    });

    test("the revert reason surfaces through a dry-run", async () => {
        const dry = await registry.publishWithInit.query(NAME, KEY_1_3_0, implB, URI, initRevert, {
            origin: ALICE_SS58,
        });
        expect(dry.success).toBe(false);
    });
});

describe("freeze window", () => {
    test("freeze → publish-with-initialization → unfreeze", async () => {
        const freeze = await registry.freezeContract.tx(NAME);
        expect(freeze.ok).toBe(true);

        // Delegation is halted...
        const frozenRead = await dryRunCall(api, proxyAddress, GET_COUNT);
        expect(frozenRead.reverted).toBe(true);
        expect(frozenRead.data.startsWith(CONTRACT_FROZEN)).toBe(true);

        // ...but the publish + initialization land through the meta plane.
        const r = await registry.publishWithInit.tx(NAME, KEY_2_0_0, implB, URI, initTransform);
        expect(r.ok).toBe(true);

        const unfreeze = await registry.unfreezeContract.tx(NAME);
        expect(unfreeze.ok).toBe(true);

        // count doubled again (4 → 8) while frozen; from = 1.2.0.
        expect(await read(GET_COUNT)).toBe(8n);
        expect(await read(GET_LAST_INIT_FROM)).toBe(KEY_1_2_0);
        expect(await latestKey(NAME)).toBe(KEY_2_0_0);
    });
});

describe("structural authorization", () => {
    test("callCode at the proxy is registry-only", async () => {
        const calldata = encodeProxyCallCode(initTransform, encodeInitialize(0n, alice));
        const r = await dryRunCall(api, proxyAddress, calldata);
        expect(r.success).toBe(true);
        expect(r.reverted).toBe(true);
        // count is untouched — nobody but the registry reaches initialize.
        expect(await read(GET_COUNT)).toBe(8n);
    });

    test("publishWithInit rejects a zero initialization target", async () => {
        const dry = await registry.publishWithInit.query(
            NAME,
            packVersionKey(2, 0, 1),
            implB,
            URI,
            "0x0000000000000000000000000000000000000000",
            { origin: ALICE_SS58 },
        );
        expect(dry.success).toBe(false);
    });
});

describe("the shared-counter template example", () => {
    test("the shipped initializations/0.1.0.rs sets the owner on first publish", async () => {
        const impl = await deployBlob(api, signer, COUNTER_PVM);
        const init = await deployBlob(api, signer, COUNTER_INIT_PVM);

        const r = await registry.publishWithInit.tx(
            TEMPLATE_NAME,
            packVersionKey(0, 1, 0),
            impl,
            URI,
            init,
        );
        expect(r.ok).toBe(true);

        const proxy = await registry.getProxy.query(TEMPLATE_NAME);
        const templateProxy = String((proxy.value as { value: string }).value);
        const owner = await dryRunCall(api, templateProxy, GET_OWNER);
        expect(owner.reverted).toBe(false);
        expect(lc(owner.data)).toBe(
            `0x${alice.toLowerCase().replace(/^0x/, "").padStart(64, "0")}`,
        );
    });
});
