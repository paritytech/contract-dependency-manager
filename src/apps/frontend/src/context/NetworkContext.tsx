import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from "react";
import { createClient, type PolkadotClient } from "polkadot-api";
import { getWsProvider } from "polkadot-api/ws-provider/web";
import { withPolkadotSdkCompat } from "polkadot-api/polkadot-sdk-compat";
import { contracts } from "@polkadot-api/descriptors";
import { createInkSdk } from "@polkadot-api/sdk-ink";
import { KNOWN_CHAINS, type ChainPreset } from "@dotdm/env";

const NETWORK_PRESETS: Record<string, ChainPreset> = {
    ...KNOWN_CHAINS,
    custom: { assethubUrl: "", bulletinUrl: "", ipfsGatewayUrl: "", registryAddress: "" },
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RegistryContract = any;

interface NetworkContextType {
    network: string;
    setNetwork: (name: string) => void;
    assethubUrl: string;
    bulletinUrl: string;
    ipfsGatewayUrl: string;
    registryAddress: string;
    setAssethubUrl: (url: string) => void;
    setBulletinUrl: (url: string) => void;
    setIpfsGatewayUrl: (url: string) => void;
    setRegistryAddress: (addr: string) => void;
    registry: RegistryContract | null;
    connected: boolean;
    connecting: boolean;
    error: string | null;
}

const NetworkContext = createContext<NetworkContextType | null>(null);

export function useNetwork(): NetworkContextType {
    const ctx = useContext(NetworkContext);
    if (!ctx) throw new Error("useNetwork must be used within a NetworkProvider");
    return ctx;
}

export function NetworkProvider({ children }: { children: React.ReactNode }) {
    const [network, setNetworkState] = useState("preview-net");
    const [assethubUrl, setAssethubUrl] = useState(NETWORK_PRESETS["preview-net"].assethubUrl);
    const [bulletinUrl, setBulletinUrl] = useState(NETWORK_PRESETS["preview-net"].bulletinUrl);
    const [ipfsGatewayUrl, setIpfsGatewayUrl] = useState(
        NETWORK_PRESETS["preview-net"].ipfsGatewayUrl,
    );
    const [registryAddress, setRegistryAddress] = useState(
        NETWORK_PRESETS["preview-net"].registryAddress ?? "",
    );
    const [registry, setRegistry] = useState<RegistryContract | null>(null);
    const [connected, setConnected] = useState(false);
    const [connecting, setConnecting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const clientRef = useRef<PolkadotClient | null>(null);

    const setNetwork = useCallback((name: string) => {
        setNetworkState(name);
        const preset = NETWORK_PRESETS[name];
        if (preset) {
            setAssethubUrl(preset.assethubUrl);
            setBulletinUrl(preset.bulletinUrl);
            setIpfsGatewayUrl(preset.ipfsGatewayUrl);
            setRegistryAddress(preset.registryAddress ?? "");
        }
    }, []);

    useEffect(() => {
        if (!assethubUrl || !registryAddress) {
            setRegistry(null);
            setConnected(false);
            setError(null);
            return;
        }

        const abort = new AbortController();

        const connect = async () => {
            // Clean up previous connection
            if (clientRef.current) {
                clientRef.current.destroy();
                clientRef.current = null;
            }

            setConnecting(true);
            setConnected(false);
            setError(null);
            setRegistry(null);

            try {
                const provider = getWsProvider(assethubUrl);
                const client = createClient(withPolkadotSdkCompat(provider));
                clientRef.current = client;

                // Verify the connection actually works by fetching chain spec with a timeout.
                // getWsProvider silently retries forever, so without this the UI would just
                // spin indefinitely when the node is unreachable.
                const CONNECTION_TIMEOUT_MS = 15_000;
                await Promise.race([
                    client.getChainSpecData(),
                    new Promise<never>((_, reject) => {
                        const tid = setTimeout(
                            () =>
                                reject(
                                    new Error(
                                        `Connection to ${assethubUrl} timed out after ${CONNECTION_TIMEOUT_MS / 1000}s`,
                                    ),
                                ),
                            CONNECTION_TIMEOUT_MS,
                        );
                        abort.signal.addEventListener("abort", () => {
                            clearTimeout(tid);
                            reject(new Error("aborted"));
                        });
                    }),
                ]);

                if (abort.signal.aborted) return;

                const inkSdk = createInkSdk(client);
                const reg = inkSdk.getContract(contracts.contractsRegistry, registryAddress);

                setRegistry(reg);
                setConnected(true);
                setConnecting(false);
            } catch (err) {
                if (!abort.signal.aborted) {
                    // Clean up the failed client so it stops retrying
                    if (clientRef.current) {
                        clientRef.current.destroy();
                        clientRef.current = null;
                    }
                    setError(err instanceof Error ? err.message : "Connection failed");
                    setConnecting(false);
                }
            }
        };

        connect();

        return () => {
            abort.abort();
            if (clientRef.current) {
                clientRef.current.destroy();
                clientRef.current = null;
            }
        };
    }, [assethubUrl, registryAddress]);

    return (
        <NetworkContext.Provider
            value={{
                network,
                setNetwork,
                assethubUrl,
                bulletinUrl,
                ipfsGatewayUrl,
                registryAddress,
                setAssethubUrl,
                setBulletinUrl,
                setIpfsGatewayUrl,
                setRegistryAddress,
                registry,
                connected,
                connecting,
                error,
            }}
        >
            {children}
        </NetworkContext.Provider>
    );
}

export { NETWORK_PRESETS };
