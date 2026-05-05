---
"@dotdm/cli": minor
"@dotdm/contracts": minor
---

Support passing `--features` to `cdm build` and `cdm deploy` (forwarded to `cargo pvm-contract build`), useful for compile-time switches such as choosing a contract name via a `dev` feature. Defaults can be set in a gitignored `cdm.local.json` so each developer can keep their own feature set without polluting the repo.
