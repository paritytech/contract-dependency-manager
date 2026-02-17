export interface ChainPreset {
    assethubUrl: string;
    bulletinUrl: string;
    registryAddress?: string;
}

export const KNOWN_CHAINS: Record<string, ChainPreset> = {
    "polkadot": {
        assethubUrl: "wss://polkadot-asset-hub-rpc.polkadot.io",
        bulletinUrl: "wss://polkadot-bulletin-rpc.polkadot.io",
        registryAddress: undefined, // TODO: set once deployed
    },
    "paseo": {
        assethubUrl: "wss://asset-hub-paseo-rpc.dwellir.com",
        bulletinUrl: "wss://paseo-bulletin-rpc.parity.io",
        registryAddress: undefined, // TODO: set once deployed
    },
    "preview-net": {
        assethubUrl: "wss://previewnet.substrate.dev/asset-hub",
        bulletinUrl: "wss://previewnet.substrate.dev/bulletin",
        registryAddress: undefined, // TODO: set once deployed
    },
    "local": {
        assethubUrl: "ws://127.0.0.1:10020",
        bulletinUrl: "ws://127.0.0.1:10030",
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
