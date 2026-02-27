export interface ChainFaucet {
    label: string;
    url: string;
}

export interface ChainPreset {
    assethubUrl: string;
    bulletinUrl: string;
    ipfsGatewayUrl: string;
    registryAddress?: string;
    faucets?: ChainFaucet[];
}

export const KNOWN_CHAINS: Record<string, ChainPreset> = {
    polkadot: {
        assethubUrl: "wss://polkadot-asset-hub-rpc.polkadot.io",
        bulletinUrl: "wss://polkadot-bulletin-rpc.polkadot.io",
        ipfsGatewayUrl: "https://polkadot-bulletin-rpc.polkadot.io/ipfs",
        registryAddress: undefined, // TODO: set once deployed
    },
    paseo: {
        assethubUrl: "wss://asset-hub-paseo-rpc.n.dwellir.com",
        bulletinUrl: "wss://paseo-bulletin-rpc.polkadot.io",
        ipfsGatewayUrl: "https://paseo-ipfs.polkadot.io/ipfs",
        registryAddress: "0xede6d5f092de34152f8952baa99a35363ed087c0",
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
        bulletinUrl: "wss://previewnet.substrate.dev/bulletin",
        ipfsGatewayUrl: "https://previewnet.substrate.dev/ipfs/",
        registryAddress: "0x5801b439a678d9d3a68b8019da6a4abfa507de11",
    },
    local: {
        assethubUrl: "ws://127.0.0.1:10020",
        bulletinUrl: "ws://127.0.0.1:10030",
        ipfsGatewayUrl: "http://127.0.0.1:8283/ipfs",
    },
};

export type KnownChainName = keyof typeof KNOWN_CHAINS;

export function getChainPreset(name: string): ChainPreset {
    const preset = KNOWN_CHAINS[name];
    if (!preset) {
        const valid = Object.keys(KNOWN_CHAINS).join(", ");
        throw new Error(`Unknown chain "${name}". Valid names: ${valid}`);
    }
    return preset;
}
