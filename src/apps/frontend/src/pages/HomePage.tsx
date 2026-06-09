import Layout from "../components/Layout";
import ContractGrid from "../components/ContractGrid";
import CommandBox from "../components/CommandBox";
import logo from "../assets/logo.png";
import { useNetwork } from "../context/useNetwork";
import { useRegistry } from "../hooks/useRegistry";
import "./HomePage.css";

export default function HomePage() {
    const { networkConfig, connecting, error: networkError } = useNetwork();
    const { packages, loading, error: registryError, hasMore, loadMore } = useRegistry();

    const installCmd =
        "curl -fsSL https://raw.githubusercontent.com/paritytech/contract-dependency-manager/main/install.sh | bash";
    const error = networkError || registryError;

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
