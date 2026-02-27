// Alice's well-known SS58 address (used for read-only contract queries)
export const ALICE_SS58 = "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY";

// Generous defaults - work for most contracts, unused gas is refunded
export const GAS_LIMIT = { refTime: 500_000_000_000n, proofSize: 2_000_000n };

export const STORAGE_DEPOSIT_LIMIT = 100_000_000_000_000n;

// The contracts registry is the bootstrap - it's deployed first and has no CDM macro
export const CONTRACTS_REGISTRY_CRATE = "contract-registry";

// Default WebSocket URL for local development
export const DEFAULT_NODE_URL = "ws://127.0.0.1:10020";
