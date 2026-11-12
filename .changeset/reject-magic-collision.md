---
"@parity/cdm-builder": minor
"@parity/cdm-cli": patch
---

`cdm deploy` and `cdm build` refuse a contract with a method whose selector is the proxy call prefix (`0xa2264d53`) instead of warning and publishing it: the method could never be reached through the name's proxy, so the error names each one and asks for a rename.
