import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNetwork } from "../context/useNetwork";
import { queryBulletinJson } from "../data/bulletin-client";
import type { Package } from "../data/types";
import {
    metadataCidFromUri,
    parseMetadata,
    queryContractByName,
    queryContractNamesByPrefix,
} from "../data/registry-queries";
import { withTimeout } from "../data/timeout";
import { getRegistryConnection } from "../utils/contracts";

const SEARCH_PAGE_SIZE = 20;

export function useRegistrySearch(query: string) {
    const { connected, connecting, error: networkError, network, networkConfig } = useNetwork();
    const prefix = useMemo(() => {
        const trimmed = query.trim();
        if (!trimmed) return "";
        return trimmed.startsWith("@") ? trimmed : `@${trimmed}`;
    }, [query]);

    const [basePackages, setBasePackages] = useState<Package[]>([]);
    const [metadataMap, setMetadataMap] = useState<Record<string, Partial<Package>>>({});
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [hasMore, setHasMore] = useState(false);

    const generationRef = useRef(0);
    const busyRef = useRef(false);
    const offsetRef = useRef(0);
    const hasMoreRef = useRef(false);
    const metadataAttempted = useRef<Set<string>>(new Set());

    const metadataKey = useCallback((pkg: Package) => `${network}:${pkg.name}`, [network]);

    const loadPage = useCallback(
        async (generation: number) => {
            if (!connected || !prefix || busyRef.current || !hasMoreRef.current) {
                return;
            }

            busyRef.current = true;
            setLoading(true);
            setError(null);

            try {
                const { registry } = await getRegistryConnection(networkConfig);
                const page = await withTimeout(
                    queryContractNamesByPrefix(
                        registry,
                        prefix,
                        offsetRef.current,
                        SEARCH_PAGE_SIZE,
                    ),
                    `Registry search query timed out on ${networkConfig.label}.`,
                );
                if (generation !== generationRef.current) return;

                const packages = (
                    await Promise.all(
                        page.names.map((name) =>
                            withTimeout(
                                queryContractByName(registry, name),
                                `Registry package query timed out for ${name}.`,
                            ),
                        ),
                    )
                ).filter((pkg): pkg is Package => pkg !== null);

                if (generation !== generationRef.current) return;

                offsetRef.current = page.nextOffset;
                hasMoreRef.current = !page.done;
                setHasMore(!page.done);
                setBasePackages((prev) => {
                    const seen = new Set(prev.map((pkg) => pkg.name));
                    const next = packages.filter((pkg) => !seen.has(pkg.name));
                    return [...prev, ...next];
                });
            } catch (err) {
                if (generation !== generationRef.current) return;
                setError(err instanceof Error ? err.message : "Failed to search registry");
            } finally {
                if (generation === generationRef.current) {
                    busyRef.current = false;
                    setLoading(false);
                }
            }
        },
        [connected, networkConfig, prefix],
    );

    useEffect(() => {
        generationRef.current += 1;
        const generation = generationRef.current;

        setBasePackages([]);
        setMetadataMap({});
        setError(null);
        setLoading(false);
        setHasMore(false);
        offsetRef.current = 0;
        hasMoreRef.current = false;
        busyRef.current = false;
        metadataAttempted.current.clear();

        if (connected && prefix) {
            hasMoreRef.current = true;
            setHasMore(true);
            void loadPage(generation);
        }
    }, [connected, loadPage, prefix]);

    const loadMore = useCallback(() => {
        void loadPage(generationRef.current);
    }, [loadPage]);

    useEffect(() => {
        const productSdkEnvironment = networkConfig.productSdkEnvironment;
        if (!productSdkEnvironment) return;

        const toFetch = basePackages.filter(
            (pkg) =>
                metadataCidFromUri(pkg.metadataUri) &&
                !metadataAttempted.current.has(metadataKey(pkg)),
        );

        if (toFetch.length === 0) return;

        for (const pkg of toFetch) {
            metadataAttempted.current.add(metadataKey(pkg));
        }

        for (const pkg of toFetch) {
            const cid = metadataCidFromUri(pkg.metadataUri)!;
            const key = metadataKey(pkg);
            queryBulletinJson(productSdkEnvironment, cid)
                .then((metadata) => {
                    setMetadataMap((prev) => ({ ...prev, [key]: parseMetadata(metadata) }));
                })
                .catch(() => {
                    setMetadataMap((prev) => ({
                        ...prev,
                        [key]: { metadataLoaded: true },
                    }));
                });
        }
    }, [basePackages, metadataKey, networkConfig.productSdkEnvironment]);

    const packages = useMemo(
        () => basePackages.map((pkg) => ({ ...pkg, ...metadataMap[metadataKey(pkg)] })),
        [basePackages, metadataKey, metadataMap],
    );

    return {
        packages,
        loading: loading || connecting,
        error: networkError ?? error,
        hasMore,
        loadMore,
        network,
    };
}
