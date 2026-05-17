import { getRegistryAddress, type ProductSdkEnvironment } from "@dotdm/env/registry";
import { paseo_asset_hub } from "@parity/product-sdk-descriptors/paseo-asset-hub";
import { previewnet_asset_hub } from "@parity/product-sdk-descriptors/previewnet-asset-hub";

export type NetworkKey = "paseo" | "previewnet";
type AssetHubDescriptor = typeof paseo_asset_hub | typeof previewnet_asset_hub;

export interface NetworkConfig {
    key: NetworkKey;
    label: string;
    installName: string;
    productSdkEnvironment: ProductSdkEnvironment;
    assetHubDescriptor: AssetHubDescriptor;
    registryAddress: `0x${string}`;
}

function registryAddressFor(name: string): `0x${string}` {
    const registryAddress = getRegistryAddress(name);
    if (!registryAddress) throw new Error(`No CDM registry address configured for ${name}`);
    return registryAddress as `0x${string}`;
}

export const NETWORKS: Record<NetworkKey, NetworkConfig> = {
    paseo: {
        key: "paseo",
        label: "Paseo",
        installName: "paseo",
        productSdkEnvironment: "paseo",
        assetHubDescriptor: paseo_asset_hub,
        registryAddress: registryAddressFor("paseo"),
    },
    previewnet: {
        key: "previewnet",
        label: "PreviewNet",
        installName: "preview-net",
        productSdkEnvironment: "previewnet",
        assetHubDescriptor: previewnet_asset_hub,
        registryAddress: registryAddressFor("preview-net"),
    },
};

export const DEFAULT_NETWORK: NetworkKey = "paseo";
export const NETWORK_OPTIONS = Object.values(NETWORKS);

export function resolveNetworkKey(value: string | null | undefined): NetworkKey | null {
    if (!value) return null;
    if (value === "preview-net") return "previewnet";
    return value in NETWORKS ? (value as NetworkKey) : null;
}
