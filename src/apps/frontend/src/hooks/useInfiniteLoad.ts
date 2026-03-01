import { useState, useEffect, useCallback, useRef } from "react";

interface UseInfiniteLoadOptions<T> {
    /** Fetch the total item count */
    fetchCount: () => Promise<number>;
    /** Fetch a page of items starting at `start` with `count` items */
    fetchPage: (start: number, count: number) => Promise<T[]>;
    /** Extract a unique ID from an item (used for deduplication) */
    getId: (item: T) => string;
    /** Items per page (default: 10) */
    pageSize?: number;
    /** Whether loading is enabled (e.g., network is connected) */
    enabled?: boolean;
    /** If true, load newest items first (highest index → lowest) */
    reverse?: boolean;
}

export interface UseInfiniteLoadResult<T> {
    items: T[];
    loading: boolean;
    error: string | null;
    hasMore: boolean;
    loadMore: () => void;
    refresh: () => void;
    totalCount: number;
}

const DEFAULT_PAGE_SIZE = 10;

/**
 * Generic infinite-load hook with StrictMode safety and deduplication.
 *
 * Uses a generation counter so that double-fired effects (React StrictMode)
 * discard stale async results instead of appending duplicates.
 */
export function useInfiniteLoad<T>({
    fetchCount,
    fetchPage,
    getId,
    pageSize = DEFAULT_PAGE_SIZE,
    enabled = true,
    reverse = false,
}: UseInfiniteLoadOptions<T>): UseInfiniteLoadResult<T> {
    const [items, setItems] = useState<T[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [totalCount, setTotalCount] = useState(0);

    const loadedCountRef = useRef(0);
    const busyRef = useRef(false);
    const totalCountRef = useRef(0);
    // Incremented on every reset — stale async results check this and bail
    const generationRef = useRef(0);
    // getId stored in a ref so it's never in a dependency array
    const getIdRef = useRef(getId);
    getIdRef.current = getId;

    // Reset when the data source (fetchCount / fetchPage) changes
    useEffect(() => {
        generationRef.current += 1;
        setItems([]);
        setError(null);
        setTotalCount(0);
        totalCountRef.current = 0;
        loadedCountRef.current = 0;
        busyRef.current = false;
    }, [fetchCount, fetchPage]);

    const loadBatch = useCallback(async () => {
        if (!enabled || busyRef.current) return;

        const gen = generationRef.current;
        busyRef.current = true;
        setLoading(true);
        setError(null);

        try {
            // Use the ref so we don't depend on totalCount state
            let count = totalCountRef.current;
            if (count === 0) {
                count = await fetchCount();
                if (gen !== generationRef.current) return;
                totalCountRef.current = count;
                setTotalCount(count);
            }

            if (count === 0) return;

            const loaded = loadedCountRef.current;
            const remaining = count - loaded;
            const batchSize = Math.min(pageSize, remaining);
            if (batchSize <= 0) return;

            const start = reverse ? remaining - batchSize : loaded;
            const newItems = await fetchPage(start, batchSize);
            if (gen !== generationRef.current) return;
            if (reverse) newItems.reverse();

            loadedCountRef.current = loaded + batchSize;

            // Deduplicate — safety net for any remaining race conditions
            setItems((prev) => {
                const currentGetId = getIdRef.current;
                const existingIds = new Set(prev.map(currentGetId));
                const unique = newItems.filter((item) => !existingIds.has(currentGetId(item)));
                return [...prev, ...unique];
            });
        } catch (err) {
            if (gen !== generationRef.current) return;
            setError(err instanceof Error ? err.message : "Failed to load items");
        } finally {
            if (gen === generationRef.current) {
                busyRef.current = false;
                setLoading(false);
            }
        }
    }, [enabled, fetchCount, fetchPage, pageSize, reverse]);

    const [refreshKey, setRefreshKey] = useState(0);

    const refresh = useCallback(() => {
        generationRef.current += 1;
        setItems([]);
        setError(null);
        setTotalCount(0);
        totalCountRef.current = 0;
        loadedCountRef.current = 0;
        busyRef.current = false;
        setRefreshKey((k) => k + 1);
    }, []);

    // Initial load + refresh
    useEffect(() => {
        if (enabled && loadedCountRef.current === 0) {
            loadBatch();
        }
    }, [enabled, loadBatch, refreshKey]);

    const hasMore = loadedCountRef.current < totalCountRef.current;

    return { items, loading, error, hasMore, loadMore: loadBatch, refresh, totalCount };
}
