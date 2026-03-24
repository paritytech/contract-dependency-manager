---
"@dotdm/cli": patch
---

Show expired bulletin allowance in red with "expired at block #N" instead of dim "expires block #N"

When the current finalized block number has passed the allowance expiration, the bulletin balance line now displays in red to make it obvious the allowance is no longer usable.
