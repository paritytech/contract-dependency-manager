---
"@dotdm/contracts": major
"@dotdm/env": major
"@dotdm/utils": minor
---

Remove the deprecated `REGISTRY_ADDRESS` export and route registry resolution through `@dotdm/env`'s `getRegistryAddress(name)`.

`getRegistryAddress()` now defaults to the current Paseo registry, so build/deploy/install paths and lower-level helpers no longer fall back to the old deterministic registry address. Templates and target hashes have been updated to the current registry as well.
