export type { ChainPreset, KnownChainName } from "./known_chains";
export { KNOWN_CHAINS, getChainPreset } from "./known_chains";
export { DEFAULT_NODE_URL } from "@dotdm/utils";

export type { AssetHubConnection, BulletinConnection } from "./connection";
export {
    detectConnectionType,
    connectAssetHubWebSocket,
    connectBulletinWebSocket,
    connectSmoldot,
} from "./connection";

export { prepareSigner, prepareSignerFromSuri } from "./signer";
