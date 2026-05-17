import "./SkeletonCard.css";

interface SkeletonGridProps {
    count?: number;
}

export function SkeletonCard() {
    return (
        <div className="package-card package-card--skeleton" aria-hidden="true">
            <div className="package-card-header">
                <span className="skeleton-bar skeleton-bar--name" />
                <span className="skeleton-bar skeleton-bar--version" />
            </div>
            <div className="package-card-description">
                <span className="skeleton-bar skeleton-bar--desc" />
                <span className="skeleton-bar skeleton-bar--desc skeleton-bar--desc-short" />
            </div>
            <div className="package-card-meta">
                <span className="skeleton-bar skeleton-bar--author" />
                <span className="skeleton-bar skeleton-bar--date" />
            </div>
        </div>
    );
}

export function SkeletonGrid({ count = 9 }: SkeletonGridProps) {
    return (
        <div className="contract-grid" aria-hidden="true">
            {Array.from({ length: count }).map((_, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: fixed-length decorative array
                <SkeletonCard key={i} />
            ))}
        </div>
    );
}
