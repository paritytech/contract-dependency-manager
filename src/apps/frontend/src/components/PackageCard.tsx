import { Link } from "react-router-dom";
import type { Package } from "../data/types";
import "./PackageCard.css";

interface PackageCardProps {
    pkg: Package;
    linkTarget?: string;
}

function formatCalls(n: number): string {
    return n.toLocaleString();
}

function splitPackageName(name: string): { prefix: string; leaf: string } {
    const idx = name.lastIndexOf("/");
    if (idx < 0) return { prefix: "", leaf: name };
    return {
        prefix: name.slice(0, idx + 1),
        leaf: name.slice(idx + 1),
    };
}

export default function PackageCard({ pkg, linkTarget }: PackageCardProps) {
    const metadataLoading =
        pkg.metadataUri && !pkg.metadataUri.includes(":") && !pkg.metadataLoaded;
    const name = splitPackageName(pkg.name);

    const cardBody = (
        <>
            <div className="package-card-header">
                <span className="package-card-name">
                    <span className="package-card-name-prefix">{name.prefix}</span>
                    <span className="package-card-name-leaf">{name.leaf}</span>
                </span>
                <span className="package-card-version">v{pkg.version}</span>
            </div>

            {pkg.description ? (
                <p className="package-card-description">{pkg.description}</p>
            ) : metadataLoading ? (
                <p className="package-card-description package-card-shimmer">&nbsp;</p>
            ) : null}

            <div className="package-card-meta">
                {pkg.author ? (
                    <span className="package-card-author">{pkg.author}</span>
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
                    <span className="package-card-date">{pkg.publishedDate}</span>
                )}
            </div>
        </>
    );

    if (linkTarget) {
        return (
            <a
                href={`/#/package/${pkg.name}`}
                target={linkTarget}
                rel="noopener noreferrer"
                className="package-card"
            >
                {cardBody}
            </a>
        );
    }

    return (
        <Link to={`/package/${pkg.name}`} className="package-card">
            {cardBody}
        </Link>
    );
}
