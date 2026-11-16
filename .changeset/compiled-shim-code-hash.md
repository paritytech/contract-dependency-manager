---
"@parity/cdm-builder": minor
---

The per-name shim's code hash is compiled into the registry instead of being set by its admin. `getProxyCodeHash()` returns the constant, so a new shim blob takes a registry upgrade through `setCode`, which emits `Upgraded`. Registry deploys and upgrades upload the frozen shim blob and stop if its hash differs from the registry's.

BREAKING: `setProxyCodeHash` and the `ProxyCodeHashUnset` error are removed from the registry and from `CONTRACTS_REGISTRY_ABI`.
