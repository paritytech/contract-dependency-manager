import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import Layout from '../components/Layout';
import { CopyIcon, CheckIcon } from '../components/Icons';
import { useNetwork } from '../context/NetworkContext';
import { useRegistry } from '../hooks/useRegistry';
import type { AbiEntry, AbiParam } from '../data/types';
import './PackagePage.css';

marked.setOptions({ gfm: true, breaks: true });

type TabName = 'readme' | 'abi' | 'dependencies' | 'versions';

function formatParamType(param: AbiParam): string {
  if (param.type === 'tuple' && param.components) {
    return `(${param.components.map(c => formatParamType(c)).join(', ')})`;
  }
  return param.type;
}

function formatSignature(entry: AbiEntry): string {
  const name = entry.name ?? entry.type;
  const params = (entry.inputs ?? []).map(p => formatParamType(p)).join(', ');
  const returns = (entry.outputs ?? []).filter(o => o.type);
  const returnStr = returns.length > 0
    ? ` \u2192 ${returns.map(r => formatParamType(r)).join(', ')}`
    : '';
  return `${name}(${params})${returnStr}`;
}

function getBadgeClass(mutability?: string): string {
  switch (mutability) {
    case 'view':
    case 'pure':
      return 'abi-badge view';
    case 'payable':
      return 'abi-badge payable';
    default:
      return 'abi-badge nonpayable';
  }
}

function ParamType({ param, depth = 0 }: { param: AbiParam; depth?: number }) {
  if (param.type === 'tuple' && param.components && param.components.length > 0) {
    return (
      <span className="abi-tuple-type">
        <span className="abi-type-name">{'{'}</span>
        <span className="abi-tuple-fields">
          {param.components.map((c, i) => (
            <span key={i} className="abi-tuple-field" style={{ paddingLeft: `${(depth + 1) * 16}px` }}>
              <span className="abi-param-name">{c.name}</span>
              <span className="abi-param-colon">: </span>
              <ParamType param={c} depth={depth + 1} />
            </span>
          ))}
        </span>
        <span className="abi-type-name" style={{ paddingLeft: `${depth * 16}px` }}>{'}'}</span>
      </span>
    );
  }
  return <span className="abi-type-name">{param.type}</span>;
}

function AbiEntryCard({ entry }: { entry: AbiEntry }) {
  const [expanded, setExpanded] = useState(false);
  const inputs = entry.inputs ?? [];
  const outputs = entry.outputs ?? [];

  return (
    <div className={`abi-entry${expanded ? ' expanded' : ''}`}>
      <button className="abi-entry-header" onClick={() => setExpanded(!expanded)}>
        <span className={getBadgeClass(entry.stateMutability)}>
          {(entry.stateMutability ?? 'nonpayable').toUpperCase()}
        </span>
        <code className="abi-fn-signature">{formatSignature(entry)}</code>
        <span className="abi-expand-icon">{expanded ? '\u25B2' : '\u25BC'}</span>
      </button>
      {expanded && (
        <div className="abi-entry-body">
          <div className="abi-params-section">
            <div className="abi-params-label">Parameters</div>
            {inputs.length === 0 ? (
              <span className="abi-params-none">No parameters</span>
            ) : (
              <table className="abi-params-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Type</th>
                  </tr>
                </thead>
                <tbody>
                  {inputs.map((p, i) => (
                    <tr key={i}>
                      <td><code>{p.name || `_${i}`}</code></td>
                      <td><code><ParamType param={p} /></code></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          {outputs.length > 0 && (
            <div className="abi-params-section">
              <div className="abi-params-label">Returns</div>
              <table className="abi-params-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Type</th>
                  </tr>
                </thead>
                <tbody>
                  {outputs.map((p, i) => (
                    <tr key={i}>
                      <td><code>{p.name || `_${i}`}</code></td>
                      <td><code><ParamType param={p} /></code></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function AbiTab({ abi }: { abi: AbiEntry[] }) {
  if (abi.length === 0) {
    return <p className="deps-empty">No ABI entries found.</p>;
  }

  const grouped = new Map<string, AbiEntry[]>();
  for (const entry of abi) {
    const key = entry.type;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(entry);
  }

  // Order: constructor first, then functions, then everything else
  const order = ['constructor', 'function', 'event', 'error', 'fallback', 'receive'];
  const sortedKeys = [...grouped.keys()].sort((a, b) => {
    const ai = order.indexOf(a);
    const bi = order.indexOf(b);
    return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
  });

  const sectionLabels: Record<string, string> = {
    constructor: 'Constructor',
    function: 'Functions',
    event: 'Events',
    error: 'Errors',
    fallback: 'Fallback',
    receive: 'Receive',
  };

  return (
    <div className="abi-tab">
      {sortedKeys.map((key) => (
        <div key={key} className="abi-section">
          <h3 className="abi-section-title">{sectionLabels[key] ?? key}</h3>
          {grouped.get(key)!.map((entry, i) => (
            <AbiEntryCard key={`${entry.name ?? key}-${i}`} entry={entry} />
          ))}
        </div>
      ))}
    </div>
  );
}


export default function PackagePage() {
  const params = useParams();
  const name = params['*'];
  const [activeTab, setActiveTab] = useState<TabName>('readme');
  const [copied, setCopied] = useState(false);
  const [addrCopied, setAddrCopied] = useState(false);

  const { network, connecting, error: networkError } = useNetwork();
  const { packages, loading, error: registryError } = useRegistry();
  const error = networkError || registryError;
  const pkg = packages.find((p) => p.name === name);

  if (connecting || (loading && packages.length === 0)) {
    return (
      <Layout>
        <div className="package-not-found">
          <p>Connecting to {network}...</p>
        </div>
      </Layout>
    );
  }

  if (error) {
    return (
      <Layout>
        <div className="package-not-found">
          <h2>Connection Error</h2>
          <p>Could not connect to <strong>{network}</strong>. Check your connection settings.</p>
          <p>{error}</p>
        </div>
      </Layout>
    );
  }

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

  const namedPresets = ['polkadot', 'paseo', 'preview-net'];
  const installCmd = namedPresets.includes(network)
    ? `cdm i -n ${network} ${pkg.name}`
    : `cdm i ${pkg.name}`;
  const handleCopy = () => {
    navigator.clipboard.writeText(installCmd);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const depEntries = Object.entries(pkg.dependencies ?? {});
  const versions = pkg.versions ?? [];
  const hasVersions = versions.length > 0;

  return (
    <Layout>
      <div className="package-page">
        <div className="package-main">
          <div className="package-title-row">
            <h1 className="package-name">{pkg.name}</h1>
            <span className="package-version-badge">v{pkg.version}</span>
          </div>

          <div className="install-box">
            <span className="install-command">{installCmd}</span>
            <button className="install-copy-btn" onClick={handleCopy}>
              {copied ? 'Copied!' : 'Copy'}
            </button>
          </div>

          <div className="package-tabs">
            {(['readme', 'abi', 'dependencies', 'versions'] as TabName[]).map((tab) => (
              <button
                key={tab}
                className={`package-tab${activeTab === tab ? ' active' : ''}`}
                onClick={() => setActiveTab(tab)}
              >
                {tab === 'abi' ? 'ABI' : tab.charAt(0).toUpperCase() + tab.slice(1)}
                {tab === 'abi' && pkg.abi ? ` (${pkg.abi.length})` : ''}
                {tab === 'dependencies' && ` (${depEntries.length})`}
              </button>
            ))}
          </div>

          {activeTab === 'readme' && (
            pkg.readme ? (
              <div
                className="package-readme"
                dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(marked.parse(pkg.readme) as string) }}
              />
            ) : !pkg.metadataLoaded && pkg.metadataUri ? (
              <p className="deps-empty">Loading readme...</p>
            ) : (
              <p className="deps-empty">No readme published yet.</p>
            )
          )}

          {activeTab === 'abi' && (
            pkg.abi && pkg.abi.length > 0 ? (
              <AbiTab abi={pkg.abi} />
            ) : !pkg.metadataLoaded && pkg.metadataUri ? (
              <p className="deps-empty">Loading ABI...</p>
            ) : (
              <p className="deps-empty">No ABI published yet.</p>
            )
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
            hasVersions ? (
              <table className="versions-table">
                <thead>
                  <tr>
                    <th>Version</th>
                    <th>Date</th>
                  </tr>
                </thead>
                <tbody>
                  {versions.map((v) => (
                    <tr key={v.version}>
                      <td>v{v.version}</td>
                      <td>{v.date}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <table className="versions-table">
                <thead>
                  <tr>
                    <th>Version</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>v{pkg.version}</td>
                  </tr>
                </tbody>
              </table>
            )
          )}
        </div>

        <aside className="package-sidebar">
          <div className="sidebar-section">
            <div className="sidebar-section-title">Version</div>
            <div className="sidebar-value">v{pkg.version}</div>
          </div>

          {pkg.address && (
            <div className="sidebar-section">
              <div className="sidebar-section-title">Contract Address</div>
              <div
                className="sidebar-value address-value"
                title={pkg.address}
                onClick={() => {
                  navigator.clipboard.writeText(pkg.address!);
                  setAddrCopied(true);
                  setTimeout(() => setAddrCopied(false), 2000);
                }}
              >
                <span className="address-text">{pkg.address.slice(0, 12)}</span>
                {addrCopied ? <CheckIcon className="address-copy-icon" /> : <CopyIcon className="address-copy-icon" />}
              </div>
            </div>
          )}

          {pkg.lastPublished && (
            <div className="sidebar-section">
              <div className="sidebar-section-title">Last Published</div>
              <div className="sidebar-value">{pkg.lastPublished}</div>
            </div>
          )}

          {pkg.repository && (
            <div className="sidebar-section">
              <div className="sidebar-section-title">Repository</div>
              <a className="sidebar-link" href={pkg.repository} target="_blank" rel="noopener noreferrer">
                {pkg.repository.replace('https://github.com/', '')}
              </a>
            </div>
          )}

          {pkg.homepage && (
            <div className="sidebar-section">
              <div className="sidebar-section-title">Homepage</div>
              <a className="sidebar-link" href={pkg.homepage} target="_blank" rel="noopener noreferrer">
                {pkg.homepage.replace('https://', '')}
              </a>
            </div>
          )}

          {(pkg.keywords ?? []).length > 0 && (
            <div className="sidebar-section">
              <div className="sidebar-section-title">Keywords</div>
              <div className="sidebar-keywords">
                {(pkg.keywords ?? []).map((kw) => (
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

          {pkg.author && (
            <div className="sidebar-section">
              <div className="sidebar-section-title">Collaborators</div>
              <div className="sidebar-value">{pkg.author}</div>
            </div>
          )}
        </aside>
      </div>
    </Layout>
  );
}
