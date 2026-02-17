import "./NetworkConfig.css";
import { useNetwork, NETWORK_PRESETS } from "../context/NetworkContext";

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

  const handleNetworkChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setNetwork(e.target.value);
  };

  const isPresetNetwork = network in NETWORK_PRESETS && network !== "custom" && network !== "local";

  return (
    <div className="network-config">
      <div className="network-config-field">
        <label className="network-config-label">
          Network
          {connecting && " ..."}
          {connected && !connecting && " \u2713"}
        </label>
        <select
          className="network-config-select"
          value={network}
          onChange={handleNetworkChange}
        >
          <option value="preview-net">preview-net</option>
          <option value="paseo">paseo</option>
          <option value="polkadot">polkadot</option>
          <option value="local">local</option>
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
