---
"@parity/cdm-builder": patch
"@parity/cdm-cli": patch
---

`cdm deploy` now publishes metadata to Bulletin (and verifies CIDs) before submitting the deploy+register batch, instead of running both concurrently. A failed publish aborts before anything is registered — the registry can no longer end up pointing at an unfetchable CID, and the deploy is safely retryable. Publish-phase failures are reported through a new `publish-error` deploy event.
