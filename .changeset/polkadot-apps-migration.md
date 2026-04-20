---
"@dotdm/contracts": major
"@dotdm/env": major
"@dotdm/cli": minor
---

Migrate cdm internals onto the `@polkadot-apps` stack and expose a programmatic deploy/build API.

**`@dotdm/contracts`** — new public API + internal rewrites:

- Adds `buildContracts(opts)` and `deployContracts(opts)` as the primary library entry points. Both emit typed event streams (`BuildEvent`, `DeployEvent`) and return structured summaries (`BuildSummary`, `DeploySummary`) — suitable for consumers that want to render their own UI on top.
- `deployContracts()` accepts an injected `ChainClient` (from `@polkadot-apps/chain-client`) and a raw `PolkadotSigner`, so callers manage their own connections and signing strategy. No more hardcoded `~/.cdm/accounts.json` path inside the library.
- Combines deploy + register into a single AssetHub `batch_all` tx per layer (using CREATE2 address precomputation), and runs it in parallel with Bulletin metadata publish (using locally-precomputed CIDs). Typical deploy drops from ~3 signatures per contract to ~2 signatures per layer.
- `MetadataPublisher` now delegates to `@polkadot-apps/bulletin` (`upload` / `batchUpload`). Bulletin uploads are sequential per item (chain nonce-ordering requirement) — this matches `@polkadot-apps/bulletin`'s model and replaces the previous single-tx `Utility.batch_all` approach on Bulletin.
- `RegistryManager` now delegates reads through `@polkadot-apps/contracts` (`createContract`) and writes through `@polkadot-apps/tx` (`batchSubmitAndWatch`).
- `ContractDeployer` submits via `@polkadot-apps/tx` (`submitAndWatch` / `batchSubmitAndWatch`), inheriting atBest, timeouts, retry helpers, and `onStatus` hooks. CREATE2 salt derivation and `Revive.instantiate_with_code` call construction stay in-house.

**`@dotdm/env`** — connection layer rewritten:

- Adds `createCdmChainClient(chainName | {assethubUrl, bulletinUrl})` and `createCdmAssetHubClient(assethubUrl)` backed by `@polkadot-apps/chain-client`'s `createChainClient` (BYOD mode, using cdm's `KNOWN_CHAINS` registry).
- Removes `connectAssetHubWebSocket`, `connectBulletinWebSocket`, `connectSmoldot`. All call sites updated.
- `connectIpfsGateway` retained (covers `local` / `preview-net` networks not in `@polkadot-apps/bulletin.getGateway()`).
- Signer helpers (`prepareSigner*`) unchanged.

**`@dotdm/cli`** — internal refactor only, no user-facing CLI changes:

- `cdm build` and `cdm deploy` now consume `buildContracts()` / `deployContracts()` from `@dotdm/contracts`. Ink TUI (`DeployTable.tsx`) subscribes to the event stream via a thin `PipelineStatusAdapter`.
- Removes the temporary sequential-deploy patch in `detection.ts` — contracts in the same dependency layer now deploy in parallel.
