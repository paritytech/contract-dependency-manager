---
"@parity/cdm-builder": minor
"@parity/cdm-migrations": minor
---

Registry deploy/upgrade tooling for versioned proxies: the per-name proxy blob is frozen under `src/contract/proxy/artifacts/` with a hash-verified loader, fresh registry deploys upload it and set `proxyCodeHash`, and `upgradeRegistryImplementation` performs in-place upgrades (new implementation at a fresh bumped CREATE2 salt + `setCode`, `deploy-registry.ts --upgrade`). Migration snapshots gain a `cdm.registry.v2` schema carrying version keys and per-name proxies; v1 snapshots stay readable and import with legacy-derived keys `0.0.(index+1)` and a zero proxy.
