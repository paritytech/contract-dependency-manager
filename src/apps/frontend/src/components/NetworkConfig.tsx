import { useEffect, useRef, useState } from "react";
import "./NetworkConfig.css";
import { useNetwork } from "../context/useNetwork";
import type { NetworkKey } from "../config/networks";

export default function NetworkConfig() {
    const { network, networks, setNetwork, connected, connecting } = useNetwork();
    const [open, setOpen] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        function handleClickOutside(e: MouseEvent) {
            if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
                setOpen(false);
            }
        }
        if (open) document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, [open]);

    const active = networks.find((item) => item.key === network);
    const others = networks.filter((item) => item.key !== network);
    const statusModifier = connecting ? "connecting" : connected ? "connected" : "disconnected";

    return (
        <div className={`net-picker${open ? " net-picker--open" : ""}`} ref={containerRef}>
            <button
                className="net-picker-item net-picker-current"
                onClick={() => setOpen((v) => !v)}
                type="button"
                aria-expanded={open}
                aria-haspopup="listbox"
            >
                <span className={`net-picker-pill net-picker-pill--${statusModifier}`}>
                    {active?.label ?? network}
                </span>
            </button>
            <div className="net-picker-others" role="listbox">
                {others.map((item, index) => (
                    <button
                        key={item.key}
                        className="net-picker-item net-picker-other"
                        onClick={() => {
                            setNetwork(item.key as NetworkKey);
                            setOpen(false);
                        }}
                        type="button"
                        tabIndex={open ? 0 : -1}
                        aria-hidden={!open}
                        style={{ transitionDelay: open ? `${index * 40}ms` : "0ms" }}
                    >
                        <span className="net-picker-label">{item.label}</span>
                    </button>
                ))}
            </div>
        </div>
    );
}
