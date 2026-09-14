// End-to-end cross-chain alignment: Bulletin storage ↔ Asset Hub registry ↔
// IPFS gateway
//
// Publishes real CDM metadata to the Bulletin chain, registers its CID for a
// package on the Asset Hub registry, then verifies the loop closes: the CID
// the registry hands out is fetchable from the network's IPFS gateway and
// decodes to exactly the metadata that was published.
//
// Gated to the `e2e/` directory by `vitest.e2e.config.ts`; run via
// `pnpm test:e2e` (requires a running PPN — see harness.ts).

import { describe, test, expect, beforeAll, afterAll } from "vitest";
import type { HexString } from "polkadot-api";
import { createCdmChainClient, prepareSigner, type CdmChainClient } from "@parity/cdm-env";
import { ALICE_SS58 } from "@parity/cdm-utils";
import { CONTRACTS_REGISTRY_ABI } from "@parity/cdm-builder/abi";
import { createContractFromClient } from "@parity/product-sdk-contracts";
// Source-module import for the same vitest tree-shaking reason as the ABI
// subpath imports above.
import { MetadataPublisher, type Metadata } from "../../src/publisher";
import { connectPpn, deployRegistry, type PpnHandle } from "./harness";

const RUN = Date.now().toString(36);
const NAME = `@test/bulletin-${RUN}`;
const ADDR = "0x4242424242424242424242424242424242424242" as HexString;

const METADATA: Metadata = {
    publish_block: 0,
    published_at: "2026-01-01T00:00:00.000Z",
    description: "Cross-chain alignment fixture",
    readme: `# Bulletin round-trip\n\nRun ${RUN}.`,
    authors: ["Parity Technologies"],
    homepage: "https://github.com/paritytech/contract-dependency-manager",
    repository: "https://github.com/paritytech/contract-dependency-manager",
    abi: [{ type: "function", name: "ping", inputs: [], outputs: [], stateMutability: "view" }],
};

let ppn: PpnHandle;
let client: CdmChainClient;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let registry: any;
let publishedCid: string;

beforeAll(async () => {
    ppn = await connectPpn();
    const deployed = await deployRegistry(ppn.wsUrl);

    const signer = prepareSigner("Alice");
    client = await createCdmChainClient({
        assethubUrl: ppn.wsUrl,
        bulletinUrl: ppn.bulletinUrl,
        chainName: "local",
    });
    registry = await createContractFromClient(
        client.raw.assetHub,
        client.descriptors.assetHub,
        deployed.address,
        CONTRACTS_REGISTRY_ABI,
        { defaultSigner: signer, defaultOrigin: ALICE_SS58 },
    );

    // 1) Store the metadata on the Bulletin chain.
    const publisher = new MetadataPublisher(signer, client.bulletin, client.raw.bulletin);
    const result = await publisher.publishBatch([METADATA]);
    publishedCid = result.cids[0];
}, 300_000);

afterAll(async () => {
    client?.destroy();
});

describe("bulletin ↔ asset hub ↔ gateway alignment", () => {
    test("metadata stored on Bulletin yields a CID", () => {
        expect(publishedCid).toMatch(/^baf/);
    });

    test("the registry records that CID for the package", async () => {
        const published = await registry.publishLatest.tx(NAME, ADDR, publishedCid);
        expect(published.ok).toBe(true);

        const uri = await registry.getMetadataUri.query(NAME);
        const opt = uri.value as { isSome: boolean; value: string };
        expect(opt.isSome).toBe(true);
        expect(opt.value).toBe(publishedCid);
    });

    test("the CID the registry hands out is served by the IPFS gateway and matches", async () => {
        const uri = await registry.getMetadataUri.query(NAME);
        const cid = (uri.value as { value: string }).value;

        // The gateway indexes Bulletin content with a small lag; retry briefly.
        let fetched: Metadata | undefined;
        for (let attempt = 0; attempt < 20 && !fetched; attempt++) {
            const res = await fetch(`${ppn.ipfsGatewayUrl}/${cid}`, {
                signal: AbortSignal.timeout(5000),
            }).catch(() => undefined);
            if (res?.ok) fetched = (await res.json()) as Metadata;
            else await new Promise((r) => setTimeout(r, 1500));
        }

        expect(fetched).toBeDefined();
        expect(fetched).toEqual(METADATA);
    });
});
