import { useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import ContractGrid from "../components/ContractGrid";
import { useNetwork } from "../context/NetworkContext";
import { useRegistry } from "../hooks/useRegistry";
export default function WidgetPage() {
    const [searchParams] = useSearchParams();
    const { network, setNetwork, connecting, error: networkError } = useNetwork();
    const { packages, loading, error: registryError, hasMore, loadMore } = useRegistry();

    const requestedNetwork = searchParams.get("network");
    useEffect(() => {
        if (requestedNetwork) {
            setNetwork(requestedNetwork);
        }
    }, [requestedNetwork, setNetwork]);

    return (
        <div style={{ padding: 16 }}>
            <ContractGrid
                packages={packages}
                loading={loading}
                hasMore={hasMore}
                loadMore={loadMore}
                network={network}
                connecting={connecting}
                error={networkError || registryError}
                linkTarget="_blank"
            />
        </div>
    );
}
