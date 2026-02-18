import { useState, useRef, useEffect } from "react";
import "./NetworkConfig.css";
import { useNetwork, NETWORK_PRESETS } from "../context/NetworkContext";

const DISPLAY_NAMES: Record<string, string> = {
  "preview-net": "Preview Net",
  "paseo": "Paseo",
  "polkadot": "Polkadot",
  "local": "Local",
  "custom": "Custom",
};

const NETWORK_OPTIONS = ["preview-net", "paseo", "polkadot", "local", "custom"];

export default function NetworkConfig() {
  const {
    network,
    setNetwork,
    assethubUrl,
    bulletinUrl,
    registryAddress,
    setAssethubUrl,
    setBulletinUrl,
    setRegistryAddress,
    connected,
    connecting,
  } = useNetwork();

  const [open, setOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  const handleSelect = (key: string) => {
    setNetwork(key);
  };

  const isPresetNetwork = network in NETWORK_PRESETS && network !== "custom" && network !== "local";
  const showInputs = open && (network === "custom" || network === "local");

  return (
    <div className="net-selector" ref={dropdownRef}>
      <button
        className="net-selector-trigger"
        onClick={() => setOpen((v) => !v)}
        type="button"
      >
        <span className="net-selector-name">
          {connecting && <span className="net-dot net-dot--connecting" />}
          {connected && !connecting && <span className="net-dot net-dot--connected" />}
          {!connected && !connecting && <span className="net-dot net-dot--disconnected" />}
          {DISPLAY_NAMES[network] ?? network}
        </span>
        <svg
          className={`net-selector-chevron ${open ? "net-selector-chevron--open" : ""}`}
          width="14"
          height="14"
          viewBox="0 0 16 16"
          fill="none"
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
            {NETWORK_OPTIONS.map((key) => (
              <li key={key}>
                <button
                  className={`net-selector-option ${network === key ? "net-selector-option--active" : ""}`}
                  onClick={() => handleSelect(key)}
                  type="button"
                >
                  <span>{DISPLAY_NAMES[key]}</span>
                  {network === key && (
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
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

          {showInputs && (
            <div className="net-selector-fields">
              {network === "custom" && (
                <>
                  <div className="net-selector-field">
                    <label className="net-selector-field-label">AssetHub URL</label>
                    <input
                      className="net-selector-field-input"
                      type="text"
                      value={assethubUrl}
                      onChange={(e) => setAssethubUrl(e.target.value)}
                      placeholder="ws://..."
                    />
                  </div>
                  <div className="net-selector-field">
                    <label className="net-selector-field-label">Bulletin URL</label>
                    <input
                      className="net-selector-field-input"
                      type="text"
                      value={bulletinUrl}
                      onChange={(e) => setBulletinUrl(e.target.value)}
                      placeholder="ws://..."
                    />
                  </div>
                </>
              )}
              <div className="net-selector-field">
                <label className="net-selector-field-label">Registry Address</label>
                <input
                  className="net-selector-field-input"
                  type="text"
                  value={registryAddress}
                  onChange={(e) => setRegistryAddress(e.target.value)}
                  disabled={isPresetNetwork}
                  placeholder="0x..."
                />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
