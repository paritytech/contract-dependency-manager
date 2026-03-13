export type { ChainPreset, ChainFaucet, KnownChainName } from "./known_chains";
export { KNOWN_CHAINS, getChainPreset } from "./known_chains";
export { DEFAULT_NODE_URL, REGISTRY_ADDRESS } from "@dotdm/utils";

export type { AssetHubConnection, BulletinConnection, IpfsGateway } from "./connection";
export {
    detectConnectionType,
    connectAssetHubWebSocket,
    connectBulletinWebSocket,
    connectSmoldot,
    connectIpfsGateway,
} from "./connection";

export {
    prepareSigner,
    prepareSignerFromSuri,
    prepareSignerFromMnemonic,
    ss58Address,
} from "./signer";
