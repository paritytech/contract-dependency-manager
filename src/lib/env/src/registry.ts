export type ProductSdkEnvironment = "paseo" | "summit";

const POLKADOT_REGISTRY_ADDRESS = "";
const PASEO_REGISTRY_ADDRESS = "0xf62c2ece29cd8df2e10040ecfa5a894a5c5d9cb0";
const W3S_REGISTRY_ADDRESS = "0xa5747e60ae27f93e92019e4021abfc4957050141";
const LOCAL_REGISTRY_ADDRESS = "";

export function getRegistryAddress(name = "paseo"): string {
    if (name === "paseo" || name === "paseo-next-v2" || name === "paseo-v2") {
        return PASEO_REGISTRY_ADDRESS;
    }
    if (name === "polkadot") {
        return POLKADOT_REGISTRY_ADDRESS;
    }
    if (name === "w3s") {
        return W3S_REGISTRY_ADDRESS;
    }
    if (name === "local") {
        return LOCAL_REGISTRY_ADDRESS;
    }
    return "";
}
