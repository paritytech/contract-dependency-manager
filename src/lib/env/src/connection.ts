import { createClient } from "polkadot-api";
import type { PolkadotClient, TypedApi } from "polkadot-api";
import { getSmProvider } from "polkadot-api/sm-provider";
import { start } from "polkadot-api/smoldot";
import { getWsProvider } from "polkadot-api/ws-provider";
import { withPolkadotSdkCompat } from "polkadot-api/polkadot-sdk-compat";
import { assetHub, bulletin } from "@polkadot-api/descriptors";
import type { AssetHub, Bulletin } from "@polkadot-api/descriptors";

export interface AssetHubConnection {
    client: PolkadotClient;
    api: TypedApi<AssetHub>;
}

/**
 * Detect connection type from URL.
 * - ws:// or wss:// -> WebSocket
 * - file path -> smoldot with chainspec
 */
export function detectConnectionType(url: string): "websocket" | "smoldot" {
    if (url.startsWith("ws://") || url.startsWith("wss://")) {
        return "websocket";
    }
    return "smoldot";
}

/**
 * Connect to a chain via WebSocket.
 */
export function connectAssetHubWebSocket(url: string): AssetHubConnection {
    const client = createClient(withPolkadotSdkCompat(getWsProvider(url)));
    return { client, api: client.getTypedApi(assetHub) };
}

export interface BulletinConnection {
    client: PolkadotClient;
    api: TypedApi<Bulletin>;
}

/**
 * Connect to the Bulletin chain via WebSocket.
 */
export function connectBulletinWebSocket(url: string): BulletinConnection {
    const client = createClient(withPolkadotSdkCompat(getWsProvider(url)));
    return { client, api: client.getTypedApi(bulletin) };
}

/**
 * Connect to a parachain via smoldot light client.
 *
 * @param parachainChainspec - Path to the parachain chainspec JSON file
 * @param relayChainspec - Path to the relay chain chainspec JSON file
 */
export async function connectSmoldot(
    parachainChainspec: string,
    relayChainspec: string,
): Promise<AssetHubConnection> {
    const smoldot = start();

    const { readFileSync } = await import("fs");
    const relaySpec = readFileSync(relayChainspec, "utf-8");
    const parachainSpec = readFileSync(parachainChainspec, "utf-8");

    const relayChain = await smoldot.addChain({ chainSpec: relaySpec });
    const parachain = await smoldot.addChain({
        chainSpec: parachainSpec,
        potentialRelayChains: [relayChain],
    });

    const client = createClient(getSmProvider(parachain));
    return { client, api: client.getTypedApi(assetHub) };
}
