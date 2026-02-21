import { Link } from "react-router-dom";
import type { Package } from "../data/types";
import "./PackageCard.css";

interface PackageCardProps {
    pkg: Package;
}

function formatCalls(n: number): string {
    return n.toLocaleString();
}

export default function PackageCard({ pkg }: PackageCardProps) {
    const metadataLoading =
        pkg.metadataUri && !pkg.metadataUri.includes(":") && !pkg.metadataLoaded;

    return (
        <div className="package-card">
            <div className="package-card-header">
                <Link to={`/package/${pkg.name}`} className="package-card-name">
                    {pkg.name}
                </Link>
                <span className="package-card-version">v{pkg.version}</span>
            </div>

            {pkg.description ? (
                <p className="package-card-description">{pkg.description}</p>
            ) : metadataLoading ? (
                <p className="package-card-description package-card-shimmer">&nbsp;</p>
            ) : null}

            <div className="package-card-meta">
                {pkg.author ? (
                    <span className="package-card-author">by {pkg.author}</span>
                ) : metadataLoading ? (
                    <span className="package-card-author package-card-shimmer">
                        &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;
                    </span>
                ) : null}
                {pkg.weeklyCalls != null && (
                    <span className="package-card-downloads">
                        {formatCalls(pkg.weeklyCalls)} weekly calls
                    </span>
                )}
                {pkg.publishedDate && (
                    <span className="package-card-date">published {pkg.publishedDate}</span>
                )}
            </div>

            {(pkg.keywords ?? []).length > 0 && (
                <div className="package-card-keywords">
                    {(pkg.keywords ?? []).map((kw) => (
                        <Link
                            key={kw}
                            to={`/search?q=${encodeURIComponent(kw)}`}
                            className="package-card-keyword"
                        >
                            {kw}
                        </Link>
                    ))}
                </div>
            )}
        </div>
    );
}
