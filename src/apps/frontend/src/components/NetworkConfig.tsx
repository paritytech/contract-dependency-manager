import { useEffect, useRef, useState } from "react";
import "./NetworkConfig.css";
import { useNetwork } from "../context/useNetwork";
import type { NetworkKey } from "../config/networks";

export default function NetworkConfig() {
    const { network, networks, setNetwork, connected, connecting } = useNetwork();
    const [open, setOpen] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        function handleClickOutside(e: MouseEvent) {
            if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
                setOpen(false);
            }
        }
        if (open) document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, [open]);

    const active = networks.find((item) => item.key === network);

    return (
        <div className="net-selector" ref={dropdownRef}>
            <button
                className="net-selector-trigger"
                onClick={() => setOpen((v) => !v)}
                type="button"
                aria-expanded={open}
            >
                <span className="net-selector-name">
                    <span
                        className={`net-dot ${
                            connecting
                                ? "net-dot--connecting"
                                : connected
                                  ? "net-dot--connected"
                                  : "net-dot--disconnected"
                        }`}
                    />
                    {active?.label ?? network}
                </span>
                <svg
                    className={`net-selector-chevron ${open ? "net-selector-chevron--open" : ""}`}
                    width="14"
                    height="14"
                    viewBox="0 0 16 16"
                    fill="none"
                    aria-hidden="true"
                >
                    <path
                        d="M4 6l4 4 4-4"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                    />
                </svg>
            </button>

            {open && (
                <div className="net-selector-dropdown">
                    <ul className="net-selector-list">
                        {networks.map((item) => (
                            <li key={item.key}>
                                <button
                                    className={`net-selector-option ${
                                        network === item.key ? "net-selector-option--active" : ""
                                    }`}
                                    onClick={() => {
                                        setNetwork(item.key as NetworkKey);
                                        setOpen(false);
                                    }}
                                    type="button"
                                >
                                    <span>{item.label}</span>
                                    {network === item.key && (
                                        <svg
                                            width="14"
                                            height="14"
                                            viewBox="0 0 16 16"
                                            fill="none"
                                            aria-hidden="true"
                                        >
                                            <path
                                                d="M3 8.5l3.5 3.5L13 5"
                                                stroke="currentColor"
                                                strokeWidth="1.5"
                                                strokeLinecap="round"
                                                strokeLinejoin="round"
                                            />
                                        </svg>
                                    )}
                                </button>
                            </li>
                        ))}
                    </ul>
                </div>
            )}
        </div>
    );
}
