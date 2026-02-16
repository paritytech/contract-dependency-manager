import { Link } from 'react-router-dom';
import type { Package } from '../data/types';
import './PackageCard.css';

interface PackageCardProps {
  pkg: Package;
}

function formatCalls(n: number): string {
  return n.toLocaleString();
}

export default function PackageCard({ pkg }: PackageCardProps) {
  return (
    <div className="package-card">
      <div className="package-card-header">
        <Link to={`/package/${pkg.name}`} className="package-card-name">
          {pkg.name}
        </Link>
        <span className="package-card-version">v{pkg.version}</span>
      </div>

      {pkg.description && (
        <p className="package-card-description">{pkg.description}</p>
      )}

      <div className="package-card-meta">
        {pkg.author && (
          <span className="package-card-author">by {pkg.author}</span>
        )}
        <span className="package-card-downloads">
          {formatCalls(pkg.weeklyCalls)} weekly calls
        </span>
        <span className="package-card-date">
          published {pkg.publishedDate}
        </span>
      </div>

      {pkg.keywords.length > 0 && (
        <div className="package-card-keywords">
          {pkg.keywords.map((kw) => (
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
