import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import InfiniteScroll from "../components/InfiniteScroll";
import Layout from "../components/Layout";
import PackageCard from "../components/PackageCard";
import SearchBox from "../components/SearchBox";
import { SkeletonCard } from "../components/SkeletonCard";
import { useNetwork } from "../context/useNetwork";
import { useRegistrySearch } from "../hooks/useRegistrySearch";
import "./SearchPage.css";

export default function SearchPage() {
    const [searchParams] = useSearchParams();
    const query = (searchParams.get("q") || "").trim();
    const [inputValue, setInputValue] = useState(query);
    const navigate = useNavigate();
    const { networkConfig, connecting, error: networkError } = useNetwork();
    const { packages, loading, error: registryError, hasMore, loadMore } = useRegistrySearch(query);

    const error = networkError || registryError;

    useEffect(() => {
        setInputValue(query);
    }, [query]);

    const handleSearch = (value: string) => {
        const trimmed = value.trim();
        if (trimmed) navigate(`/search?q=${encodeURIComponent(trimmed)}`);
    };

    if (!query) {
        return (
            <Layout>
                <div className="search-page">
                    <div className="search-header">
                        <SearchBox
                            value={inputValue}
                            onChange={setInputValue}
                            onSubmit={handleSearch}
                            placeholder="Search @org/package names..."
                            ariaLabel="Search package names"
                            className="search-page-box"
                        />
                    </div>
                    <div className="search-empty">
                        <h2>Search for contracts</h2>
                        <p>Enter a package name prefix to find contracts on cdm.</p>
                    </div>
                </div>
            </Layout>
        );
    }

    return (
        <Layout>
            <div className="search-page">
                <div className="search-header">
                    <SearchBox
                        value={inputValue}
                        onChange={setInputValue}
                        onSubmit={handleSearch}
                        placeholder="Search @org/package names..."
                        ariaLabel="Search package names"
                        className="search-page-box"
                    />
                    <p className="search-result-count">
                        Showing <strong>{packages.length}</strong> package name match
                        {packages.length !== 1 ? "es" : ""} for &ldquo;{query}&rdquo;
                    </p>
                </div>

                {error ? (
                    <div className="search-empty">
                        <h2>Connection Error</h2>
                        <p>
                            Could not connect to <strong>{networkConfig.label}</strong>. Check your
                            connection settings.
                        </p>
                        <p>{error}</p>
                    </div>
                ) : connecting || (loading && packages.length === 0) ? (
                    <div className="search-results-list">
                        {Array.from({ length: 6 }).map((_, i) => (
                            // biome-ignore lint/suspicious/noArrayIndexKey: fixed-length decorative array
                            <SkeletonCard key={i} />
                        ))}
                    </div>
                ) : packages.length === 0 ? (
                    <div className="search-empty">
                        <h2>No contracts found</h2>
                        <p>Try a different package name prefix.</p>
                    </div>
                ) : (
                    <InfiniteScroll hasMore={hasMore} loading={loading} loadMore={loadMore}>
                        <div className="search-results-list">
                            {packages.map((pkg) => (
                                <PackageCard key={pkg.name} pkg={pkg} />
                            ))}
                        </div>
                    </InfiniteScroll>
                )}
            </div>
        </Layout>
    );
}
