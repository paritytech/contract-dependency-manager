# Playground App CDM Migration Guide

Date: 2026-06-02

Repository to migrate: `/Users/charleshetterich/code/playground-app/tmp/playground-app`

Do not use `/Users/charleshetterich/code/playground-app` for this migration guide. That checkout has unrelated in-progress work.

This guide assumes the CDM flat `cdm.json` PR and the matching `@parity/product-sdk-contracts` PR have been merged and released.

## Current State

This repo is a mixed frontend plus Rust contract app. The Rust contract is still written against the legacy experimental `cargo-pvm-contract` branch:

```toml
pvm_contract = { git = "https://github.com/paritytech/cargo-pvm-contract", branch = "charles/cdm-integration" }
```

The main contract is `contracts/registry/lib.rs`. It uses:

- `pvm_contract as pvm`
- `#[pvm::storage]`
- `#[pvm::contract(cdm = "@w3s/playground-registry")]`
- legacy `pvm::storage::{Mapping, OrderedIndex}`
- `cdm::import!("@mock/reputation")`
- a stored `reputation::Reference`

The frontend currently imports `cdm.json`, then uses local resolver code in `src/utils/contractManifest.ts` to query the CDM registry and patch addresses. That local resolver exists because product-sdk did not previously provide strict live CDM address resolution.

The current `cdm.json` is the old target-hash shape:

```json
{
  "targets": {
    "b7a87bf51613d89f": {
      "asset-hub": "wss://paseo-asset-hub-next-rpc.polkadot.io",
      "bulletin": "https://paseo-bulletin-next-ipfs.polkadot.io/ipfs",
      "registry": "0xf62c2ece29cd8df2e10040ecfa5a894a5c5d9cb0"
    }
  },
  "dependencies": {
    "b7a87bf51613d89f": {
      "@mock/reputation": "latest",
      "@polkadot/contexts": "latest",
      "@w3s/playground-registry": "latest",
      "@staging/playground-registry": "latest"
    }
  },
  "contracts": {
    "b7a87bf51613d89f": {}
  }
}
```

## Migration Target

Use the latest CDM CLI and latest product-sdk packages, but keep the Rust contract on the legacy contract language for now.

After migration, `cdm.json` should be flat:

```json
{
  "registry": "0xf62c2ece29cd8df2e10040ecfa5a894a5c5d9cb0",
  "dependencies": {
    "@mock/reputation": "latest",
    "@polkadot/contexts": "latest",
    "@w3s/playground-registry": "latest",
    "@staging/playground-registry": "latest"
  },
  "contracts": {
    "@w3s/playground-registry": {
      "version": 4,
      "address": "0x...",
      "abi": [],
      "metadataCid": "..."
    }
  }
}
```

The registry address still belongs in `cdm.json.registry`. Asset Hub, Bulletin, and IPFS gateway endpoints no longer come from `cdm.json`; commands must receive them from `-n paseo` or explicit endpoint flags.

## Toolchain

Install the latest released CDM CLI.

Keep `cargo-pvm-contract` on the legacy branch for this repository:

```sh
HOST_TARGET=$(rustc -vV | awk '/^host:/ {print $2}')
cargo install --force --locked \
  --target "$HOST_TARGET" \
  --git https://github.com/paritytech/cargo-pvm-contract.git \
  --branch charles/cdm-integration \
  cargo-pvm-contract
```

Do not install the current `sm/cdm`/new SDK toolchain for this repo unless you are also rewriting `contracts/registry/lib.rs`.

## Rust Contract Metadata

Current CDM detection no longer reads package identity from `#[pvm::contract(cdm = "...")]`. It uses Cargo metadata.

This is an intentional migration step, not a design flaw. The latest CLI needs the package name in `cargo metadata`, while the legacy source macro can remain in place until the contract is rewritten.

Add package metadata to `contracts/registry/Cargo.toml`:

```toml
[package.metadata.cdm]
package = "@w3s/playground-registry"
```

If this checkout is deploying the staging package instead, use:

```toml
[package.metadata.cdm]
package = "@staging/playground-registry"
```

Keep the legacy source macro argument for now, but keep it aligned with the Cargo metadata package:

```rust
#[pvm::contract(cdm = "@w3s/playground-registry")]
```

If deploying the staging package, update both places to `@staging/playground-registry`. The legacy macro still uses that value for legacy generated contract reference behavior. The Cargo metadata is for the latest CDM CLI detector/deployer.

## Important Compatibility Gap

`contracts/registry/lib.rs` uses `cdm::import!("@mock/reputation")`. The current CDM Rust proc macro expands through `pvm_contract_sdk::abi_import!` and `pvm-cdm`, while this contract still uses legacy `pvm_contract`.

That means a simple Rust dependency update to the latest `cdm` crate can break this legacy contract even if the global CDM CLI is latest.

There are several viable paths:

1. Keep the Rust `cdm` proc-macro dependency pinned to the existing legacy-compatible commit and keep using the old target-hash manifest for Rust builds. This conflicts with the new flat `cdm.json` goal and is only a short-term escape hatch.
2. Change only the `@mock/reputation` import to a legacy-compatible/manual import path that works with flat installed ABI artifacts.
3. Add a compatibility mode to CDM's Rust `cdm::import!` macro that detects legacy `pvm_contract` consumers and emits legacy `pvm::abi_import!(..., cdm = "...")` while reading the new flat `cdm.json` and project `.cdm` artifacts.
4. Rewrite `contracts/registry/lib.rs` to the current SDK. This is the clean long-term solution, but it is larger because this contract uses `OrderedIndex`, stored CDM references, and legacy storage APIs.

For this migration, do not assume latest-CDM `cdm::import!` will work unchanged in a legacy `pvm_contract` contract. This does not inherently require a full contract rewrite; the likely migration is to fix the `@mock/reputation` import path while leaving the rest of the legacy contract on `charles/cdm-integration`.

## Install The Flat Manifest

After the latest CDM CLI is installed and the registry contains all required packages, regenerate the local install state:

```sh
rm -rf .cdm
cdm i -n paseo \
  @mock/reputation \
  @polkadot/contexts \
  @w3s/playground-registry \
  @staging/playground-registry
```

This writes:

- flat `cdm.json`
- project-local `.cdm/contracts/<package>/<version>/...`
- `.cdm/cdm.d.ts`
- `.cdm/contracts.d.ts`

Do not preserve `targets`, target hashes, or `~/.cdm/<targetHash>/...` paths.

## Product SDK Migration

Update product-sdk dependencies to the released versions that include flat CDM manifest support and live registry address resolution.

The local resolver in `src/utils/contractManifest.ts` should be removed or reduced to constants. It currently duplicates behavior that now belongs in `@parity/product-sdk-contracts`.

Replace local `withLiveContractAddresses(...)` usage with one of the product-sdk APIs:

```ts
import { ContractManager, type CdmJson } from "@parity/product-sdk-contracts";
import { paseo_asset_hub } from "@parity/product-sdk-descriptors/paseo-asset-hub";
import cdmJson from "../../cdm.json";

const manager = await ContractManager.fromLiveClient(
  cdmJson as CdmJson,
  client.raw.assetHub,
  paseo_asset_hub,
  {
    defaultOrigin: getReadOrigin(),
    registryOrigin: getReadOrigin(),
    libraries: [
      PLAYGROUND_REGISTRY_CONTRACT,
      REPUTATION_CONTRACT,
      CONTEXTS_CONTRACT
    ]
  }
);
```

Use `ContractManager.fromClient(...)` only when the app intentionally wants the installed snapshot address from `cdm.json.contracts[pkg].address`.

Use `ContractManager.fromLiveClient(...)` when the app intentionally wants live registry resolution:

- `"latest"` dependencies resolve with `getAddress(name)`.
- numeric dependencies resolve with `getAddressAtVersion(name, version)`.
- ABI still comes from the installed snapshot in `cdm.json.contracts[pkg].abi`.
- failure is strict; it should not silently fall back to the snapshot address.

The registry address is read from `cdmJson.registry` by default. Asset Hub and descriptor are still passed separately.

## Files To Update

Update these frontend and script paths that currently assume target hashes or local live-resolution helpers:

- `src/utils/contractManifest.ts`
- `src/utils/contracts.ts`
- `e2e/registry.ts`
- `scripts/register-context.ts`
- `scripts/add-admin.ts`
- `scripts/import-registry-state.ts`
- `scripts/publish-metadata.ts`
- `scripts/cleanup-e2e-leaks.ts`
- `scripts/smoke-test-points.ts`
- `src/utils/contractManifest.test.ts`

Target-hash lookups should become flat lookups:

```ts
// Old
cdmJson.contracts[targetHash][packageName]

// New
cdmJson.contracts?.[packageName]
```

Endpoint lookups should not come from `cdm.json` anymore. Use chain config, `-n paseo`, or explicit environment variables.

## Query Origin

Live registry resolution uses contract dry-runs. On Paseo Asset Hub, the dry-run origin may need to be mapped in `pallet-revive`.

For frontend/public read paths, use one stable mapped read origin and pass it as both `defaultOrigin` and `registryOrigin` unless a connected product account is already available.

For signed paths, use the user's signer address:

```ts
{
  defaultOrigin: signer.address,
  defaultSigner: signer.signer,
  registryOrigin: signer.address
}
```

Do not let different pages invent different query origins.

## Verification

Run these checks after migration:

```sh
pnpm install
rm -rf .cdm
cdm i -n paseo @mock/reputation @polkadot/contexts @w3s/playground-registry @staging/playground-registry
pnpm typecheck
pnpm test
pnpm build
```

If the Rust contract is still expected to build, verify it explicitly:

```sh
cargo pvm-contract build --manifest-path Cargo.toml -p playground-registry
```

If this fails at `cdm::import!("@mock/reputation")`, that is the legacy/current macro compatibility gap described above.

## Gaps To Discuss

- The latest CDM Rust import macro currently targets the new SDK, but this repo's registry contract is legacy and imports `@mock/reputation`. The expected migration may be limited to that import path, either through a legacy-compatible import helper or a manual ABI import; a full contract rewrite is only the larger cleanup path.
- `cdm.json` no longer stores endpoints. Scripts that previously inferred Asset Hub or IPFS gateway from the manifest need an explicit environment/preset input.
- The app should use product-sdk's strict live resolver. Silent fallback from live registry lookup to a stale local snapshot should be avoided because it can pair a stale ABI with a newer address or hide registry failures.
