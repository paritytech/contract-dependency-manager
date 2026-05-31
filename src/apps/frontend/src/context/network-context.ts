import { createContext } from "react";
import type { NetworkConfig, NetworkKey } from "../config/networks";

export interface NetworkContextType {
    network: NetworkKey;
    networkConfig: NetworkConfig;
    networks: NetworkConfig[];
    setNetwork: (name: NetworkKey) => void;
    registryAddress: `0x${string}`;
    connected: boolean;
    connecting: boolean;
    error: string | null;
}

export const NetworkContext = createContext<NetworkContextType | null>(null);
