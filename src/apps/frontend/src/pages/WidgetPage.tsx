import { useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import ContractGrid from "../components/ContractGrid";
import { useNetwork } from "../context/useNetwork";
import { useRegistry } from "../hooks/useRegistry";
import { resolveNetworkKey } from "../config/networks";

export default function WidgetPage() {
    const [searchParams] = useSearchParams();
    const { networkConfig, setNetwork, connecting, error: networkError } = useNetwork();
    const { packages, loading, error: registryError, hasMore, loadMore } = useRegistry();

    const requestedNetwork = searchParams.get("network");
    useEffect(() => {
        const nextNetwork = resolveNetworkKey(requestedNetwork);
        if (nextNetwork) {
            setNetwork(nextNetwork);
        }
    }, [requestedNetwork, setNetwork]);

    return (
        <div style={{ padding: 16 }}>
            <ContractGrid
                packages={packages}
                loading={loading}
                hasMore={hasMore}
                loadMore={loadMore}
                network={networkConfig.label}
                connecting={connecting}
                error={networkError || registryError}
                linkTarget="_blank"
            />
        </div>
    );
}
