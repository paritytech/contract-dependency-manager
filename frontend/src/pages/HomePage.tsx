import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import Layout from '../components/Layout';
import PackageCard from '../components/PackageCard';
import { packages } from '../data/packages';
import './HomePage.css';

export default function HomePage() {
  const [query, setQuery] = useState('');
  const navigate = useNavigate();

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = query.trim();
    if (trimmed) {
      navigate(`/search?q=${encodeURIComponent(trimmed)}`);
    }
  };

  const totalPackages = packages.length;
  const totalDownloads = packages.reduce((sum, pkg) => sum + pkg.weeklyDownloads, 0);
  const featured = packages.slice(0, 6);

  return (
    <Layout>
      <section className="hero">
        <div className="hero-inner">
          <h1 className="hero-tagline">Build amazing things</h1>
          <p className="hero-subtitle">The world's largest software registry</p>
          <form className="hero-search-form" onSubmit={handleSubmit}>
            <input
              className="hero-search-input"
              type="text"
              placeholder="Search packages"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <button className="hero-search-btn" type="submit">Search</button>
          </form>
        </div>
      </section>

      <section className="stats-row">
        <div className="stat-item">
          <div className="stat-value">{totalPackages.toLocaleString()}</div>
          <div className="stat-label">Total Packages</div>
        </div>
        <div className="stat-item">
          <div className="stat-value">{totalDownloads.toLocaleString()}</div>
          <div className="stat-label">Weekly Downloads</div>
        </div>
      </section>

      <section className="featured-section">
        <h2 className="featured-title">Featured Packages</h2>
        <div className="featured-grid">
          {featured.map((pkg) => (
            <PackageCard key={pkg.name} pkg={pkg} />
          ))}
        </div>
      </section>
    </Layout>
  );
}
