---
"@parity/cdm-builder": minor
"@parity/cdm-utils": minor
"@parity/cdm-cli": patch
---

Per-name proxies defer every decision to an upgradeable resolver. The frozen per-name blob is now a policy-free shim: it forwards each call as `resolve(caller, value, data)` to the resolver address baked into its immutable data and does exactly what the answer says (return a payload, or delegate-call a target with a prefix stripped). The new `contract-resolver`, deployed behind the shared EIP-1967 proxy with the registry as admin, owns the routing tables and policy for every name, so one `upgradeResolver` reaches every name ever published. The registry gains `setResolver`/`getResolver`/`upgradeResolver` and writes publishes, floors, and freezes to the resolver; `getMinSupported` moves to the resolver's `routingOf`. The deploy tooling predicts and deploys the resolver pair (`@cdm/resolver.1`, `@cdm/resolver-impl.1`), `deploy-registry.ts` prints `CDM_RESOLVER_ADDR` and gains `--upgrade-resolver`, `CONTRACTS_REGISTRY_PROXY_CRATE` becomes `CONTRACTS_EIP1967_PROXY_CRATE`, and the proxy wire-format module drops the mutation encoders (`callCode` now carries its calldata unframed after the target word).
