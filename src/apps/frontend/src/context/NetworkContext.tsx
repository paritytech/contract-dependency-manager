import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
    destroyAll,
    getChainAPI,
    isInsideContainer,
    type ChainClient,
    type PresetChains,
} from "@parity/product-sdk-chain-client";
import { createContract, createContractRuntimeFromClient } from "@parity/product-sdk-contracts";
import type { ContractRuntime } from "@parity/product-sdk-contracts";
import { CONTRACTS_REGISTRY_ABI } from "@dotdm/contracts/abi";
import { ALICE_SS58 } from "@dotdm/utils";
import {
    DEFAULT_NETWORK,
    NETWORKS,
    NETWORK_OPTIONS,
    type NetworkConfig,
    type NetworkKey,
} from "../config/networks";
import { withTimeout } from "../data/timeout";
import { NetworkContext, type RegistryContract } from "./network-context";

type ProductChainClient = ChainClient<PresetChains<NetworkConfig["productSdkEnvironment"]>>;
const CONNECTION_TIMEOUT_MS = 20_000;

export function NetworkProvider({ children }: { children: React.ReactNode }) {
    const [network, setNetworkState] = useState<NetworkKey>(DEFAULT_NETWORK);
    const [registry, setRegistry] = useState<RegistryContract | null>(null);
    const [connected, setConnected] = useState(false);
    const [connecting, setConnecting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const networkConfig = NETWORKS[network];

    const setNetwork = useCallback((name: NetworkKey) => {
        setNetworkState(name);
        setConnecting(true);
        setConnected(false);
        setRegistry(null);
        setError(null);
    }, []);

    useEffect(() => {
        const abort = new AbortController();
        let client: ProductChainClient | null = null;

        const connect = async () => {
            setConnecting(true);
            setConnected(false);
            setError(null);
            setRegistry(null);

            try {
                if (!(await isInsideContainer())) {
                    throw new Error(
                        "Host provider unavailable. Open Contract Hub inside Polkadot Desktop.",
                    );
                }

                client = (await withTimeout(
                    getChainAPI(networkConfig.productSdkEnvironment),
                    `Connection to ${networkConfig.label} timed out after ${CONNECTION_TIMEOUT_MS / 1000}s.`,
                    CONNECTION_TIMEOUT_MS,
                    abort.signal,
                )) as ProductChainClient;
                if (abort.signal.aborted) {
                    client.destroy();
                    return;
                }

                const runtime: ContractRuntime = createContractRuntimeFromClient(
                    client.raw.assetHub,
                    networkConfig.assetHubDescriptor,
                );
                const reg = createContract(
                    runtime,
                    networkConfig.registryAddress,
                    CONTRACTS_REGISTRY_ABI,
                    { defaultOrigin: ALICE_SS58 },
                );

                if (abort.signal.aborted) {
                    client.destroy();
                    return;
                }

                setRegistry(reg);
                setConnected(true);
            } catch (err) {
                if (!abort.signal.aborted) {
                    client?.destroy();
                    client = null;
                    destroyAll();
                    setError(err instanceof Error ? err.message : "Connection failed");
                }
            } finally {
                if (!abort.signal.aborted) {
                    setConnecting(false);
                }
            }
        };

        connect();

        return () => {
            abort.abort();
            client?.destroy();
        };
    }, [networkConfig]);

    const value = useMemo(
        () => ({
            network,
            networkConfig,
            networks: NETWORK_OPTIONS,
            setNetwork,
            registryAddress: networkConfig.registryAddress,
            registry,
            connected,
            connecting,
            error,
        }),
        [network, networkConfig, setNetwork, registry, connected, connecting, error],
    );

    return <NetworkContext.Provider value={value}>{children}</NetworkContext.Provider>;
}
