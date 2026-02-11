import { createClient, PolkadotClient, TypedApi } from "polkadot-api";
import { getSmProvider } from "polkadot-api/sm-provider";
import { start } from "polkadot-api/smoldot";
import { getWsProvider } from "polkadot-api/ws-provider/node";
import { withPolkadotSdkCompat } from "polkadot-api/polkadot-sdk-compat";
import { AssetHub, assetHub } from "@polkadot-api/descriptors";
import { readFileSync } from "fs";

export interface Connection {
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
export function connectWebSocket(url: string): Connection {
    const client = createClient(withPolkadotSdkCompat(getWsProvider(url)));
    return { client, api: client.getTypedApi(assetHub) };
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
): Promise<Connection> {
    const smoldot = start();

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
