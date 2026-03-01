import { useRef, useEffect } from "react";
import "./InfiniteScroll.css";

interface InfiniteScrollProps {
    hasMore: boolean;
    loading: boolean;
    loadMore: () => void;
    children: React.ReactNode;
    loadingText?: string;
}

/**
 * Wrapper that appends an IntersectionObserver sentinel after `children`.
 * Automatically triggers `loadMore` when the sentinel scrolls into view.
 *
 * The observer is torn down while a load is in-flight (`loading`) or when
 * there is nothing left to fetch (`!hasMore`), preventing double-fires.
 */
export default function InfiniteScroll({
    hasMore,
    loading,
    loadMore,
    children,
    loadingText = "Loading more...",
}: InfiniteScrollProps) {
    const sentinelRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const sentinel = sentinelRef.current;
        if (!sentinel || !hasMore || loading) return;

        const observer = new IntersectionObserver(
            (entries) => {
                if (entries[0].isIntersecting) {
                    loadMore();
                }
            },
            { threshold: 0.1 },
        );
        observer.observe(sentinel);
        return () => observer.disconnect();
    }, [hasMore, loading, loadMore]);

    return (
        <>
            {children}
            {loading && <div className="infinite-scroll-loading">{loadingText}</div>}
            {hasMore && <div ref={sentinelRef} className="infinite-scroll-sentinel" />}
        </>
    );
}
