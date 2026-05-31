import React, { useCallback, useEffect, useMemo, useState } from "react";
import { DEFAULT_NETWORK, NETWORKS, NETWORK_OPTIONS, type NetworkKey } from "../config/networks";
import { withTimeout } from "../data/timeout";
import { getRegistryConnection } from "../utils/contracts";
import { NetworkContext } from "./network-context";

const CONNECTION_TIMEOUT_MS = 20_000;

export function NetworkProvider({ children }: { children: React.ReactNode }) {
    const [network, setNetworkState] = useState<NetworkKey>(DEFAULT_NETWORK);
    const [connected, setConnected] = useState(false);
    const [connecting, setConnecting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const networkConfig = NETWORKS[network];

    const setNetwork = useCallback((name: NetworkKey) => {
        setNetworkState(name);
        setConnecting(true);
        setConnected(false);
        setError(null);
    }, []);

    useEffect(() => {
        const abort = new AbortController();

        const connect = async () => {
            setConnecting(true);
            setConnected(false);
            setError(null);

            try {
                await withTimeout(
                    getRegistryConnection(networkConfig),
                    `Connection to ${networkConfig.label} timed out after ${CONNECTION_TIMEOUT_MS / 1000}s.`,
                    CONNECTION_TIMEOUT_MS,
                    abort.signal,
                );
                if (abort.signal.aborted) return;

                setConnected(true);
            } catch (err) {
                if (!abort.signal.aborted) {
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
        };
    }, [networkConfig]);

    const value = useMemo(
        () => ({
            network,
            networkConfig,
            networks: NETWORK_OPTIONS,
            setNetwork,
            registryAddress: networkConfig.registryAddress,
            connected,
            connecting,
            error,
        }),
        [network, networkConfig, setNetwork, connected, connecting, error],
    );

    return <NetworkContext.Provider value={value}>{children}</NetworkContext.Provider>;
}
