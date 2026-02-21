import { useState, useEffect, useCallback, useRef } from "react";
import { useNetwork } from "../context/NetworkContext";
import type { Package, AbiEntry } from "../data/types";
import { ALICE_SS58 } from "@dotdm/utils";
import { connectIpfsGateway } from "@dotdm/env";

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
    const [packages, setPackages] = useState<Package[]>([]);
    const [loading, setLoading] = useState(false);
    const [queryError, setQueryError] = useState<string | null>(null);
    const [totalCount, setTotalCount] = useState(0);
    const nextIndex = useRef(-1);
    const metadataAttempted = useRef<Set<string>>(new Set());

    // Reset when registry changes
    useEffect(() => {
        setPackages([]);
        setQueryError(null);
        setTotalCount(0);
        nextIndex.current = -1;
        metadataAttempted.current = new Set();
    }, [registry]);

    // Phase 1: Load on-chain data only (fast)
    const loadBatch = useCallback(async () => {
        if (!registry || !connected) return;

        setLoading(true);
        setQueryError(null);

        try {
            // Get total count if we don't have it yet
            let count = totalCount;
            if (count === 0) {
                const countResult = await registry.query("getContractCount", {
                    origin: ALICE_SS58,
                    data: {},
                });
                if (!countResult.success) {
                    throw new Error("Failed to query contract count");
                }
                count = countResult.value.response;
                setTotalCount(count);
            }

            if (count === 0) {
                setLoading(false);
                return;
            }

            // On first load, start from the newest contract
            if (nextIndex.current === -1) {
                nextIndex.current = count - 1;
            }

            const start = nextIndex.current;
            const end = Math.max(start - PAGE_SIZE, -1);

            const newPackages: Package[] = [];

            for (let i = start; i > end; i--) {
                const nameResult = await registry.query("getContractNameAt", {
                    origin: ALICE_SS58,
                    data: { index: i },
                });
                if (!nameResult.success) continue;
                const name = nameResult.value.response;

                // Fetch version count, metadata URI, and address in parallel
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

                newPackages.push({
                    name,
                    version: String(versionCount),
                    weeklyCalls: 0,
                    address,
                    metadataUri,
                    metadataLoaded: false,
                });
            }

            nextIndex.current = end;
            setPackages((prev) => [...prev, ...newPackages]);
        } catch (err) {
            setQueryError(err instanceof Error ? err.message : "Failed to load contracts");
        } finally {
            setLoading(false);
        }
    }, [registry, connected, totalCount]);

    // Phase 2: Fetch IPFS metadata independently per-package
    useEffect(() => {
        if (!ipfsGatewayUrl) return;

        const packagesToFetch = packages.filter(
            (p) =>
                !p.metadataLoaded &&
                p.metadataUri &&
                !p.metadataUri.includes(":") &&
                !metadataAttempted.current.has(p.name),
        );

        if (packagesToFetch.length === 0) return;

        // Mark all as attempted immediately to prevent re-fetching
        for (const p of packagesToFetch) {
            metadataAttempted.current.add(p.name);
        }

        const ipfs = connectIpfsGateway(ipfsGatewayUrl);

        for (const pkg of packagesToFetch) {
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

                    setPackages((prev) =>
                        prev.map((p) =>
                            p.name === pkg.name
                                ? {
                                      ...p,
                                      description: metadata.description || undefined,
                                      readme: metadata.readme || undefined,
                                      homepage: metadata.homepage || undefined,
                                      repository: metadata.repository || undefined,
                                      author,
                                      lastPublished,
                                      publishedDate: lastPublished,
                                      abi,
                                      metadataLoaded: true,
                                  }
                                : p,
                        ),
                    );
                })
                .catch(() => {
                    // Mark as loaded even on failure so the card stops showing shimmer
                    setPackages((prev) =>
                        prev.map((p) => (p.name === pkg.name ? { ...p, metadataLoaded: true } : p)),
                    );
                });
        }
    }, [packages, ipfsGatewayUrl]);

    // Auto-load first batch when registry connects
    useEffect(() => {
        if (registry && connected && nextIndex.current === -1) {
            loadBatch();
        }
    }, [registry, connected, loadBatch]);

    const hasMore = nextIndex.current >= 0;

    // Surface whichever error is relevant: network-level or query-level
    const error = networkError ?? queryError;

    return {
        packages,
        loading: loading || connecting,
        error,
        hasMore,
        loadMore: loadBatch,
        totalCount,
        network,
    };
}
