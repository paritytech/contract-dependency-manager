---
"@parity/cdm-cli": patch
---

Fix `cdm test` discovering zero CDM packages and exiting before running vitest. The command walked `target/*.release.cdm.json` to collect `cdmPackage` annotations, but those per-crate files no longer exist — the "flatten cdm manifest artifacts" refactor replaced them with `target/cdm/build-manifest.json`. It now reads the build manifest via `readBuildManifest`, so deploy + install + vitest actually runs.