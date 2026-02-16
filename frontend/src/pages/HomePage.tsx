import { useState } from 'react';
import Layout from '../components/Layout';
import PackageCard from '../components/PackageCard';
import GrainCanvas from '../components/GrainCanvas';
import { packages } from '../data/packages';
import './HomePage.css';

export default function HomePage() {
  const totalPackages = packages.length;
  const totalCalls = packages.reduce((sum, pkg) => sum + pkg.weeklyCalls, 0);
  const featured = packages.slice(0, 6);
  const [copied, setCopied] = useState(false);

  const installCmd = 'curl -fsSL https://polkadot.com/install-cdm | bash';

  const handleCopy = () => {
    navigator.clipboard.writeText(installCmd);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Layout>
      <div className="hero-grain-wrapper">
        <GrainCanvas />
        <section className="hero">
          <div className="hero-inner">
            <h1 className="hero-tagline">Build the future</h1>
            <p className="hero-subtitle">The world's largest smart contract library</p>
            <div className="install-widget">
              <span className="install-widget-title">Install cdm v0.0.1</span>
              <div className="install-line" onClick={handleCopy}>
                <span className="install-line-prompt">$</span>
                <span className="install-line-cmd">{installCmd}</span>
                <span className="install-line-copy">{copied ? 'Copied!' : 'Copy'}</span>
              </div>
            </div>
          </div>
        </section>

        <section className="stats-row">
          <div className="stat-item">
            <div className="stat-value">{totalPackages.toLocaleString()}</div>
            <div className="stat-label">Contracts</div>
          </div>
          <div className="stat-item">
            <div className="stat-value">{totalCalls.toLocaleString()}</div>
            <div className="stat-label">Weekly Calls</div>
          </div>
        </section>
      </div>

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
