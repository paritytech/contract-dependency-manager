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
        bulletinUrl: "wss://previewnet.substrate.dev/bulletin",
        ipfsGatewayUrl: "https://previewnet.substrate.dev/ipfs",
        registryAddress: "0x21fa63bfac2a77b1a6de8bd9a0c2c172a48bb5e3",
    },
    "preview-net": {
        assethubUrl: "wss://previewnet.substrate.dev/asset-hub",
        bulletinUrl: "wss://previewnet.substrate.dev/bulletin",
        ipfsGatewayUrl: "https://previewnet.substrate.dev/ipfs",
        registryAddress: "0x2c6fc00458f198f46ef072e1516b83cd56db7cf5",
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
