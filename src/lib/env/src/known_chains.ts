import { BULLETIN_RPCS } from "@parity/product-sdk-host";
import { getRegistryAddress, type ProductSdkEnvironment } from "./registry";

export interface ChainFaucet {
    label: string;
    url: string;
}

export type { ProductSdkEnvironment };

export interface ChainPreset {
    assethubUrl: string;
    bulletinUrl: string;
    ipfsGatewayUrl: string;
    registryAddress?: string;
    productSdkEnvironment?: ProductSdkEnvironment;
    faucets?: readonly ChainFaucet[];
}

// Product SDK exports Bulletin RPCs, but its Asset Hub RPC presets are internal
// to @parity/product-sdk-chain-client. Keep these CLI fallbacks aligned with
// the descriptor package's generated .papi wsUrl values.
const PASEO_ASSET_HUB_URL = "wss://paseo-asset-hub-next-rpc.polkadot.io";
const PASEO_IPFS_GATEWAY_URL = "https://paseo-bulletin-next-ipfs.polkadot.io/ipfs";

const KNOWN_CHAINS = {
    polkadot: {
        assethubUrl: "wss://polkadot-asset-hub-rpc.polkadot.io",
        bulletinUrl: "wss://polkadot-bulletin-rpc.polkadot.io",
        ipfsGatewayUrl: "https://polkadot-bulletin-rpc.polkadot.io/ipfs",
        registryAddress: getRegistryAddress("polkadot"),
    },
    paseo: {
        assethubUrl: PASEO_ASSET_HUB_URL,
        bulletinUrl: BULLETIN_RPCS.paseo[0],
        ipfsGatewayUrl: PASEO_IPFS_GATEWAY_URL,
        registryAddress: getRegistryAddress("paseo"),
        productSdkEnvironment: "paseo",
        faucets: [
            { label: "Asset Hub", url: "https://faucet.polkadot.io/?parachain=1500" },
            {
                label: "Bulletin",
                url: "https://paritytech.github.io/polkadot-bulletin-chain/authorizations?tab=faucet",
            },
        ],
    },
    local: {
        assethubUrl: "ws://127.0.0.1:10020",
        bulletinUrl: "ws://127.0.0.1:10030",
        ipfsGatewayUrl: "http://127.0.0.1:8283/ipfs",
        registryAddress: getRegistryAddress("local"),
    },
} as const satisfies Record<string, ChainPreset>;

export type KnownChainName = keyof typeof KNOWN_CHAINS;

export function normalizeChainName(name: string): KnownChainName | "custom" | undefined {
    if (name === "paseo-next-v2" || name === "paseo-v2") return "paseo";
    if (name === "paseo" || name === "polkadot" || name === "local") {
        return name;
    }
    if (name === "custom") return "custom";
}

export function isKnownChainPreset(name: string): boolean {
    const normalized = normalizeChainName(name);
    return normalized !== undefined && normalized !== "custom";
}

export function getChainPreset(name: string): ChainPreset {
    const normalized = normalizeChainName(name);
    const preset = normalized && normalized !== "custom" ? KNOWN_CHAINS[normalized] : undefined;
    if (!preset) {
        const valid = Object.keys(KNOWN_CHAINS).join(", ");
        throw new Error(`Unknown chain "${name}". Valid names: ${valid}`);
    }
    return preset;
}
