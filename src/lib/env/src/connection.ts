import {
    createClient,
    type ChainDefinition,
    type PolkadotClient,
    type TypedApi,
} from "polkadot-api";
import { getWsProvider } from "polkadot-api/ws";
import { polkadot_asset_hub } from "@parity/product-sdk-descriptors/polkadot-asset-hub";
import { paseo_asset_hub } from "@parity/product-sdk-descriptors/paseo-asset-hub";
import { paseo_bulletin } from "@parity/product-sdk-descriptors/paseo-bulletin";
import { summit_asset_hub } from "@parity/product-sdk-descriptors/summit-asset-hub";
import { summit_bulletin } from "@parity/product-sdk-descriptors/summit-bulletin";
import { getChainPreset, normalizeChainName, type KnownChainName } from "./known_chains";

export type CdmDirectChainClient<TChains extends Record<string, ChainDefinition>> = {
    [K in keyof TChains]: TypedApi<TChains[K]>;
} & {
    raw: { [K in keyof TChains]: PolkadotClient };
    descriptors: TChains;
    destroy: () => void;
};

export type CdmDeployAssetHubDescriptor = typeof paseo_asset_hub | typeof summit_asset_hub;
export type CdmAssetHubDescriptor = CdmDeployAssetHubDescriptor | typeof polkadot_asset_hub;
export type CdmBulletinDescriptor = typeof paseo_bulletin | typeof summit_bulletin;

export type CdmDeployAssetHubApi = TypedApi<CdmDeployAssetHubDescriptor>;
export type CdmAssetHubApi = TypedApi<CdmAssetHubDescriptor>;
export type CdmBulletinApi = TypedApi<CdmBulletinDescriptor>;

/**
 * Shape of a CDM chain client — both Asset Hub and Bulletin connected
 * under one chain-client-shaped object.
 *
 * Uses `@parity/product-sdk-descriptors` for the chain descriptors so the
 * resulting `TypedApi` types line up natively with `ContractDeployer`,
 * `MetadataPublisher`, and the product-sdk batch/bulletin helpers.
 */
export type CdmChainClient = {
    assetHub: CdmDeployAssetHubApi;
    bulletin: CdmBulletinApi;
    raw: { assetHub: PolkadotClient; bulletin: PolkadotClient };
    descriptors: { assetHub: CdmDeployAssetHubDescriptor; bulletin: CdmBulletinDescriptor };
    destroy: () => void;
};

/** Asset-Hub-only variant for callers that don't need Bulletin (e.g., `install`). */
export type CdmAssetHubClient = {
    assetHub: CdmAssetHubApi;
    raw: { assetHub: PolkadotClient };
    descriptors: { assetHub: CdmAssetHubDescriptor };
    destroy: () => void;
};

export interface AssetHubConnection {
    client: PolkadotClient;
    api: CdmAssetHubApi;
}

export interface BulletinConnection {
    client: PolkadotClient;
    api: CdmBulletinApi;
}

export interface CdmChainEndpoints {
    assethubUrl: string;
    bulletinUrl: string;
    chainName?: string;
}

const DEPLOY_CHAIN_DESCRIPTORS = {
    paseo: { assetHub: paseo_asset_hub, bulletin: paseo_bulletin },
    w3s: { assetHub: summit_asset_hub, bulletin: summit_bulletin },
    local: { assetHub: paseo_asset_hub, bulletin: paseo_bulletin },
} as const;

const ASSET_HUB_DESCRIPTORS = {
    polkadot: polkadot_asset_hub,
    paseo: paseo_asset_hub,
    w3s: summit_asset_hub,
    local: paseo_asset_hub,
} as const;

function resolveExplicitChainName(chainName: string): KnownChainName | "custom" {
    const normalized = normalizeChainName(chainName);
    if (!normalized) {
        throw new Error(
            `Unknown chain "${chainName}". Valid names: polkadot, paseo, w3s, local, custom`,
        );
    }
    return normalized;
}

function resolveAssetHubDescriptors(chainName: string | undefined) {
    const normalized = chainName ? resolveExplicitChainName(chainName) : undefined;
    return ASSET_HUB_DESCRIPTORS[normalized && normalized !== "custom" ? normalized : "paseo"];
}

function resolveDeployDescriptors(chainName: string | undefined) {
    const normalized = chainName ? resolveExplicitChainName(chainName) : undefined;
    const descriptorChain = normalized && normalized !== "custom" ? normalized : "paseo";
    if (descriptorChain === "polkadot") {
        throw new Error(
            'CDM deploy connections are only available for "paseo", "w3s", and "local"; product-sdk does not publish a Polkadot Bulletin descriptor yet.',
        );
    }

    return DEPLOY_CHAIN_DESCRIPTORS[descriptorChain];
}

/**
 * Connect to both Asset Hub and Bulletin over direct WebSocket RPC.
 *
 * Accepts either a supported deploy chain name (`"paseo"` or `"local"`)
 * resolved through `getChainPreset`, or explicit URLs. Polkadot remains
 * available for Asset-Hub-only install reads, but product-sdk does not publish
 * a Polkadot Bulletin descriptor yet.
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
                  chainName: arg,
              }
            : arg;

    return createDirectChainClient(resolveDeployDescriptors(endpoints.chainName), {
        assetHub: endpoints.assethubUrl,
        bulletin: endpoints.bulletinUrl,
    }) as CdmChainClient;
}

/**
 * Connect to Asset Hub only (no Bulletin). Used by commands that don't
 * publish metadata — e.g., `install`, `account map`, `deploy-registry`.
 */
export async function createCdmAssetHubClient(
    assethubUrl: string,
    chainName?: string,
): Promise<CdmAssetHubClient> {
    return createDirectChainClient(
        { assetHub: resolveAssetHubDescriptors(chainName) },
        { assetHub: assethubUrl },
    ) as CdmAssetHubClient;
}

export interface IpfsGateway {
    fetch: (cid: string) => Promise<Response>;
}

function joinGatewayUrl(url: string, cid: string): string {
    return `${url.replace(/\/+$/, "")}/${cid.replace(/^\/+/, "")}`;
}

/**
 * Minimal IPFS gateway HTTP client used by `install` to fetch metadata JSON
 * by CID. Unrelated to chain-client; kept here alongside the chain-connection
 * factory for convenience.
 *
 * Product SDK's Bulletin read helpers go through the host preimage
 * subscription and do not cover CDM's custom gateway URLs (local/custom).
 * Keep this thin wrapper for install flows.
 */
export function connectIpfsGateway(url: string): IpfsGateway {
    return {
        fetch: (cid: string) =>
            globalThis
                .fetch(joinGatewayUrl(url, cid), { signal: AbortSignal.timeout(15_000) })
                .then((r) => {
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
        descriptors: chains,
        destroy() {
            for (const client of Object.values(raw)) {
                client.destroy();
            }
        },
    } as CdmDirectChainClient<TChains>;
}

if (import.meta.vitest) {
    const { test, expect } = import.meta.vitest;

    test("local deploy connections use paseo descriptors", () => {
        const descriptors = resolveDeployDescriptors("local");

        expect(descriptors.assetHub).toBe(paseo_asset_hub);
        expect(descriptors.bulletin).toBe(paseo_bulletin);
    });

    test("w3s deploy connections use summit descriptors", () => {
        const descriptors = resolveDeployDescriptors("w3s");

        expect(descriptors.assetHub).toBe(summit_asset_hub);
        expect(descriptors.bulletin).toBe(summit_bulletin);
    });
}
