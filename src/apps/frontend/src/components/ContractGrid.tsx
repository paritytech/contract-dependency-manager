import type { Package } from "../data/types";
import PackageCard from "./PackageCard";
import InfiniteScroll from "./InfiniteScroll";
import "./ContractGrid.css";

interface ContractGridProps {
    packages: Package[];
    loading: boolean;
    hasMore: boolean;
    loadMore: () => void;
    network: string;
    connecting: boolean;
    error: string | null;
    linkTarget?: string;
}

export default function ContractGrid({
    packages,
    loading,
    hasMore,
    loadMore,
    network,
    connecting,
    error,
    linkTarget,
}: ContractGridProps) {
    if (error) {
        return (
            <div className="contract-grid-message">
                <p>
                    Could not connect to <strong>{network}</strong>. Check your connection settings.
                </p>
                <p className="contract-grid-error-detail">{error}</p>
            </div>
        );
    }

    if (connecting || (loading && packages.length === 0)) {
        return (
            <div className="contract-grid-message">
                <p>Connecting to {network}...</p>
            </div>
        );
    }

    if (packages.length === 0) {
        return (
            <div className="contract-grid-message">
                <p>No contracts found.</p>
            </div>
        );
    }

    return (
        <InfiniteScroll hasMore={hasMore} loading={loading} loadMore={loadMore}>
            <div className="contract-grid">
                {packages.map((pkg) => (
                    <PackageCard key={pkg.name} pkg={pkg} linkTarget={linkTarget} />
                ))}
            </div>
        </InfiniteScroll>
    );
}
