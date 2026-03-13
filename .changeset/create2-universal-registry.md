---
"@dotdm/utils": minor
"@dotdm/contracts": minor
"@dotdm/env": minor
"@dotdm/cdm": minor
"@dotdm/cli": minor
"@dotdm/descriptors": patch
---

Use CREATE2 for deterministic contract addresses and universal registry

Deploy all CDM contracts with CREATE2 so every contract gets the same address on every chain. Salt is derived from the CDM package name via blake2b. Establish a universal REGISTRY_ADDRESS constant and remove all per-chain registry configuration.

**Breaking changes:**
- Removed `--registry-address` CLI flag from build, deploy, and install commands
- Removed `registry` field from `CdmJsonTarget` and `cdm.json` schema
- Removed `registryAddress` from `ChainPreset`
- `computeTargetHash` no longer accepts a registry address parameter — target hashes will change, requiring `cdm install` to be re-run
- Removed `CONTRACTS_REGISTRY_ADDR` env var requirement from build command

**Other changes:**
- Added `computeDeploySalt` to `@dotdm/contracts`
- Added `REGISTRY_ADDRESS` constant to `@dotdm/utils` and re-exported from `@dotdm/env` and `@dotdm/contracts`
- Removed HIDDEN_CONTRACTS patch from frontend (disputes and reputation now visible)
- Updated template cdm.json files and documentation
