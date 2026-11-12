---
"@parity/cdm-builder": minor
---

Registry admin handover is two-step: `setAdmin` is replaced by `proposeAdmin(address)` (zero cancels) and `acceptAdmin()`, with `getPendingAdmin()` and an `AdminProposed` event, so the role only moves once the new admin proves it can act.
