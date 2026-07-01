import { getChainAPI, type ChainClient, type PresetChains } from "@parity/product-sdk-chain-client";
import { createContract, createContractRuntimeFromClient } from "@parity/product-sdk-contracts";
import type { Contract, ContractDef, ContractRuntime } from "@parity/product-sdk-contracts";
import { CONTRACTS_REGISTRY_ABI } from "@parity/cdm-builder/abi";
import { DEFAULT_NETWORK, NETWORKS, type NetworkConfig, type NetworkKey } from "../config/networks";
import type { ProductSdkEnvironment } from "@parity/cdm-env/registry";

export type RegistryContract = Contract<ContractDef>;

type ProductChainClient = ChainClient<PresetChains<ProductSdkEnvironment>>;

export interface RegistryConnection {
    client: ProductChainClient;
    registry: RegistryContract;
}

const registryConnections = new Map<NetworkKey, Promise<RegistryConnection>>();

async function createRegistryConnection(networkConfig: NetworkConfig): Promise<RegistryConnection> {
    if (!networkConfig.productSdkEnvironment) {
        throw new Error(`No product-sdk environment configured for ${networkConfig.label}.`);
    }
    if (!networkConfig.assetHubDescriptor) {
        throw new Error(`No Asset Hub descriptor configured for ${networkConfig.label}.`);
    }
    if (!networkConfig.registryAddress) {
        throw new Error(`No CDM registry address configured for ${networkConfig.label}.`);
    }

    const client = await getChainAPI(networkConfig.productSdkEnvironment);
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
