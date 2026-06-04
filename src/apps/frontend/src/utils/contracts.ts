import { getChainAPI, type ChainClient, type PresetChains } from "@parity/product-sdk-chain-client";
import { createContract, createContractRuntimeFromClient } from "@parity/product-sdk-contracts";
import type { Contract, ContractDef, ContractRuntime } from "@parity/product-sdk-contracts";
import { CONTRACTS_REGISTRY_ABI } from "@parity/cdm-builder/abi";
import { DEFAULT_NETWORK, NETWORKS, type NetworkConfig, type NetworkKey } from "../config/networks";

export type RegistryContract = Contract<ContractDef>;

type ProductChainClient = ChainClient<PresetChains<NetworkConfig["productSdkEnvironment"]>>;

export interface RegistryConnection {
    client: ProductChainClient;
    registry: RegistryContract;
}

const registryConnections = new Map<NetworkKey, Promise<RegistryConnection>>();

async function createRegistryConnection(networkConfig: NetworkConfig): Promise<RegistryConnection> {
    const client = (await getChainAPI(networkConfig.productSdkEnvironment)) as ProductChainClient;
    const runtime: ContractRuntime = createContractRuntimeFromClient(
        client.raw.assetHub,
        networkConfig.assetHubDescriptor,
    );
    const registry = createContract(runtime, networkConfig.registryAddress, CONTRACTS_REGISTRY_ABI);

    return { client, registry };
}

export function getRegistryConnection(
    networkConfig: NetworkConfig = NETWORKS[DEFAULT_NETWORK],
): Promise<RegistryConnection> {
    const existing = registryConnections.get(networkConfig.key);
    if (existing) return existing;

    const connection = createRegistryConnection(networkConfig).catch((err) => {
        registryConnections.delete(networkConfig.key);
        throw err;
    });
    registryConnections.set(networkConfig.key, connection);
    return connection;
}
