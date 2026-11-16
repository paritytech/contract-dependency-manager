---
"@parity/cdm-builder": minor
---

Remove the registry's `adminImportContracts` method and the migration tooling around it (`deploy-registry.ts --migrate-from-registry`, the `@parity/cdm-migrations` package). The registry address is permanent, so there is no fresh deployment to import state into.
