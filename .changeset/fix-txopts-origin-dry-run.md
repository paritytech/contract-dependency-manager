---
"@dotdm/cdm": patch
---

Allow `TxOpts.origin` to override the dry-run caller address, fixing gas estimation failures when a non-Alice wallet signs transactions with caller-dependent assertions.
