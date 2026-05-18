import { useState } from "react";
import { useNavigate } from "react-router-dom";
import Layout from "../components/Layout";
import ContractGrid from "../components/ContractGrid";
import CommandBox from "../components/CommandBox";
import SearchBox from "../components/SearchBox";
import logo from "../assets/logo.png";
import { useNetwork } from "../context/useNetwork";
import { useRegistry } from "../hooks/useRegistry";
import "./HomePage.css";

export default function HomePage() {
    const { networkConfig, connecting, error: networkError } = useNetwork();
    const { packages, loading, error: registryError, hasMore, loadMore } = useRegistry();
    const [query, setQuery] = useState("");
    const navigate = useNavigate();

    const installCmd =
        "curl -fsSL https://raw.githubusercontent.com/paritytech/contract-dependency-manager/main/install.sh | bash";
    const error = networkError || registryError;

    const handleSearch = (value: string) => {
        const trimmed = value.trim();
        if (trimmed) navigate(`/search?q=${encodeURIComponent(trimmed)}`);
    };

    return (
        <Layout>
            <div className="registry-home">
                <section className="registry-hero">
                    <div className="hero-inner">
                        <h1 className="hero-title">
                            <img src={logo} alt="" className="hero-title-logo" />
                            <span>Contract Registry</span>
                        </h1>

                        <div className="hero-actions">
                            <CommandBox
                                command={installCmd}
                                label="Install CDM"
                                className="hero-command"
                            />
                            <SearchBox
                                value={query}
                                onChange={setQuery}
                                onSubmit={handleSearch}
                                placeholder="Search @org/package names..."
                                ariaLabel="Search contracts"
                            />
                        </div>
                    </div>
                </section>

                <section className="registry-list" aria-label="Contracts">
                    <ContractGrid
                        packages={packages}
                        loading={loading}
                        hasMore={hasMore}
                        loadMore={loadMore}
                        network={networkConfig.label}
                        connecting={connecting}
                        error={error}
                    />
                </section>
            </div>
        </Layout>
    );
}
