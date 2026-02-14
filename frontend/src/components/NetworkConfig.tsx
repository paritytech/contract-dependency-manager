import React, { useState } from "react";
import "./NetworkConfig.css";

const NETWORK_PRESETS: Record<string, { assethubUrl: string; bulletinUrl: string; registryAddress: string }> = {
  local: {
    assethubUrl: "ws://127.0.0.1:10020",
    bulletinUrl: "ws://127.0.0.1:10021",
    registryAddress: "",
  },
  "preview-net": {
    assethubUrl: "wss://asset-hub-preview.polkadot.io",
    bulletinUrl: "wss://bulletin-preview.polkadot.io",
    registryAddress: "0x0000000000000000000000000000000000000000",
  },
  paseo: {
    assethubUrl: "wss://asset-hub-paseo.polkadot.io",
    bulletinUrl: "wss://bulletin-paseo.polkadot.io",
    registryAddress: "0x0000000000000000000000000000000000000000",
  },
  polkadot: {
    assethubUrl: "wss://asset-hub.polkadot.io",
    bulletinUrl: "wss://bulletin.polkadot.io",
    registryAddress: "0x0000000000000000000000000000000000000000",
  },
  custom: {
    assethubUrl: "",
    bulletinUrl: "",
    registryAddress: "",
  },
};

type NetworkName = keyof typeof NETWORK_PRESETS;

export default function NetworkConfig() {
  const [network, setNetwork] = useState<NetworkName>("local");
  const [assethubUrl, setAssethubUrl] = useState(NETWORK_PRESETS.local.assethubUrl);
  const [bulletinUrl, setBulletinUrl] = useState(NETWORK_PRESETS.local.bulletinUrl);
  const [registryAddress, setRegistryAddress] = useState(NETWORK_PRESETS.local.registryAddress);

  const handleNetworkChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const name = e.target.value as NetworkName;
    setNetwork(name);
    const preset = NETWORK_PRESETS[name];
    setAssethubUrl(preset.assethubUrl);
    setBulletinUrl(preset.bulletinUrl);
    setRegistryAddress(preset.registryAddress);
  };

  const isPresetNetwork = network === "preview-net" || network === "paseo" || network === "polkadot";

  return (
    <div className="network-config">
      <div className="network-config-field">
        <label className="network-config-label">Network</label>
        <select
          className="network-config-select"
          value={network}
          onChange={handleNetworkChange}
        >
          <option value="local">local</option>
          <option value="preview-net">preview-net</option>
          <option value="paseo">paseo</option>
          <option value="polkadot">polkadot</option>
          <option value="custom">custom</option>
        </select>
      </div>

      <div className="network-config-field">
        <label className="network-config-label">AssetHub URL</label>
        <input
          className="network-config-input"
          type="text"
          value={assethubUrl}
          onChange={(e) => setAssethubUrl(e.target.value)}
          disabled={network !== "custom"}
          placeholder="ws://..."
        />
      </div>

      <div className="network-config-field">
        <label className="network-config-label">Bulletin URL</label>
        <input
          className="network-config-input"
          type="text"
          value={bulletinUrl}
          onChange={(e) => setBulletinUrl(e.target.value)}
          disabled={network !== "custom"}
          placeholder="ws://..."
        />
      </div>

      <div className="network-config-field">
        <label className="network-config-label">Registry Address</label>
        <input
          className="network-config-input"
          type="text"
          value={registryAddress}
          onChange={(e) => setRegistryAddress(e.target.value)}
          disabled={isPresetNetwork}
          placeholder="0x..."
        />
      </div>
    </div>
  );
}
