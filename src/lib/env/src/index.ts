export type { ChainPreset, KnownChainName } from "./known_chains";
export { KNOWN_CHAINS, getChainPreset } from "./known_chains";
export { DEFAULT_NODE_URL } from "@dotdm/utils";

export type { Connection, BulletinConnection } from "./connection";
export {
    detectConnectionType,
    connectWebSocket,
    connectBulletinWebSocket,
    connectSmoldot,
} from "./connection";

export { prepareSigner, prepareSignerFromSuri } from "./signer";
