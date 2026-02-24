---
"@dotdm/cli": patch
---

Fix install crash when contract not found in registry. Show friendly error instead of raw ABI decoding error, and skip unresolved contracts during post-install type generation.
