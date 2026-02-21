import { useState, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import Layout from "../components/Layout";
import PackageCard from "../components/PackageCard";
import { useNetwork } from "../context/NetworkContext";
import { useRegistry } from "../hooks/useRegistry";
import "./SearchPage.css";

type SortMode = "name" | "popularity";

export default function SearchPage() {
    const [searchParams] = useSearchParams();
    const query = searchParams.get("q") || "";
    const [sort, setSort] = useState<SortMode>("name");
    const { network, connecting, error: networkError } = useNetwork();
    const { packages, loading, error: registryError } = useRegistry();

    const error = networkError || registryError;

    const results = useMemo(() => {
        if (!query) return [];
        const lower = query.toLowerCase();
        const filtered = packages.filter(
            (pkg) =>
                pkg.name.toLowerCase().includes(lower) ||
                (pkg.description ?? "").toLowerCase().includes(lower) ||
                (pkg.keywords ?? []).some((kw) => kw.toLowerCase().includes(lower)),
        );

        const sorted = [...filtered];
        if (sort === "name") {
            sorted.sort((a, b) => a.name.localeCompare(b.name));
        } else {
            sorted.sort((a, b) => (b.weeklyCalls ?? 0) - (a.weeklyCalls ?? 0));
        }
        return sorted;
    }, [query, sort, packages]);

    if (!query) {
        return (
            <Layout>
                <div className="search-empty">
                    <h2>Search for contracts</h2>
                    <p>Enter a search term to find contracts on cdm.</p>
                </div>
            </Layout>
        );
    }

    return (
        <Layout>
            <div className="search-page">
                <div className="search-header">
                    <p className="search-result-count">
                        <strong>{results.length}</strong> contract{results.length !== 1 ? "s" : ""}{" "}
                        found for &ldquo;{query}&rdquo;
                    </p>
                    <div className="search-sort-bar">
                        {(["name", "popularity"] as SortMode[]).map((mode) => (
                            <button
                                key={mode}
                                className={`sort-btn${sort === mode ? " active" : ""}`}
                                onClick={() => setSort(mode)}
                            >
                                {mode.charAt(0).toUpperCase() + mode.slice(1)}
                            </button>
                        ))}
                    </div>
                </div>

                {error ? (
                    <div className="search-empty">
                        <h2>Connection Error</h2>
                        <p>
                            Could not connect to <strong>{network}</strong>. Check your connection
                            settings.
                        </p>
                        <p>{error}</p>
                    </div>
                ) : connecting || (loading && packages.length === 0) ? (
                    <div className="search-empty">
                        <p>Connecting to {network}...</p>
                    </div>
                ) : results.length === 0 ? (
                    <div className="search-empty">
                        <h2>No contracts found</h2>
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
