---
"@dotdm/contracts": patch
"@dotdm/env": patch
"@dotdm/utils": patch
---

Add registry package-name search support and fix redeploying CDM packages against fresh registry deployments.

`@dotdm/contracts` now includes the registry `searchContractNames` ABI, scopes package deployment salts by registry address, and avoids dry-running dependent layers before prior layers have been registered. `@dotdm/utils` exposes the registry package salt constant used by deploy scripts and bootstrap deploys. `@dotdm/env` points presets at the redeployed registry address.
