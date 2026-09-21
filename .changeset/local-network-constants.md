---
"@parity/cdm-env": patch
"@parity/cdm-utils": patch
"@parity/cdm-cli": patch
"@parity/cdm-builder": patch
"@parity/cdm-codegen": patch
---

Centralize the local PPN ports/URLs as shared constants in `@parity/cdm-utils` and fix the local IPFS gateway mismatch: everything now uses PPN's native gateway port (8080), with `cdm network start` spawning the bundled bulletin→IPFS gateway on that same port only when nothing is already serving it. Also: local registry resolution treats the preset's empty registry address correctly (install/build no longer swallow it), `setupForeignContracts` honors the `~/.cdm/local-registry` fallback and supports `from: "custom"` via `sourceRegistryAddress`, `deploy-registry` persists the global local-registry pin, and the deploy on-chain probe no longer leaks its client on failure.
