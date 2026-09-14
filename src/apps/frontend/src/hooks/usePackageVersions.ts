import { useState, useEffect, useRef } from "react";
import { useNetwork } from "../context/useNetwork";
import { queryContractVersions, type PackageVersionInfo } from "../data/registry-queries";
import { withTimeout } from "../data/timeout";
import { getRegistryConnection } from "../utils/contracts";

/**
 * Lazily loads the full on-chain version history of a package. Nothing is
 * fetched until `enabled` becomes true (i.e. the Versions tab is opened);
 * the result is cached per package name until the name or network changes.
 */
export function usePackageVersions(name: string | undefined, enabled: boolean) {
    const { connected, networkConfig } = useNetwork();

    const [versions, setVersions] = useState<PackageVersionInfo[] | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const fetchedRef = useRef<string | null>(null);

    useEffect(() => {
        setVersions(null);
        setLoading(false);
        setError(null);
        fetchedRef.current = null;
    }, [name, networkConfig]);

    useEffect(() => {
        if (!enabled || !connected || !name) return;
        if (fetchedRef.current === name) return;
        fetchedRef.current = name;

        let cancelled = false;
        setLoading(true);
        setError(null);
        (async () => {
            try {
                const { registry } = await getRegistryConnection(networkConfig);
                const result = await withTimeout(
                    queryContractVersions(registry, name),
                    `Registry versions query timed out for ${name}.`,
                );
                if (!cancelled) setVersions(result);
            } catch (err) {
                if (cancelled) return;
                setError(err instanceof Error ? err.message : "Failed to query versions");
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [enabled, connected, name, networkConfig]);

    return { versions, loading, error };
}
