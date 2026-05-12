import { BULLETIN_RPCS } from "@parity/product-sdk-host";

export interface ChainFaucet {
    label: string;
    url: string;
}

export type ProductSdkEnvironment = "paseo" | "previewnet";

export interface ChainPreset {
    assethubUrl: string;
    bulletinUrl: string;
    ipfsGatewayUrl: string;
    productSdkEnvironment?: ProductSdkEnvironment;
    faucets?: readonly ChainFaucet[];
}

export const KNOWN_CHAINS = {
    polkadot: {
        assethubUrl: "wss://polkadot-asset-hub-rpc.polkadot.io",
        bulletinUrl: "wss://polkadot-bulletin-rpc.polkadot.io",
        ipfsGatewayUrl: "https://polkadot-bulletin-rpc.polkadot.io/ipfs",
    },
    paseo: {
        assethubUrl: "wss://asset-hub-paseo-rpc.n.dwellir.com",
        bulletinUrl: BULLETIN_RPCS.paseo[0],
        ipfsGatewayUrl: "https://paseo-ipfs.polkadot.io/ipfs",
        productSdkEnvironment: "paseo",
        faucets: [
            { label: "Asset Hub", url: "https://faucet.polkadot.io/" },
            {
                label: "Bulletin",
                url: "https://paritytech.github.io/polkadot-bulletin-chain/authorizations?tab=faucet",
            },
        ],
    },
    "preview-net": {
        assethubUrl: "wss://previewnet.substrate.dev/asset-hub",
        bulletinUrl: BULLETIN_RPCS.previewnet[0],
        ipfsGatewayUrl: "https://previewnet.substrate.dev/ipfs/",
        productSdkEnvironment: "previewnet",
    },
    local: {
        assethubUrl: "ws://127.0.0.1:10020",
        bulletinUrl: "ws://127.0.0.1:10030",
        ipfsGatewayUrl: "http://127.0.0.1:8283/ipfs",
    },
} as const satisfies Record<string, ChainPreset>;

export type KnownChainName = keyof typeof KNOWN_CHAINS;

export function normalizeChainName(name: string): KnownChainName | "custom" | undefined {
    if (name === "previewnet") return "preview-net";
    if (name === "preview-net" || name === "paseo" || name === "polkadot" || name === "local") {
        return name;
    }
    if (name === "custom") return "custom";
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
