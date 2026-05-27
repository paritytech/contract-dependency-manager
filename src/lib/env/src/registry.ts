export type ProductSdkEnvironment = "paseo";

const PASEO_V2_REGISTRY_ADDRESS = "0xf62c2ece29cd8df2e10040ecfa5a894a5c5d9cb0";

export function getRegistryAddress(name = "paseo"): string {
    if (name === "paseo" || name === "paseo-next-v2" || name === "paseo-v2") {
        return PASEO_V2_REGISTRY_ADDRESS;
    }
    return PASEO_V2_REGISTRY_ADDRESS;
}
