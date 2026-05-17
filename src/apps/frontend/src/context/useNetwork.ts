import { useContext } from "react";
import { NetworkContext, type NetworkContextType } from "./network-context";

export function useNetwork(): NetworkContextType {
    const ctx = useContext(NetworkContext);
    if (!ctx) throw new Error("useNetwork must be used within a NetworkProvider");
    return ctx;
}
