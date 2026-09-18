---
"@parity/cdm-cli": minor
"@parity/cdm-builder": minor
"@parity/cdm-utils": minor
"@parity/cdm-codegen": minor
---

Add `cdm test` and `cdm network` commands: `cdm test` orchestrates deploy + install + vitest against a local PPN (auto-starting it and auto-bootstrapping the registry when missing); `cdm network start/stop/status/logs/gateway` manages the PPN lifecycle and bundles a bulletin → IPFS gateway. Ships `@parity/cdm-codegen/test` vitest helpers (dev accounts, makeCdm, assertion helpers, setupForeignContracts), local-registry pinning via cdm.local.json plus a per-machine `~/.cdm/local-registry`, registry-query retries to survive the bootstrap → deploy race, deploy-skip handling for workspace crates without a CDM package annotation, and browser-safe `unwrapOption`/`unwrapQueryOption` helpers.
