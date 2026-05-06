---
"@dotdm/contracts": patch
"@dotdm/cli": patch
---

Use the next CDM registry version index in CREATE2 salts so repeated publishes of the same package deploy to fresh deterministic addresses. CDM deploys now query registry version counts instead of skipping identical bytecode as cached, allowing intentional new registry versions even when bytecode is unchanged.
