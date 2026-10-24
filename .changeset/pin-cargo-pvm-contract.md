---
"@parity/cdm-cli": patch
---

Pin cargo-pvm-contract to a known-good revision (`6400a32d1c`) instead of tracking upstream `main`. Upstream `main` removed `Mapping::view`/`view_mut`, and installing it currently fails on recent nightlies. `cdm setup` and `cdm update` install that revision by default, and scaffolded templates pin the same `pvm-contract-sdk` revision. Override it with `--cargo-pvm-contract-ref` or `CDM_CARGO_PVM_CONTRACT_REF`.
