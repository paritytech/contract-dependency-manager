// Alice's well-known SS58 address (used for read-only contract queries)
export const ALICE_SS58 = "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY";

// Generous defaults - work for most contracts, unused gas is refunded
export const GAS_LIMIT = { refTime: 500_000_000_000n, proofSize: 2_000_000n };

export const STORAGE_DEPOSIT_LIMIT = 100_000_000_000_000n;

// The contracts registry is the bootstrap - it's deployed first and has no CDM macro
export const CONTRACTS_REGISTRY_CRATE = "contract-registry";

// EIP-1967 proxy crate: one instance holds the stable registry address, one
// the stable resolver address; all calls delegate to the implementation.
export const CONTRACTS_EIP1967_PROXY_CRATE = "contract-eip1967-proxy";

// Resolver implementation crate: the routing tables and policy every
// per-name shim asks.
export const CONTRACTS_RESOLVER_CRATE = "contract-resolver";

// Salt material for the ContractRegistry PROXY deployment — this is the
// stable address every consumer uses. The proxy is deployed THROUGH the
// CREATE3 factory, so its address is a pure function of (factory, this salt)
// — no bytecode or constructor input involved. Bump the suffix when
// deliberately deploying a new registry generation.
export const CONTRACTS_REGISTRY_PACKAGE = "@cdm/registry.2";

// CREATE2 salt material for the CREATE3 factory itself — deployed once per
// network from the operator's EOA using the committed factory blob, so the
// factory (and therefore every CREATE3 address it derives) is identical
// across networks for the same deployer. Bumping this constant moves the
// factory AND every future CREATE3 address — never do it casually.
export const CREATE3_FACTORY_PACKAGE = "@cdm/create3-factory.1";

// CREATE2 salt material for the registry IMPLEMENTATION blob the proxy
// delegates to. Bump independently when shipping a new implementation build
// (upgrades go through `setCode`, never a proxy redeploy).
export const CONTRACTS_REGISTRY_IMPL_PACKAGE = "@cdm/registry-impl.1";

// Salt material for the resolver PROXY, deployed THROUGH the CREATE3 factory
// with the registry as admin. Every per-name shim bakes this address in, so
// it is as permanent as the registry's.
export const CONTRACTS_RESOLVER_PACKAGE = "@cdm/resolver.1";

// CREATE2 salt material for the resolver IMPLEMENTATION blob. Bump when
// shipping a new build (upgrades go through the registry's `upgradeResolver`).
export const CONTRACTS_RESOLVER_IMPL_PACKAGE = "@cdm/resolver-impl.1";

// Default WebSocket URL for local development
export const DEFAULT_NODE_URL = "ws://127.0.0.1:10020";
