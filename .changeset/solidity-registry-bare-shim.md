---
"@parity/cdm-builder": minor
"@parity/cdm-utils": minor
"@parity/cdm-cli": patch
---

CDM's own contracts contain no pvm-contract-sdk code. The upgradeable registry and resolver are Solidity compiled to EVM bytecode, with their state in ERC-7201 structs (`cdm.registry.v1`, `cdm.resolver.v1`). The permanent contracts (per-name shim, EIP-1967 proxy, CREATE3 factory and child) stay Rust on PolkaVM, written against pallet-revive's host functions directly. The registry creates shims by delegate-calling a small shim factory, deployed before the registry implementation. Building the contracts now needs `forge` as well as `cargo pvm-contract`.

BREAKING: the registry deploy functions take a `RegistryArtifacts` object (`registryArtifacts(rootDir)`) instead of blob paths, and `upgradeResolverImplementation` takes `resolverArtifactPath`. `CONTRACTS_RESOLVER_CRATE` and `CONTRACTS_EIP1967_PROXY_CRATE` are removed; `CONTRACTS_SHIM_FACTORY_PACKAGE` is added. The frozen shim and CREATE3 blobs changed, so every derived address moves. Calls with an unknown selector or malformed calldata revert with empty data: `InvalidCalldata`, `CalldataTooLarge`, `NoSelector`, `UnknownSelector` and `NonPayableValueReceived` are removed from the embedded ABIs.
