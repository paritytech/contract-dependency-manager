---
"@dotdm/cli": patch
"@dotdm/cdm": patch
"@dotdm/contracts": patch
"@dotdm/env": patch
---

Update CDM's Paseo preset to Paseo Next v2 and upgrade product-sdk packages to the 0.4 release line. Contract registry handles now pass product-sdk descriptors into the 0.4 contract runtime factories, and batched registry publishes await async `.prepare()` calls.

The Paseo preset now points at the ContractRegistry deployed on Paseo Next v2, and `make deploy-registry` refreshes local package builds before running the deployment script. Re-running `deploy-registry` exits successfully when the selected registry is already deployed.
