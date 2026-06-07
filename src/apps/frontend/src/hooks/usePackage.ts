import { useState, useEffect, useRef } from "react";
import { useNetwork } from "../context/useNetwork";
import { queryBulletinJson } from "../data/bulletin-client";
import type { Package } from "../data/types";
import { queryContractByName, parseMetadata, metadataCidFromUri } from "../data/registry-queries";
import { withTimeout } from "../data/timeout";
import { getRegistryConnection } from "../utils/contracts";

export function usePackage(name: string | undefined) {
    const { connected, connecting, error: networkError, networkConfig } = useNetwork();

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
    }, [name, networkConfig]);

    // Phase 1: Direct on-chain lookup by name
    useEffect(() => {
        if (!connected || !name) return;
        if (fetchedRef.current === name) return;
        fetchedRef.current = name;

        let cancelled = false;
        (async () => {
            try {
                const { registry } = await getRegistryConnection(networkConfig);
                const result = await withTimeout(
                    queryContractByName(registry, name),
                    `Registry package query timed out for ${name}.`,
                );
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
    }, [connected, name, networkConfig]);

    // Phase 2: IPFS metadata enrichment
    const pkgName = pkg?.name;
    const metadataUri = pkg?.metadataUri;
    const metadataLoaded = pkg?.metadataLoaded;

    useEffect(() => {
        if (!pkgName || metadataLoaded) return;
        const productSdkEnvironment = networkConfig.productSdkEnvironment;
        if (!productSdkEnvironment) return;

        const cid = metadataCidFromUri(metadataUri);
        if (!cid) {
            setPkg((prev) => (prev ? { ...prev, metadataLoaded: true } : null));
            return;
        }

        let cancelled = false;
        queryBulletinJson(productSdkEnvironment, cid)
            .then((metadata) => {
                if (!cancelled)
                    setPkg((prev) => (prev ? { ...prev, ...parseMetadata(metadata) } : null));
            })
            .catch(() => {
                if (!cancelled) setPkg((prev) => (prev ? { ...prev, metadataLoaded: true } : null));
            });

        return () => {
            cancelled = true;
        };
    }, [pkgName, metadataUri, metadataLoaded, networkConfig.productSdkEnvironment]);

    return {
        pkg,
        loading: loading || connecting,
        notFound,
        error: networkError ?? error,
        networkConfig,
    };
}
