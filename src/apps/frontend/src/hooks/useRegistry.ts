import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useNetwork } from "../context/NetworkContext";
import type { Package } from "../data/types";
import { ALICE_SS58 } from "@dotdm/utils";
import { connectIpfsGateway } from "@dotdm/env";
import { queryContractByName, parseMetadata } from "../data/registry-queries";
import { useInfiniteLoad } from "./useInfiniteLoad";

const PAGE_SIZE = 10;

// patch!
const HIDDEN_CONTRACTS = ["@polkadot/disputes", "@polkadot/reputation"];

export function useRegistry() {
    const {
        registry,
        connected,
        connecting,
        error: networkError,
        network,
        ipfsGatewayUrl,
    } = useNetwork();

    // Phase 1: Paginated on-chain data via useInfiniteLoad
    const fetchCount = useCallback(async () => {
        if (!registry) throw new Error("Registry not connected");
        const result = await registry.query("getContractCount", {
            origin: ALICE_SS58,
            data: {},
        });
        if (!result.success) throw new Error("Failed to query contract count");
        return result.value.response;
    }, [registry]);

    const fetchPage = useCallback(
        async (start: number, count: number) => {
            if (!registry) throw new Error("Registry not connected");

            const packages: Package[] = [];
            for (let i = start; i < start + count; i++) {
                const nameResult = await registry.query("getContractNameAt", {
                    origin: ALICE_SS58,
                    data: { index: i },
                });
                if (!nameResult.success) continue;
                const name = nameResult.value.response;
                // patch!
                if (HIDDEN_CONTRACTS.includes(name)) continue;

                const pkg = await queryContractByName(registry, name);
                if (pkg) packages.push(pkg);
            }
            return packages;
        },
        [registry],
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
        enabled: !!registry && connected,
        reverse: true,
    });

    // Phase 2: IPFS metadata enrichment (separate from pagination)
    const [metadataMap, setMetadataMap] = useState<Record<string, Partial<Package>>>({});
    const metadataAttempted = useRef<Set<string>>(new Set());

    // Reset metadata when the registry changes
    useEffect(() => {
        setMetadataMap({});
        metadataAttempted.current = new Set();
    }, [registry]);

    useEffect(() => {
        if (!ipfsGatewayUrl) return;

        const toFetch = basePackages.filter(
            (p) =>
                p.metadataUri &&
                !p.metadataUri.includes(":") &&
                !metadataAttempted.current.has(p.name),
        );

        if (toFetch.length === 0) return;

        for (const p of toFetch) {
            metadataAttempted.current.add(p.name);
        }

        const ipfs = connectIpfsGateway(ipfsGatewayUrl);

        for (const pkg of toFetch) {
            ipfs.fetch(pkg.metadataUri!)
                .then((r) => r.json())
                .then((metadata: any) => {
                    setMetadataMap((prev) => ({ ...prev, [pkg.name]: parseMetadata(metadata) }));
                })
                .catch(() => {
                    setMetadataMap((prev) => ({
                        ...prev,
                        [pkg.name]: { metadataLoaded: true },
                    }));
                });
        }
    }, [basePackages, ipfsGatewayUrl]);

    // Merge on-chain data with IPFS metadata
    const packages = useMemo(
        () => basePackages.map((pkg) => ({ ...pkg, ...metadataMap[pkg.name] })),
        [basePackages, metadataMap],
    );

    const error = networkError ?? pageError;

    return {
        packages,
        loading: pageLoading || connecting,
        error,
        hasMore,
        loadMore,
        // patch!
        totalCount: Math.max(0, totalCount - HIDDEN_CONTRACTS.length),
        network,
    };
}
