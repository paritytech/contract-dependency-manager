---
"@parity/cdm-builder": minor
"@parity/cdm-utils": patch
---

Add `transferName(name, newOwner)` to the registry — package owners can hand a name to a new account (owner-gated, freeze-respecting) — and a `--upgrade` flow in deploy-registry that deploys the new implementation and repoints the proxy via `setCode`, verifying address and state stay intact.
