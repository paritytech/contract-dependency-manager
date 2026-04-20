import type { PolkadotClient, TypedApi } from "polkadot-api";
import { createChainClient, type ChainClient } from "@polkadot-apps/chain-client";
import { assetHub, bulletin } from "@dotdm/descriptors";
import type { AssetHub, Bulletin } from "@dotdm/descriptors";
import { getChainPreset } from "./known_chains";

/**
 * Shape of a CDM chain client — both Asset Hub and Bulletin connected
 * under one `ChainClient` managed by `@polkadot-apps/chain-client`.
 *
 * Uses CDM's own `@dotdm/descriptors` for the chain descriptors so that
 * the resulting `TypedApi` types line up with the `ContractDeployer`,
 * `MetadataPublisher`, and `RegistryManager` constructors in
 * `@dotdm/contracts` (no casts required).
 */
export type CdmChainClient = ChainClient<{
    assetHub: typeof assetHub;
    bulletin: typeof bulletin;
}>;

/** Asset-Hub-only variant for callers that don't need Bulletin (e.g., `install`). */
export type CdmAssetHubClient = ChainClient<{
    assetHub: typeof assetHub;
}>;

export interface AssetHubConnection {
    client: PolkadotClient;
    api: TypedApi<AssetHub>;
}

export interface BulletinConnection {
    client: PolkadotClient;
    api: TypedApi<Bulletin>;
}

export interface CdmChainEndpoints {
    assethubUrl: string;
    bulletinUrl: string;
}

/**
 * Connect to both Asset Hub and Bulletin using `@polkadot-apps/chain-client`.
 *
 * Accepts either a known chain name (`"polkadot"`, `"paseo"`, `"local"`,
 * `"preview-net"`) resolved through `getChainPreset`, or explicit URLs.
 *
 * The returned `ChainClient` manages both connections — one `.destroy()`
 * call tears everything down. `chain-client` caches by genesis-hash
 * fingerprint, so repeated calls with the same descriptor set share a
 * single instance.
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

    return createChainClient({
        chains: { assetHub, bulletin },
        rpcs: {
            assetHub: [endpoints.assethubUrl],
            bulletin: [endpoints.bulletinUrl],
        },
    });
}

/**
 * Connect to Asset Hub only (no Bulletin). Used by commands that don't
 * publish metadata — e.g., `install`, `account map`, `deploy-registry`.
 */
export async function createCdmAssetHubClient(assethubUrl: string): Promise<CdmAssetHubClient> {
    return createChainClient({
        chains: { assetHub },
        rpcs: { assetHub: [assethubUrl] },
    });
}

export interface IpfsGateway {
    fetch: (cid: string) => Promise<Response>;
}

/**
 * Minimal IPFS gateway HTTP client used by `install` to fetch metadata JSON
 * by CID. Unrelated to chain-client; kept here alongside the chain-connection
 * factory for convenience.
 *
 * `@polkadot-apps/bulletin` offers gateway helpers (`getGateway`, `fetchBytes`,
 * `fetchJson`), but those key off a fixed `Environment` enum
 * (polkadot/kusama/paseo) and don't yet cover CDM's custom networks
 * (local, preview-net). Keep this thin wrapper until CDM can map its
 * `KNOWN_CHAINS` onto that enum.
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
