import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import Layout from '../components/Layout';
import { packages } from '../data/packages';
import './PackagePage.css';

type TabName = 'readme' | 'dependencies' | 'versions';

function simpleMarkdownToHtml(md: string): string {
  let html = md
    // Code blocks
    .replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code>$2</code></pre>')
    // Inline code
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    // Images
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img alt="$1" src="$2" />')
    // Links
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
    // H3
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    // H2
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    // H1
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    // Bold
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    // Italic
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    // Unordered list items
    .replace(/^- (.+)$/gm, '<li>$1</li>');

  // Wrap consecutive <li> in <ul>
  html = html.replace(/((?:<li>.*<\/li>\n?)+)/g, '<ul>$1</ul>');

  // Paragraphs: wrap lines that aren't already HTML tags
  html = html
    .split('\n\n')
    .map((block) => {
      const trimmed = block.trim();
      if (!trimmed) return '';
      if (/^<(h[1-6]|pre|ul|ol|li|img|div|blockquote)/.test(trimmed)) return trimmed;
      return `<p>${trimmed}</p>`;
    })
    .join('\n');

  return html;
}

function formatNumber(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toString();
}

export default function PackagePage() {
  const params = useParams();
  const name = params['*'];
  const [activeTab, setActiveTab] = useState<TabName>('readme');
  const [copied, setCopied] = useState(false);

  const pkg = packages.find((p) => p.name === name);

  if (!pkg) {
    return (
      <Layout>
        <div className="package-not-found">
          <h2>404 - Contract Not Found</h2>
          <p>The contract &ldquo;{name}&rdquo; could not be found.</p>
          <Link to="/">Go back to home</Link>
        </div>
      </Layout>
    );
  }

  const handleCopy = () => {
    navigator.clipboard.writeText(`cdm i ${pkg.name}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const depEntries = Object.entries(pkg.dependencies);

  // Fake weekly call data for chart
  const weeklyData = [
    Math.round(pkg.weeklyCalls * 0.85),
    Math.round(pkg.weeklyCalls * 0.9),
    Math.round(pkg.weeklyCalls * 0.95),
    Math.round(pkg.weeklyCalls * 0.88),
    pkg.weeklyCalls,
  ];
  const maxCalls = Math.max(...weeklyData);

  return (
    <Layout>
      <div className="package-page">
        <div className="package-main">
          <div className="package-title-row">
            <h1 className="package-name">{pkg.name}</h1>
            <span className="package-version-badge">v{pkg.version}</span>
          </div>

          <div className="install-box">
            <span className="install-command">cdm i {pkg.name}</span>
            <button className="install-copy-btn" onClick={handleCopy}>
              {copied ? 'Copied!' : 'Copy'}
            </button>
          </div>

          <div className="package-tabs">
            {(['readme', 'dependencies', 'versions'] as TabName[]).map((tab) => (
              <button
                key={tab}
                className={`package-tab${activeTab === tab ? ' active' : ''}`}
                onClick={() => setActiveTab(tab)}
              >
                {tab.charAt(0).toUpperCase() + tab.slice(1)}
                {tab === 'dependencies' && ` (${depEntries.length})`}
              </button>
            ))}
          </div>

          {activeTab === 'readme' && (
            <div
              className="package-readme"
              dangerouslySetInnerHTML={{ __html: simpleMarkdownToHtml(pkg.readme) }}
            />
          )}

          {activeTab === 'dependencies' && (
            <>
              {depEntries.length === 0 ? (
                <p className="deps-empty">This contract has no dependencies.</p>
              ) : (
                <ul className="deps-list">
                  {depEntries.map(([depName, version]) => (
                    <li key={depName}>
                      <Link to={`/package/${depName}`}>{depName}</Link>
                      <span>{version}</span>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}

          {activeTab === 'versions' && (
            <table className="versions-table">
              <thead>
                <tr>
                  <th>Version</th>
                  <th>Date</th>
                </tr>
              </thead>
              <tbody>
                {pkg.versions.map((v) => (
                  <tr key={v.version}>
                    <td>v{v.version}</td>
                    <td>{v.date}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <aside className="package-sidebar">
          <div className="sidebar-section">
            <div className="sidebar-section-title">Weekly Calls</div>
            <div className="sidebar-value large">{formatNumber(pkg.weeklyCalls)}</div>
            <div className="downloads-chart">
              {weeklyData.map((val, i) => (
                <div
                  key={i}
                  className="chart-bar"
                  style={{ height: `${(val / maxCalls) * 100}%` }}
                />
              ))}
            </div>
          </div>

          <div className="sidebar-section">
            <div className="sidebar-section-title">Version</div>
            <div className="sidebar-value">v{pkg.version}</div>
          </div>

          <div className="sidebar-section">
            <div className="sidebar-section-title">License</div>
            <div className="sidebar-value">{pkg.license}</div>
          </div>

          <div className="sidebar-section">
            <div className="sidebar-section-title">Last Published</div>
            <div className="sidebar-value">{pkg.lastPublished}</div>
          </div>

          <div className="sidebar-section">
            <div className="sidebar-section-title">Repository</div>
            <a className="sidebar-link" href={pkg.repository} target="_blank" rel="noopener noreferrer">
              {pkg.repository.replace('https://github.com/', '')}
            </a>
          </div>

          <div className="sidebar-section">
            <div className="sidebar-section-title">Homepage</div>
            <a className="sidebar-link" href={pkg.homepage} target="_blank" rel="noopener noreferrer">
              {pkg.homepage.replace('https://', '')}
            </a>
          </div>

          {pkg.keywords.length > 0 && (
            <div className="sidebar-section">
              <div className="sidebar-section-title">Keywords</div>
              <div className="sidebar-keywords">
                {pkg.keywords.map((kw) => (
                  <Link
                    key={kw}
                    to={`/search?q=${encodeURIComponent(kw)}`}
                    className="sidebar-keyword"
                  >
                    {kw}
                  </Link>
                ))}
              </div>
            </div>
          )}

          <div className="sidebar-section">
            <div className="sidebar-section-title">Collaborators</div>
            <div className="sidebar-value">{pkg.author}</div>
          </div>
        </aside>
      </div>
    </Layout>
  );
}
