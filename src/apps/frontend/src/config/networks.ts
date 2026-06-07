import { getRegistryAddress, type ProductSdkEnvironment } from "@parity/cdm-env/registry";
import { paseo_asset_hub } from "@parity/product-sdk-descriptors/paseo-asset-hub";

export type NetworkKey = "paseo" | "w3s";
type AssetHubDescriptor = typeof paseo_asset_hub;

export interface NetworkConfig {
    key: NetworkKey;
    label: string;
    installName: string;
    productSdkEnvironment: ProductSdkEnvironment | "";
    assetHubDescriptor: AssetHubDescriptor | null;
    registryAddress: `0x${string}` | "";
}

function registryAddressFor(name: string): `0x${string}` | "" {
    const registryAddress = getRegistryAddress(name);
    if (!registryAddress) return "";
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
    w3s: {
        key: "w3s",
        label: "W3S",
        installName: "w3s",
        productSdkEnvironment: "",
        assetHubDescriptor: null,
        registryAddress: registryAddressFor("w3s"),
    },
};

export const DEFAULT_NETWORK: NetworkKey = "paseo";
export const NETWORK_OPTIONS = Object.values(NETWORKS);

export function resolveNetworkKey(value: string | null | undefined): NetworkKey | null {
    if (!value) return null;
    return value in NETWORKS ? (value as NetworkKey) : null;
}
