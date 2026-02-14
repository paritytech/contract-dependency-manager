import { useState, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import Layout from '../components/Layout';
import PackageCard from '../components/PackageCard';
import { packages } from '../data/packages';
import './SearchPage.css';

type SortMode = 'popularity' | 'quality' | 'maintenance';

export default function SearchPage() {
  const [searchParams] = useSearchParams();
  const query = searchParams.get('q') || '';
  const [sort, setSort] = useState<SortMode>('popularity');

  const results = useMemo(() => {
    if (!query) return [];
    const lower = query.toLowerCase();
    const filtered = packages.filter(
      (pkg) =>
        pkg.name.toLowerCase().includes(lower) ||
        pkg.description.toLowerCase().includes(lower) ||
        pkg.keywords.some((kw) => kw.toLowerCase().includes(lower))
    );

    const sorted = [...filtered];
    switch (sort) {
      case 'popularity':
        sorted.sort((a, b) => b.weeklyDownloads - a.weeklyDownloads);
        break;
      case 'quality':
        sorted.sort((a, b) => a.name.localeCompare(b.name));
        break;
      case 'maintenance':
        sorted.sort((a, b) => a.name.localeCompare(b.name));
        break;
    }
    return sorted;
  }, [query, sort]);

  if (!query) {
    return (
      <Layout>
        <div className="search-empty">
          <h2>Search for packages</h2>
          <p>Enter a search term to find packages on cdm.</p>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="search-page">
        <div className="search-header">
          <p className="search-result-count">
            <strong>{results.length}</strong> package{results.length !== 1 ? 's' : ''} found for &ldquo;{query}&rdquo;
          </p>
          <div className="search-sort-bar">
            {(['popularity', 'quality', 'maintenance'] as SortMode[]).map((mode) => (
              <button
                key={mode}
                className={`sort-btn${sort === mode ? ' active' : ''}`}
                onClick={() => setSort(mode)}
              >
                {mode.charAt(0).toUpperCase() + mode.slice(1)}
              </button>
            ))}
          </div>
        </div>

        {results.length === 0 ? (
          <div className="search-empty">
            <h2>No packages found</h2>
            <p>Try a different search term.</p>
          </div>
        ) : (
          <div className="search-results-list">
            {results.map((pkg) => (
              <PackageCard key={pkg.name} pkg={pkg} />
            ))}
          </div>
        )}
      </div>
    </Layout>
  );
}
