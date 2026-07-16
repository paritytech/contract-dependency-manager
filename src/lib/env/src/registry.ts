export type ProductSdkEnvironment = "paseo" | "devnet" | "summit";

const POLKADOT_REGISTRY_ADDRESS = "";
const PASEO_REGISTRY_ADDRESS = "0x7671a84f5e7b1bf704f0ad3f43a185ff3d4b303f";
// ContractRegistry operated by the Polkadot Community Foundation on the Paseo
// testnet Asset Hub (para 1000, EVM chain id 420420417) for its public
// "products devnet". Community-owned, not deployed by this repo's tooling.
const DEVNET_REGISTRY_ADDRESS = "0x59b0245778917af55224e5f8fb55f7f8d452619f";
const W3S_REGISTRY_ADDRESS = "0xa5747e60ae27f93e92019e4021abfc4957050141";
const LOCAL_REGISTRY_ADDRESS = "";

export function getRegistryAddress(name = "paseo"): string {
    if (name === "paseo" || name === "paseo-next-v2" || name === "paseo-v2") {
        return PASEO_REGISTRY_ADDRESS;
    }
    if (name === "devnet") {
        return DEVNET_REGISTRY_ADDRESS;
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
