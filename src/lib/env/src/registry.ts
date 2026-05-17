export type ProductSdkEnvironment = "paseo" | "previewnet";

const PASEO_V2_REGISTRY_ADDRESS = "0x5c7b23d386ff622c7f7a4e7a95d5c7a67b10a00d";
const PREVIEW_NET_REGISTRY_ADDRESS = "0x5c7b23d386ff622c7f7a4e7a95d5c7a67b10a00d";

export function getRegistryAddress(name: string): string | undefined {
    if (name === "paseo" || name === "paseo-next-v2" || name === "paseo-v2") {
        return PASEO_V2_REGISTRY_ADDRESS;
    }
    if (name === "preview-net" || name === "previewnet") {
        return PREVIEW_NET_REGISTRY_ADDRESS;
    }
    return undefined;
}
