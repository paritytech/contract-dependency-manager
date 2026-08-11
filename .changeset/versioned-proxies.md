---
"@parity/cdm-builder": minor
"@parity/cdm-cli": minor
---

Versioned per-name proxies: every published name now gets one stable CDM-owned proxy address with semver-versioned implementations behind it. The registry becomes a factory (`publish(name, versionKey, target, metadataUri)` with strictly-increasing packed-semver keys; first publish CREATE2-instantiates the name's proxy), versions come from each crate's `Cargo.toml` and deploys are idempotent, installs resolve `latest`/exact/`^range` specs to exact published versions, and owners can ratchet a min-supported version floor below which pinned calls revert. Names registered by the v1 registry keep resolving unchanged as legacy entries and upgrade onto a proxy at their next publish.
