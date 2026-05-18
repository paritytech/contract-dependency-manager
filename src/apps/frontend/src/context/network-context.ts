import { createContext } from "react";
import type { Contract, ContractDef } from "@parity/product-sdk-contracts";
import type { NetworkConfig, NetworkKey } from "../config/networks";

export type RegistryContract = Contract<ContractDef>;

export interface NetworkContextType {
    network: NetworkKey;
    networkConfig: NetworkConfig;
    networks: NetworkConfig[];
    setNetwork: (name: NetworkKey) => void;
    registryAddress: `0x${string}`;
    registry: RegistryContract | null;
    connected: boolean;
    connecting: boolean;
    error: string | null;
}

export const NetworkContext = createContext<NetworkContextType | null>(null);
