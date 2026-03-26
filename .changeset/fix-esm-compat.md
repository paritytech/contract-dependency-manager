---
"@dotdm/cdm": patch
"@dotdm/env": patch
"@dotdm/utils": patch
"@dotdm/contracts": patch
---

Fix Node.js ESM compatibility by switching library builds from tsc to tsup. Compiled output now includes proper .js extensions on relative imports, making packages work in both bundler and Node.js ESM environments.
