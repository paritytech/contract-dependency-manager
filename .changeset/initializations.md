---
"@parity/cdm-builder": minor
"@parity/cdm-cli": minor
---

Initializations: version-addressed init contracts (`initializations/X.Y.Z.rs|.sol`) deploy alongside their version and run exactly once, atomically, inside the publish — delivered through the per-name proxy's new admin-only `callCode` meta op, with a deploy-time storage-layout guard.
