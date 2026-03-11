---
"@dotdm/cdm": minor
---

Add `cdm.setDefaults({ origin, signer })` to mutate defaults in-place. All existing contract handles automatically use the new defaults on subsequent calls — no need to recreate `cdm` or contract handles when switching accounts.
