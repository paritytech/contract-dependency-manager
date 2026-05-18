export type ProductSdkEnvironment = "paseo" | "previewnet";

const PASEO_V2_REGISTRY_ADDRESS = "0xa7ae171c78f06c248a9b2556c793aa1df5c9173a";
const PREVIEW_NET_REGISTRY_ADDRESS = "0xa7ae171c78f06c248a9b2556c793aa1df5c9173a";

export function getRegistryAddress(name: string): string | undefined {
    if (name === "paseo" || name === "paseo-next-v2" || name === "paseo-v2") {
        return PASEO_V2_REGISTRY_ADDRESS;
    }
    if (name === "preview-net" || name === "previewnet") {
        return PREVIEW_NET_REGISTRY_ADDRESS;
    }
    return undefined;
}
