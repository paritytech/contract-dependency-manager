import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useNetwork } from "../context/NetworkContext";
import type { Package, AbiEntry } from "../data/types";
import { ALICE_SS58 } from "@dotdm/utils";
import { connectIpfsGateway } from "@dotdm/env";
import { useInfiniteLoad } from "./useInfiniteLoad";

const PAGE_SIZE = 10;

function unwrapOption<T>(val: unknown): T | undefined {
    if (val && typeof val === "object" && "isSome" in val) {
        const opt = val as { isSome: boolean; value: T };
        return opt.isSome ? opt.value : undefined;
    }
    return val as T;
}

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

                const [versionResult, metadataResult, addressResult] = await Promise.all([
                    registry.query("getVersionCount", {
                        origin: ALICE_SS58,
                        data: { contract_name: name },
                    }),
                    registry.query("getMetadataUri", {
                        origin: ALICE_SS58,
                        data: { contract_name: name },
                    }),
                    registry.query("getAddress", {
                        origin: ALICE_SS58,
                        data: { contract_name: name },
                    }),
                ]);

                const versionCount = versionResult.success ? versionResult.value.response : 0;
                const metadataUri = metadataResult.success
                    ? unwrapOption<string>(metadataResult.value.response)
                    : undefined;
                const address = addressResult.success
                    ? unwrapOption<string>(addressResult.value.response)
                    : undefined;

                packages.push({
                    name,
                    version: String(versionCount),
                    weeklyCalls: 0,
                    address,
                    metadataUri,
                    metadataLoaded: false,
                });
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
                    let author: string | undefined;
                    if (Array.isArray(metadata.authors) && metadata.authors.length > 0) {
                        author = metadata.authors.join(", ");
                    }

                    let lastPublished: string | undefined;
                    if (metadata.published_at) {
                        lastPublished = new Date(metadata.published_at).toLocaleDateString(
                            "en-US",
                            {
                                year: "numeric",
                                month: "short",
                                day: "numeric",
                            },
                        );
                    }

                    let abi: AbiEntry[] | undefined;
                    if (Array.isArray(metadata.abi)) {
                        abi = metadata.abi;
                    }

                    setMetadataMap((prev) => ({
                        ...prev,
                        [pkg.name]: {
                            description: metadata.description || undefined,
                            readme: metadata.readme || undefined,
                            homepage: metadata.homepage || undefined,
                            repository: metadata.repository || undefined,
                            author,
                            lastPublished,
                            publishedDate: lastPublished,
                            abi,
                            metadataLoaded: true,
                        },
                    }));
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
        totalCount,
        network,
    };
}
