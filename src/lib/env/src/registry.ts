export type ProductSdkEnvironment = "paseo" | "previewnet";

const PASEO_V2_REGISTRY_ADDRESS = "0x7503d0ab3134d680ad0ca2bbf69b5d45e8ec5833";
const PREVIEW_NET_REGISTRY_ADDRESS = "0x7503d0ab3134d680ad0ca2bbf69b5d45e8ec5833";

export function getRegistryAddress(name = "paseo"): string {
    if (name === "paseo" || name === "paseo-next-v2" || name === "paseo-v2") {
        return PASEO_V2_REGISTRY_ADDRESS;
    }
    if (name === "preview-net" || name === "previewnet") {
        return PREVIEW_NET_REGISTRY_ADDRESS;
    }
    return PASEO_V2_REGISTRY_ADDRESS;
}
