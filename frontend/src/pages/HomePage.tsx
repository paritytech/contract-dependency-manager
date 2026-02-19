import { useState, useRef, useEffect } from 'react';
import Layout from '../components/Layout';
import PackageCard from '../components/PackageCard';
import GrainCanvas from '../components/GrainCanvas';
import { CopyIcon, CheckIcon } from '../components/Icons';
import { useNetwork } from '../context/NetworkContext';
import { useRegistry } from '../hooks/useRegistry';
import './HomePage.css';

export default function HomePage() {
  const { network, connecting, error: networkError } = useNetwork();
  const { packages, loading, error: registryError, totalCount, hasMore, loadMore } = useRegistry();
  const [copied, setCopied] = useState(false);
  const sentinelRef = useRef<HTMLDivElement>(null);

  const installCmd = 'curl -fsSL https://polkadot.com/install-cdm | bash';
  const error = networkError || registryError;

  const loadMoreRef = useRef(loadMore);
  loadMoreRef.current = loadMore;
  const hasMoreRef = useRef(hasMore);
  hasMoreRef.current = hasMore;
  const loadingRef = useRef(loading);
  loadingRef.current = loading;

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMoreRef.current && !loadingRef.current) {
          loadMoreRef.current();
        }
      },
      { threshold: 0 }
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, []);

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
              <div className={`install-line${copied ? ' install-line-copied' : ''}`} onClick={handleCopy}>
                <span className="install-line-prompt">$</span>
                <span className="install-line-cmd">{installCmd}</span>
                {copied ? <CheckIcon className="install-line-icon" /> : <CopyIcon className="install-line-icon" />}
                <span className={`install-line-tooltip${copied ? ' install-line-tooltip-visible' : ''}`}>Copied!</span>
              </div>
            </div>
          </div>
        </section>

        <section className="stats-row">
          <div className="stat-item">
            <div className="stat-value">{totalCount.toLocaleString()}</div>
            <div className="stat-label">Contracts</div>
          </div>
          <div className="stat-item">
            <div className="stat-value">0</div>
            <div className="stat-label">Weekly Calls</div>
          </div>
        </section>
      </div>

      <section className="featured-section">
        <h2 className="featured-title">Featured Contracts</h2>
        {error ? (
          <div className="connection-error">
            <p>Could not connect to <strong>{network}</strong>. Check your connection settings.</p>
            <p className="connection-error-detail">{error}</p>
          </div>
        ) : connecting || (loading && packages.length === 0) ? (
          <div className="loading-state">
            <p>Connecting to {network}...</p>
          </div>
        ) : packages.length === 0 ? (
          <div className="loading-state">
            <p>No contracts found.</p>
          </div>
        ) : (
          <>
            <div className="featured-grid">
              {packages.map((pkg) => (
                <PackageCard key={pkg.name} pkg={pkg} />
              ))}
            </div>
            <div ref={sentinelRef} className="scroll-sentinel" />
            {loading && <div className="loading-more">Loading more...</div>}
          </>
        )}
      </section>
    </Layout>
  );
}
