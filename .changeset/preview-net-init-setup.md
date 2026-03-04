---
"@dotdm/cli": minor
"@dotdm/contracts": patch
---

`cdm init` now automatically sets up a preview-net account (fund, bulletin authorize, account map) using the same mnemonic as paseo. Contract crate detection now excludes lib-only crates that depend on pvm_contract but have no binary target.
