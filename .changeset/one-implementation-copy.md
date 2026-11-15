---
"@parity/cdm-builder": minor
---

The registry stores only each version's packed semver key: `getVersionAt` returns `(isSome, version_key, metadata_uri)`, and a version's implementation address is read from the resolver's `implOf(proxy, version_key)`.
