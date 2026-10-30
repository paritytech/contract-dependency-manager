---
"@parity/cdm-builder": minor
"@parity/cdm-cli": minor
"@parity/cdm-migrations": minor
"@parity/cdm-codegen": minor
---

Versioned per-name proxies: every published name now gets one stable CDM-owned proxy address with semver-versioned implementations behind it. The registry becomes a factory (`publish(name, versionKey, target, metadataUri)` with strictly-increasing packed-semver keys; first publish CREATE2-instantiates the name's proxy), versions come from each crate's `Cargo.toml` and deploys are idempotent, installs resolve `latest`/exact/`^range` specs to exact published versions, and owners can ratchet a min-supported version floor below which pinned calls revert. Registry deploy/upgrade tooling lands alongside: the per-name proxy blob is frozen under `src/contract/proxy/artifacts/` with a hash-verified loader, fresh registry deploys upload it and set `proxyCodeHash`, and `upgradeRegistryImplementation` performs in-place upgrades (new implementation at a fresh bumped CREATE2 salt + `setCode`, `deploy-registry.ts --upgrade`). Migration snapshots use the `cdm.registry.v2` schema carrying version keys and per-name proxies, and `cdm deploy` warns when a published method's selector collides with the proxy call prefix.

BREAKING: this is a clean break with the v1 era. Versions are semver strings everywhere — numeric version indices no longer exist. The registry, CLI, and migration tooling do not read v1 registries; legacy numeric `cdm.json` pins fail with instructions to reinstall (`cdm i <name>`), and v1 snapshots can be neither exported nor imported.
