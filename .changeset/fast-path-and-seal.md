---
"@parity/cdm-builder": minor
---

Per-name proxies get a fast path and a seal. The frozen per-name shim keeps the name's latest version in its own storage and delegate-calls it directly for plain calls and calls pinned to that version, and answers the `latest()` query from it, without asking the resolver; the resolver pushes the version on publish and empties it while the name is frozen or its owner has opted out through the registry's new `setFastPath(name, enabled)`. The registry's new `sealContract(name)` irreversibly pins a name to its latest version: its shim never asks the resolver again (every other call reverts `Sealed()`) and every later change to the name reverts `NameSealed()`. The resolver gains `setFastPath`/`seal` and `routingOf` returns two more fields (`fast_path_off`, `sealed`); the proxy wire-format module gains the shim's own meta selectors and slot (`SHIM_META`, `SHIM_SLOTS`), the fast-path word (`packFastPath`/`unpackFastPath`), the getter encoders `encodeProxySealed`/`encodeProxyResolver`, and `decodeBoolWord`.

BREAKING: the frozen shim blob and `CONTRACT_PROXY_CODE_HASH` change, and the resolver only drives shims created from the new blob. A version's major is capped at 2147483647 (`MAX_MAJOR`): the shim keeps the version and its sealed flag in one storage word.
