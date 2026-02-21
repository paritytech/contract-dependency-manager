// The contracts registry is the bootstrap - it's deployed first and has no CDM macro
export const CONTRACTS_REGISTRY_CRATE = "contracts";

// Generous defaults - work for most contracts, unused gas is refunded
export const GAS_LIMIT = { refTime: 500_000_000_000n, proofSize: 2_000_000n };

export const STORAGE_DEPOSIT_LIMIT = 100_000_000_000_000n;

// Default signer for dev networks
export const DEFAULT_SIGNER = "Alice";

// Default WebSocket URL for local development
export const DEFAULT_NODE_URL = "ws://127.0.0.1:10020";
