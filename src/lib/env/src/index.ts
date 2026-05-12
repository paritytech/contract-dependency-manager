export type {
    ChainPreset,
    ChainFaucet,
    KnownChainName,
    ProductSdkEnvironment,
} from "./known_chains";
export { KNOWN_CHAINS, findChainPresetByEndpoints, getChainPreset } from "./known_chains";
export { DEFAULT_NODE_URL, REGISTRY_ADDRESS } from "@dotdm/utils";

export type {
    AssetHubConnection,
    BulletinConnection,
    IpfsGateway,
    CdmChainClient,
    CdmAssetHubClient,
    CdmChainEndpoints,
    CdmAssetHubApi,
    CdmDeployAssetHubApi,
    CdmBulletinApi,
} from "./connection";
export { createCdmChainClient, createCdmAssetHubClient, connectIpfsGateway } from "./connection";

export {
    prepareSigner,
    prepareSignerFromSuri,
    prepareSignerFromMnemonic,
    ss58Address,
} from "./signer";
