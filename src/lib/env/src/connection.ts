import {
    createClient,
    type ChainDefinition,
    type PolkadotClient,
    type TypedApi,
} from "polkadot-api";
import { getWsProvider } from "polkadot-api/ws";
import { paseo_asset_hub } from "@parity/product-sdk-descriptors/paseo-asset-hub";
import { bulletin } from "@parity/product-sdk-descriptors/bulletin";
import { getChainPreset } from "./known_chains";

export type CdmDirectChainClient<TChains extends Record<string, ChainDefinition>> = {
    [K in keyof TChains]: TypedApi<TChains[K]>;
} & {
    raw: { [K in keyof TChains]: PolkadotClient };
    destroy: () => void;
};

/**
 * Shape of a CDM chain client — both Asset Hub and Bulletin connected
 * under one chain-client-shaped object.
 *
 * Uses `@parity/product-sdk-descriptors` for the chain descriptors so the
 * resulting `TypedApi` types line up natively with `ContractDeployer`,
 * `MetadataPublisher`, and the product-sdk batch/bulletin helpers
 * (no casts required). We pin AssetHub to the Paseo flavor — it's the
 * primary test target, and the pallet surface matches Polkadot/Kusama
 * AssetHub at the queries/txs we use.
 */
export type CdmChainClient = CdmDirectChainClient<{
    assetHub: typeof paseo_asset_hub;
    bulletin: typeof bulletin;
}>;

/** Asset-Hub-only variant for callers that don't need Bulletin (e.g., `install`). */
export type CdmAssetHubClient = CdmDirectChainClient<{
    assetHub: typeof paseo_asset_hub;
}>;

export interface AssetHubConnection {
    client: PolkadotClient;
    api: TypedApi<typeof paseo_asset_hub>;
}

export interface BulletinConnection {
    client: PolkadotClient;
    api: TypedApi<typeof bulletin>;
}

export interface CdmChainEndpoints {
    assethubUrl: string;
    bulletinUrl: string;
}

/**
 * Connect to both Asset Hub and Bulletin over direct WebSocket RPC.
 *
 * Accepts either a known chain name (`"polkadot"`, `"paseo"`, `"local"`,
 * `"preview-net"`) resolved through `getChainPreset`, or explicit URLs.
 *
 * The returned object matches product-sdk's `ChainClient` shape closely enough
 * for callers to pass either one into CDM APIs. CDM builds this locally because
 * product-sdk's published chain-client is host-provider-only and ignores RPC
 * URLs, while the CLI must keep working as a standalone process.
 */
export async function createCdmChainClient(
    arg: string | CdmChainEndpoints,
): Promise<CdmChainClient> {
    const endpoints =
        typeof arg === "string"
            ? {
                  assethubUrl: getChainPreset(arg).assethubUrl,
                  bulletinUrl: getChainPreset(arg).bulletinUrl,
              }
            : arg;

    return createDirectChainClient(
        { assetHub: paseo_asset_hub, bulletin },
        { assetHub: endpoints.assethubUrl, bulletin: endpoints.bulletinUrl },
    );
}

/**
 * Connect to Asset Hub only (no Bulletin). Used by commands that don't
 * publish metadata — e.g., `install`, `account map`, `deploy-registry`.
 */
export async function createCdmAssetHubClient(assethubUrl: string): Promise<CdmAssetHubClient> {
    return createDirectChainClient({ assetHub: paseo_asset_hub }, { assetHub: assethubUrl });
}

export interface IpfsGateway {
    fetch: (cid: string) => Promise<Response>;
}

/**
 * Minimal IPFS gateway HTTP client used by `install` to fetch metadata JSON
 * by CID. Unrelated to chain-client; kept here alongside the chain-connection
 * factory for convenience.
 *
 * Product SDK's Bulletin read helpers go through the host preimage
 * subscription and do not cover CDM's custom gateway URLs (local,
 * preview-net). Keep this thin wrapper for install flows.
 */
export function connectIpfsGateway(url: string): IpfsGateway {
    return {
        fetch: (cid: string) =>
            globalThis.fetch(`${url}/${cid}`, { signal: AbortSignal.timeout(15_000) }).then((r) => {
                if (!r.ok) throw new Error(`IPFS fetch failed: ${r.statusText}`);
                return r;
            }),
    };
}

function createDirectChainClient<const TChains extends Record<string, ChainDefinition>>(
    chains: TChains,
    rpcs: { [K in keyof TChains]: string },
): CdmDirectChainClient<TChains> {
    const apis = {} as { [K in keyof TChains]: TypedApi<TChains[K]> };
    const raw = {} as { [K in keyof TChains]: PolkadotClient };

    for (const name of Object.keys(chains) as Array<keyof TChains>) {
        const client = createClient(getWsProvider(rpcs[name]));
        raw[name] = client;
        apis[name] = client.getTypedApi(chains[name]);
    }

    return {
        ...apis,
        raw,
        destroy() {
            for (const client of Object.values(raw)) {
                client.destroy();
            }
        },
    } as CdmDirectChainClient<TChains>;
}
