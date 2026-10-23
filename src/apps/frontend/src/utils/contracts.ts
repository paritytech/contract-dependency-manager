import {
    EnvironmentMismatchError,
    GenesisMismatchError,
    getChainAPI,
    type ChainClient,
    type PresetChains,
} from "@parity/product-sdk-chain-client";
import { createContract, createContractRuntimeFromClient } from "@parity/product-sdk-contracts";
import type { Contract, ContractDef, ContractRuntime } from "@parity/product-sdk-contracts";
import { CONTRACTS_REGISTRY_ABI } from "@parity/cdm-builder/abi";
import {
    DEFAULT_NETWORK,
    NETWORKS,
    resolveNetworkKey,
    type NetworkConfig,
    type NetworkKey,
} from "../config/networks";
import type { ProductSdkEnvironment } from "@parity/cdm-env/registry";

export type RegistryContract = Contract<ContractDef>;

type ProductChainClient = ChainClient<PresetChains<ProductSdkEnvironment>>;

export interface RegistryConnection {
    client: ProductChainClient;
    registry: RegistryContract;
}

const registryConnections = new Map<NetworkKey, Promise<RegistryConnection>>();

/**
 * The host this app runs in (e.g. Polkadot Desktop) cannot serve the selected
 * network. Raised instead of chain-client's `EnvironmentMismatchError` /
 * `GenesisMismatchError` so the UI shows an actionable message; the original
 * error is kept as `cause`.
 */
export class NetworkUnavailableError extends Error {
    constructor(message: string, options?: ErrorOptions) {
        super(message, options);
        this.name = "NetworkUnavailableError";
    }
}

async function connectChain(
    networkConfig: NetworkConfig,
    environment: ProductSdkEnvironment,
): Promise<ProductChainClient> {
    try {
        return await getChainAPI(environment);
    } catch (err) {
        if (err instanceof EnvironmentMismatchError) {
            // `hostNetwork` is the host's ecosystem id (e.g. "paseo"); name it only
            // when it differs from the selection, otherwise the hint is confusing.
            const hostKey = resolveNetworkKey(err.hostNetwork.toLowerCase());
            const hostLabel = hostKey ? NETWORKS[hostKey].label : err.hostNetwork;
            const hostHint =
                hostKey === networkConfig.key ? "" : ` (it is set up for ${hostLabel})`;
            throw new NetworkUnavailableError(
                `${networkConfig.label} is not available in this host${hostHint}. Switch to a network this host supports.`,
                { cause: err },
            );
        }
        if (err instanceof GenesisMismatchError) {
            throw new NetworkUnavailableError(
                `${networkConfig.label} is not available in this host: the network it serves does not match the one this app was built for (it may have been reset). Switch networks or try again after an app update.`,
                { cause: err },
            );
        }
        throw err;
    }
}

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

    const client = await connectChain(networkConfig, networkConfig.productSdkEnvironment);
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
