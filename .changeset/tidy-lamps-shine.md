---
"@parity/cdm-cli": patch
---

Refresh the shell installer so binary installation stays small and delegates toolchain dependency setup to the new `cdm setup` command. Add `cdm update` for binary release updates and publish PR-scoped CLI dev releases when a pull request includes a `@parity/cdm-cli` changeset.
