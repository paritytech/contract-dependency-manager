export interface ChainPreset {
    assethubUrl: string;
    bulletinUrl: string;
    ipfsGatewayUrl: string;
    registryAddress?: string;
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
        bulletinUrl: "wss://bulletin.dotspark.app",
        ipfsGatewayUrl: "https://ipfs.dotspark.app/ipfs",
        registryAddress: "0xd984e8407838138eff926814b802a66f3938017f",
    },
    "preview-net": {
        assethubUrl: "wss://previewnet.substrate.dev/asset-hub",
        bulletinUrl: "wss://bulletin.dotspark.app",
        ipfsGatewayUrl: "https://ipfs.dotspark.app/ipfs",
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
