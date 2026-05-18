import { useState } from "react";
import { useParams, Link } from "react-router-dom";
import { marked } from "marked";
import DOMPurify from "dompurify";
import Layout from "../components/Layout";
import { CopyIcon, CheckIcon } from "../components/Icons";
import { handleExternalClick } from "../lib/external-link";
import { usePackage } from "../hooks/usePackage";
import type { AbiEntry, AbiParam, Package } from "../data/types";
import "../components/SkeletonCard.css";
import "./PackagePage.css";

marked.setOptions({ gfm: true, breaks: true });

type TabName = "readme" | "abi" | "dependencies" | "versions";

function formatParamType(param: AbiParam): string {
    if (param.type.startsWith("tuple") && param.components) {
        const suffix = param.type.slice("tuple".length);
        return `(${param.components.map((c) => formatParamType(c)).join(", ")})${suffix}`;
    }
    return param.type;
}

function formatSignature(entry: AbiEntry): string {
    const name = entry.name ?? entry.type;
    const params = (entry.inputs ?? []).map((p) => formatParamType(p)).join(", ");
    const returns = (entry.outputs ?? []).filter((o) => o.type);
    const returnStr =
        returns.length > 0 ? ` → ${returns.map((r) => formatParamType(r)).join(", ")}` : "";
    return `${name}(${params})${returnStr}`;
}

function getBadgeLabel(entry: AbiEntry): string {
    if (entry.type !== "function" && entry.type !== "constructor") {
        return entry.type.toUpperCase();
    }
    return (entry.stateMutability ?? "nonpayable").toUpperCase();
}

function getBadgeClass(entry: AbiEntry): string {
    if (entry.type === "event") return "abi-badge abi-badge--event";
    if (entry.type === "error") return "abi-badge abi-badge--error";

    switch (entry.stateMutability) {
        case "view":
        case "pure":
            return "abi-badge abi-badge--view";
        case "payable":
            return "abi-badge abi-badge--payable";
        default:
            return "abi-badge abi-badge--nonpayable";
    }
}

function splitName(name: string): { prefix: string; leaf: string } {
    const idx = name.lastIndexOf("/");
    if (idx < 0) return { prefix: "", leaf: name };
    return { prefix: name.slice(0, idx + 1), leaf: name.slice(idx + 1) };
}

function shortAddress(addr: string): string {
    if (addr.length <= 14) return addr;
    return `${addr.slice(0, 8)}…${addr.slice(-6)}`;
}

function ParamType({ param, depth = 0 }: { param: AbiParam; depth?: number }) {
    if (param.type.startsWith("tuple") && param.components && param.components.length > 0) {
        const suffix = param.type.slice("tuple".length);

        return (
            <span className="abi-tuple-type">
                <span className="abi-type-name">{"{"}</span>
                <span className="abi-tuple-fields">
                    {param.components.map((c, i) => (
                        <span
                            // biome-ignore lint/suspicious/noArrayIndexKey: tuple field index is stable
                            key={i}
                            className="abi-tuple-field"
                            style={{ paddingLeft: `${(depth + 1) * 16}px` }}
                        >
                            <span className="abi-param-name">{c.name}</span>
                            <span className="abi-param-colon">: </span>
                            <ParamType param={c} depth={depth + 1} />
                        </span>
                    ))}
                </span>
                <span className="abi-type-name" style={{ paddingLeft: `${depth * 16}px` }}>
                    {"}"}
                    {suffix}
                </span>
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
        <div className={`abi-entry${expanded ? " abi-entry--expanded" : ""}`}>
            <button
                type="button"
                className="abi-entry-header"
                onClick={() => setExpanded((v) => !v)}
            >
                <span className={getBadgeClass(entry)}>{getBadgeLabel(entry)}</span>
                <code className="abi-fn-signature">{formatSignature(entry)}</code>
                <span className={`abi-expand-icon${expanded ? " abi-expand-icon--open" : ""}`}>
                    <svg width="10" height="10" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                        <path
                            d="M4 6l4 4 4-4"
                            stroke="currentColor"
                            strokeWidth="1.6"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                        />
                    </svg>
                </span>
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
                                        // biome-ignore lint/suspicious/noArrayIndexKey: param index is stable
                                        <tr key={i}>
                                            <td>
                                                <code>{p.name || `_${i}`}</code>
                                            </td>
                                            <td>
                                                <code>
                                                    <ParamType param={p} />
                                                </code>
                                            </td>
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
                                        // biome-ignore lint/suspicious/noArrayIndexKey: param index is stable
                                        <tr key={i}>
                                            <td>
                                                <code>{p.name || `_${i}`}</code>
                                            </td>
                                            <td>
                                                <code>
                                                    <ParamType param={p} />
                                                </code>
                                            </td>
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
        return <p className="package-empty">No ABI entries published.</p>;
    }

    const grouped = new Map<string, AbiEntry[]>();
    for (const entry of abi) {
        const key = entry.type;
        if (!grouped.has(key)) grouped.set(key, []);
        grouped.get(key)!.push(entry);
    }

    const order = ["constructor", "function", "event", "error", "fallback", "receive"];
    const sortedKeys = [...grouped.keys()].sort((a, b) => {
        const ai = order.indexOf(a);
        const bi = order.indexOf(b);
        return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
    });

    const sectionLabels: Record<string, string> = {
        constructor: "Constructor",
        function: "Functions",
        event: "Events",
        error: "Errors",
        fallback: "Fallback",
        receive: "Receive",
    };

    return (
        <div className="abi-tab">
            {sortedKeys.map((key) => (
                <section key={key} className="abi-section">
                    <h3 className="abi-section-title">{sectionLabels[key] ?? key}</h3>
                    <div className="abi-section-entries">
                        {grouped.get(key)!.map((entry, i) => (
                            <AbiEntryCard key={`${entry.name ?? key}-${i}`} entry={entry} />
                        ))}
                    </div>
                </section>
            ))}
        </div>
    );
}

interface InstallBlockProps {
    command: string;
}

function InstallBlock({ command }: InstallBlockProps) {
    const [copied, setCopied] = useState(false);
    return (
        <button
            type="button"
            className={`install-block${copied ? " install-block--copied" : ""}`}
            onClick={() => {
                navigator.clipboard.writeText(command);
                setCopied(true);
                setTimeout(() => setCopied(false), 1800);
            }}
            aria-label="Copy install command"
        >
            <span className="install-block-prompt">$</span>
            <code className="install-block-cmd">{command}</code>
            <span className={`install-block-icon${copied ? " install-block-icon--copied" : ""}`}>
                {copied ? <CheckIcon /> : <CopyIcon />}
            </span>
        </button>
    );
}

interface AddressLineProps {
    address: string;
}

function AddressLine({ address }: AddressLineProps) {
    const [copied, setCopied] = useState(false);
    return (
        <button
            type="button"
            className="sidebar-address"
            onClick={() => {
                navigator.clipboard.writeText(address);
                setCopied(true);
                setTimeout(() => setCopied(false), 1800);
            }}
            aria-label={`Copy contract address ${address}`}
            title={address}
        >
            <code className="sidebar-address-text">{shortAddress(address)}</code>
            <span
                className={`sidebar-address-icon${copied ? " sidebar-address-icon--copied" : ""}`}
            >
                {copied ? <CheckIcon /> : <CopyIcon />}
            </span>
        </button>
    );
}

interface PackageBodyProps {
    pkg: Package;
    activeTab: TabName;
    setActiveTab: (tab: TabName) => void;
}

function PackageBody({ pkg, activeTab, setActiveTab }: PackageBodyProps) {
    const depEntries = Object.entries(pkg.dependencies ?? {});
    const versions = pkg.versions ?? [];
    const hasVersions = versions.length > 0;
    const metadataPending = !pkg.metadataLoaded && !!pkg.metadataUri;

    const tabs: { key: TabName; label: string; count?: number }[] = [
        { key: "readme", label: "Readme" },
        { key: "abi", label: "ABI", count: pkg.abi?.length },
        { key: "dependencies", label: "Dependencies", count: depEntries.length },
        { key: "versions", label: "Versions" },
    ];

    return (
        <div className="package-body">
            <nav className="package-tabs" aria-label="Package sections">
                {tabs.map((tab) => (
                    <button
                        key={tab.key}
                        type="button"
                        className={`package-tab${activeTab === tab.key ? " package-tab--active" : ""}`}
                        onClick={() => setActiveTab(tab.key)}
                    >
                        {tab.label}
                        {tab.count != null && tab.count > 0 ? (
                            <span className="package-tab-count">{tab.count}</span>
                        ) : null}
                    </button>
                ))}
            </nav>

            <div className="package-content">
                {activeTab === "readme" &&
                    (pkg.readme ? (
                        <div
                            className="package-readme"
                            // biome-ignore lint/security/noDangerouslySetInnerHtml: sanitized via DOMPurify
                            dangerouslySetInnerHTML={{
                                __html: DOMPurify.sanitize(marked.parse(pkg.readme) as string),
                            }}
                        />
                    ) : metadataPending ? (
                        <div className="package-readme-skeleton">
                            <span className="skeleton-bar skeleton-bar--readme" />
                            <span className="skeleton-bar skeleton-bar--readme" />
                            <span className="skeleton-bar skeleton-bar--readme skeleton-bar--readme-short" />
                            <span className="skeleton-bar skeleton-bar--readme" />
                            <span className="skeleton-bar skeleton-bar--readme skeleton-bar--readme-short" />
                        </div>
                    ) : (
                        <p className="package-empty">No readme published.</p>
                    ))}

                {activeTab === "abi" &&
                    (pkg.abi && pkg.abi.length > 0 ? (
                        <AbiTab abi={pkg.abi} />
                    ) : metadataPending ? (
                        <div className="abi-skeleton">
                            {Array.from({ length: 5 }).map((_, i) => (
                                // biome-ignore lint/suspicious/noArrayIndexKey: fixed decorative array
                                <span key={i} className="skeleton-bar skeleton-bar--abi-row" />
                            ))}
                        </div>
                    ) : (
                        <p className="package-empty">No ABI published.</p>
                    ))}

                {activeTab === "dependencies" &&
                    (depEntries.length === 0 ? (
                        <p className="package-empty">No dependencies.</p>
                    ) : (
                        <ul className="package-deps">
                            {depEntries.map(([depName, version]) => (
                                <li key={depName}>
                                    <Link to={`/package/${depName}`} className="package-dep">
                                        <span className="package-dep-name">{depName}</span>
                                        <span className="package-dep-version">{version}</span>
                                    </Link>
                                </li>
                            ))}
                        </ul>
                    ))}

                {activeTab === "versions" && (
                    <ul className="package-versions">
                        {(hasVersions ? versions : [{ version: pkg.version, date: "" }]).map(
                            (v) => (
                                <li key={v.version} className="package-version-row">
                                    <span className="package-version-num">v{v.version}</span>
                                    {v.date && (
                                        <span className="package-version-date">{v.date}</span>
                                    )}
                                    {v.version === pkg.version && (
                                        <span className="package-version-current">current</span>
                                    )}
                                </li>
                            ),
                        )}
                    </ul>
                )}
            </div>
        </div>
    );
}

function PackageSkeleton() {
    return (
        <Layout>
            <article className="package-page" aria-hidden="true">
                <div className="package-main">
                    <div className="package-title-row">
                        <span className="skeleton-bar skeleton-bar--title" />
                        <span className="skeleton-bar skeleton-bar--version" />
                    </div>
                    <span className="skeleton-bar skeleton-bar--desc" />
                    <span className="skeleton-bar skeleton-bar--desc skeleton-bar--desc-short" />
                    <span className="skeleton-bar skeleton-bar--install" />
                </div>
                <aside className="package-sidebar">
                    {Array.from({ length: 4 }).map((_, i) => (
                        // biome-ignore lint/suspicious/noArrayIndexKey: fixed decorative array
                        <div key={i} className="sidebar-section">
                            <span className="skeleton-bar skeleton-bar--side-label" />
                            <span className="skeleton-bar skeleton-bar--side-value" />
                        </div>
                    ))}
                </aside>
            </article>
        </Layout>
    );
}

export default function PackagePage() {
    const params = useParams();
    const name = params["*"];
    const [activeTab, setActiveTab] = useState<TabName>("readme");

    const { pkg, loading, notFound, error, networkConfig } = usePackage(name);

    if (loading) {
        return <PackageSkeleton />;
    }

    if (error) {
        return (
            <Layout>
                <div className="package-status">
                    <h2 className="package-status-title">Connection Error</h2>
                    <p className="package-status-text">
                        Could not connect to <strong>{networkConfig.label}</strong>. Check your
                        connection settings.
                    </p>
                    <p className="package-status-detail">{error}</p>
                </div>
            </Layout>
        );
    }

    if (notFound || !pkg) {
        return (
            <Layout>
                <div className="package-status">
                    <h2 className="package-status-title">Contract not found</h2>
                    <p className="package-status-text">
                        The contract <code>{name}</code> doesn&rsquo;t exist on{" "}
                        <strong>{networkConfig.label}</strong>.
                    </p>
                    <Link to="/" className="package-status-link">
                        ← Back to registry
                    </Link>
                </div>
            </Layout>
        );
    }

    const installCmd = `cdm i -n ${networkConfig.installName} ${pkg.name}`;
    const split = splitName(pkg.name);
    const metadataPending = !pkg.metadataLoaded && !!pkg.metadataUri;

    return (
        <Layout>
            <article className="package-page">
                <div className="package-main">
                    <div className="package-title-row">
                        <h1 className="package-title">
                            <span className="package-name-prefix">{split.prefix}</span>
                            <span className="package-name-leaf">{split.leaf}</span>
                        </h1>
                        <span className="package-version-pill">v{pkg.version}</span>
                    </div>

                    {pkg.description ? (
                        <p className="package-description">{pkg.description}</p>
                    ) : metadataPending ? (
                        <div className="package-description-skeleton">
                            <span className="skeleton-bar skeleton-bar--desc" />
                            <span className="skeleton-bar skeleton-bar--desc skeleton-bar--desc-short" />
                        </div>
                    ) : null}

                    <InstallBlock command={installCmd} />

                    <PackageBody pkg={pkg} activeTab={activeTab} setActiveTab={setActiveTab} />
                </div>

                <aside className="package-sidebar">
                    <div className="sidebar-section">
                        <div className="sidebar-label">Version</div>
                        <div className="sidebar-value sidebar-value--mono">v{pkg.version}</div>
                    </div>

                    {pkg.address && (
                        <div className="sidebar-section">
                            <div className="sidebar-label">Contract Address</div>
                            <AddressLine address={pkg.address} />
                        </div>
                    )}

                    {pkg.lastPublished && (
                        <div className="sidebar-section">
                            <div className="sidebar-label">Last Published</div>
                            <div className="sidebar-value">{pkg.lastPublished}</div>
                        </div>
                    )}

                    {pkg.author && (
                        <div className="sidebar-section">
                            <div className="sidebar-label">Author</div>
                            <div className="sidebar-value">{pkg.author}</div>
                        </div>
                    )}

                    {pkg.repository && (
                        <div className="sidebar-section">
                            <div className="sidebar-label">Repository</div>
                            <a
                                className="sidebar-link"
                                href={pkg.repository}
                                target="_blank"
                                rel="noopener noreferrer"
                                onClick={handleExternalClick}
                            >
                                {pkg.repository.replace(/^https?:\/\/(www\.)?/, "")}
                            </a>
                        </div>
                    )}

                    {pkg.homepage && (
                        <div className="sidebar-section">
                            <div className="sidebar-label">Homepage</div>
                            <a
                                className="sidebar-link"
                                href={pkg.homepage}
                                target="_blank"
                                rel="noopener noreferrer"
                                onClick={handleExternalClick}
                            >
                                {pkg.homepage.replace(/^https?:\/\/(www\.)?/, "")}
                            </a>
                        </div>
                    )}

                    {(pkg.keywords ?? []).length > 0 && (
                        <div className="sidebar-section">
                            <div className="sidebar-label">Keywords</div>
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
                </aside>
            </article>
        </Layout>
    );
}
