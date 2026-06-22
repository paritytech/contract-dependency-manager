import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useNetwork } from "../context/useNetwork";
import { queryBulletinJson } from "../data/bulletin-client";
import type { Package } from "../data/types";
import {
    queryContractsPage,
    parseMetadata,
    metadataCidFromUri,
    registryQueryError,
} from "../data/registry-queries";
import { withTimeout } from "../data/timeout";
import { getRegistryConnection } from "../utils/contracts";
import { useInfiniteLoad } from "./useInfiniteLoad";

const PAGE_SIZE = 10;

export function useRegistry() {
    const { connected, connecting, error: networkError, network, networkConfig } = useNetwork();

    // Phase 1: Paginated on-chain data via useInfiniteLoad
    const fetchCount = useCallback(async () => {
        const { registry } = await getRegistryConnection(networkConfig);
        const result = await withTimeout(
            registry.getContractCount.query(),
            `Registry count query timed out on ${networkConfig.label}.`,
        );
        if (!result.success) {
            throw registryQueryError("Failed to query contract count", result.value);
        }
        return result.value as number;
    }, [networkConfig]);

    const fetchPage = useCallback(
        async (start: number, count: number) => {
            const { registry } = await getRegistryConnection(networkConfig);

            const page = await withTimeout(
                queryContractsPage(registry, start, count),
                `Registry package page query timed out on ${networkConfig.label}.`,
            );
            return page.packages;
        },
        [networkConfig],
    );

    const {
        items: basePackages,
        loading: pageLoading,
        error: pageError,
        hasMore,
        loadMore,
        totalCount,
    } = useInfiniteLoad<Package>({
        fetchCount,
        fetchPage,
        getId: (pkg) => pkg.name,
        pageSize: PAGE_SIZE,
        enabled: connected,
        reverse: true,
    });

    // Phase 2: IPFS metadata enrichment (separate from pagination)
    const [metadataMap, setMetadataMap] = useState<Record<string, Partial<Package>>>({});
    const metadataAttempted = useRef<Set<string>>(new Set());

    const metadataKey = useCallback((pkg: Package) => `${network}:${pkg.name}`, [network]);

    useEffect(() => {
        const productSdkEnvironment = networkConfig.productSdkEnvironment;
        if (!productSdkEnvironment) return;

        const toFetch = basePackages.filter(
            (p) =>
                metadataCidFromUri(p.metadataUri) && !metadataAttempted.current.has(metadataKey(p)),
        );

        if (toFetch.length === 0) return;

        for (const p of toFetch) {
            metadataAttempted.current.add(metadataKey(p));
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

    // Merge on-chain data with IPFS metadata
    const packages = useMemo(
        () => basePackages.map((pkg) => ({ ...pkg, ...metadataMap[metadataKey(pkg)] })),
        [basePackages, metadataKey, metadataMap],
    );

    const error = networkError ?? pageError;

    return {
        packages,
        loading: pageLoading || connecting,
        error,
        hasMore,
        loadMore,
        totalCount,
        network,
    };
}
