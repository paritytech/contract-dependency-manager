---
"@dotdm/cli": patch
---

Fix template CLAUDE.md to reference the `common` crate correctly as a git dependency from `contract-developer-tools` instead of a nonexistent local path. Remove duplicate CLAUDE.md from the instagram template (inherits from common/).
