import { useState, useEffect, useRef } from "react";
import { useNetwork } from "../context/NetworkContext";
import type { Package } from "../data/types";
import { connectIpfsGateway } from "@dotdm/env";
import { queryContractByName, parseMetadata } from "../data/registry-queries";

export function usePackage(name: string | undefined) {
    const {
        registry,
        connected,
        connecting,
        error: networkError,
        network,
        ipfsGatewayUrl,
    } = useNetwork();

    const [pkg, setPkg] = useState<Package | null>(null);
    const [loading, setLoading] = useState(true);
    const [notFound, setNotFound] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const fetchedRef = useRef<string | null>(null);

    useEffect(() => {
        setPkg(null);
        setLoading(true);
        setNotFound(false);
        setError(null);
        fetchedRef.current = null;
    }, [name, registry]);

    // Phase 1: Direct on-chain lookup by name
    useEffect(() => {
        if (!registry || !connected || !name) return;
        if (fetchedRef.current === name) return;
        fetchedRef.current = name;

        let cancelled = false;
        (async () => {
            try {
                const result = await queryContractByName(registry, name);
                if (cancelled) return;
                if (!result) {
                    setNotFound(true);
                } else {
                    setPkg(result);
                }
            } catch (err) {
                if (cancelled) return;
                setError(err instanceof Error ? err.message : "Failed to query contract");
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [registry, connected, name]);

    // Phase 2: IPFS metadata enrichment
    useEffect(() => {
        if (!pkg || !ipfsGatewayUrl || pkg.metadataLoaded) return;
        if (!pkg.metadataUri || pkg.metadataUri.includes(":")) {
            setPkg((prev) => (prev ? { ...prev, metadataLoaded: true } : null));
            return;
        }

        let cancelled = false;
        connectIpfsGateway(ipfsGatewayUrl)
            .fetch(pkg.metadataUri)
            .then((r) => r.json())
            .then((metadata: any) => {
                if (!cancelled)
                    setPkg((prev) => (prev ? { ...prev, ...parseMetadata(metadata) } : null));
            })
            .catch(() => {
                if (!cancelled) setPkg((prev) => (prev ? { ...prev, metadataLoaded: true } : null));
            });

        return () => {
            cancelled = true;
        };
    }, [pkg?.name, pkg?.metadataUri, pkg?.metadataLoaded, ipfsGatewayUrl]);

    return { pkg, loading: loading || connecting, notFound, error: networkError ?? error, network };
}
