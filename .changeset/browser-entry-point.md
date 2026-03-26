---
"@dotdm/cdm": patch
---

Add browser-specific entry point to avoid bundling Node.js-only dependencies (fs, path, child_process) in browser builds
