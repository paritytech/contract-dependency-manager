---
"@parity/cdm-builder": patch
---

Deploy pipeline: publish metadata to Bulletin before deploy+register instead of concurrently. The registry entry commits to the precomputed metadata CID, so the old `Promise.all` could register a CID whose content never landed on Bulletin (e.g. the store transaction timed out) — leaving the package registered but permanently uninstallable, with a retry deploying a fresh orphaned version. Sequencing restores the invariant that a registered CID is always fetchable; a failed publish now aborts before anything is registered, making the deploy safely retryable.
