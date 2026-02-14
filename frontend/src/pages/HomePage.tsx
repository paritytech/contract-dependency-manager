import Layout from '../components/Layout';
import PackageCard from '../components/PackageCard';
import { packages } from '../data/packages';
import './HomePage.css';

export default function HomePage() {
  const totalPackages = packages.length;
  const totalDownloads = packages.reduce((sum, pkg) => sum + pkg.weeklyDownloads, 0);
  const featured = packages.slice(0, 6);

  return (
    <Layout>
      <section className="hero">
        <div className="hero-inner">
          <h1 className="hero-tagline">Build amazing things</h1>
          <p className="hero-subtitle">The world's largest contract library</p>
        </div>
      </section>

      <section className="stats-row">
        <div className="stat-item">
          <div className="stat-value">{totalPackages.toLocaleString()}</div>
          <div className="stat-label">Total Contracts</div>
        </div>
        <div className="stat-item">
          <div className="stat-value">{totalDownloads.toLocaleString()}</div>
          <div className="stat-label">Weekly Downloads</div>
        </div>
      </section>

      <section className="featured-section">
        <h2 className="featured-title">Featured Contracts</h2>
        <div className="featured-grid">
          {featured.map((pkg) => (
            <PackageCard key={pkg.name} pkg={pkg} />
          ))}
        </div>
      </section>
    </Layout>
  );
}
