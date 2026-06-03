# Rock Paper Scissors CDM Migration Guide

Date: 2026-06-02

Repository to migrate: `/Users/charleshetterich/code/Rock-Paper-Scissors`

This guide assumes the CDM flat `cdm.json` PR and the matching `@parity/product-sdk-contracts` PR have been merged and released.

Unlike Playground App and Playground CLI, this project should migrate to the current `cargo-pvm-contract` SDK. Do not install or use the legacy `charles/cdm-integration` branch for this migration.

## Current State

The repo has one Rust contract:

- `contracts/leaderboard/lib.rs`
- package name `@example/leaderboard`

Before deploying to a shared registry, decide whether `@example/leaderboard` is still the right package name. Package names are globally owned in the registry; for a real app, use an app-specific namespace.

It currently uses the legacy SDK:

```rust
use pvm_contract as pvm;
use pvm::storage::Mapping;

#[pvm::storage]
struct Storage { ... }

#[pvm::contract(cdm = "@example/leaderboard")]
mod leaderboard { ... }
```

The current storage is simple:

- `player_count: u64`
- `player_at: Mapping<u64, [u8; 20]>`
- `is_registered: Mapping<[u8; 20], bool>`
- `player_cid: Mapping<[u8; 20], String>`
- `player_points: Mapping<[u8; 20], i64>`

This is a good candidate for the new SDK. It does not use `OrderedIndex`, cross-contract imports, `Option<T>` ABI returns, or arbitrary `Vec<T>` storage.

The current `cdm.json` is the old target-hash shape and must be regenerated.

## Toolchain

Install the latest released CDM CLI.

Use the current CDM/cargo-pvm-contract toolchain from the release. If the release still documents the SDK branch explicitly, it should be the current SDK branch, not `charles/cdm-integration`:

```sh
HOST_TARGET=$(rustc -vV | awk '/^host:/ {print $2}')
cargo install --force --locked \
  --target "$HOST_TARGET" \
  --git https://github.com/paritytech/cargo-pvm-contract.git \
  --branch sm/cdm \
  cargo-pvm-contract
```

If `cargo-pvm-contract` has been released to crates.io by the time this migration runs, use the released install command instead.

## Cargo Manifest Changes

Update the workspace root `Cargo.toml`.

Replace:

```toml
[workspace.dependencies]
cdm = { git = "https://github.com/paritytech/contract-dependency-manager" }
pvm_contract = { git = "https://github.com/paritytech/cargo-pvm-contract", branch = "charles/cdm-integration" }
polkavm-derive = "0.31"
parity-scale-codec = { version = "3.7", default-features = false, features = ["derive"] }
picoalloc = "5.2"
```

with:

```toml
[workspace.dependencies]
pvm-contract-sdk = { git = "https://github.com/paritytech/cargo-pvm-contract", branch = "sm/cdm", features = ["alloc"] }
polkavm-derive = "0.31"
picoalloc = "5.2"
```

`cdm` and `pvm-cdm` are only needed if this contract starts importing other CDM packages with `cdm::import!`. `parity-scale-codec` is not needed by the current `leaderboard` contract unless new code adds SCALE-encoded structs.

Update `contracts/leaderboard/Cargo.toml`.

Replace:

```toml
[dependencies]
cdm = { workspace = true }
pvm_contract = { workspace = true }
polkavm-derive = { workspace = true }
parity-scale-codec = { workspace = true }
picoalloc = { workspace = true }
```

with:

```toml
[features]
abi-gen = ["pvm-contract-sdk/abi-gen"]

[package.metadata.cdm]
package = "@example/leaderboard"

[dependencies]
pvm-contract-sdk = { workspace = true }
polkavm-derive = { workspace = true }
picoalloc = { workspace = true }
```

The package name now lives in Cargo metadata, not in the Rust contract macro.

## Contract Rewrite

Rewrite `contracts/leaderboard/lib.rs` to the receiver-based SDK shape.

Use this structure:

```rust
#![cfg_attr(not(feature = "abi-gen"), no_main, no_std)]

#[pvm_contract_sdk::contract(allocator = "pico", allocator_size = 4096)]
mod leaderboard {
    use alloc::string::String;
    use pvm_contract_sdk::{Address, HostApi, Lazy, Mapping};

    pvm_contract_sdk::sol_revert_enum! {
        pub enum Error {
            AlreadyRegistered(AlreadyRegistered),
            NotRegistered(NotRegistered),
            IndexOutOfBounds(IndexOutOfBounds),
        }
    }

    #[derive(Debug, pvm_contract_sdk::SolError)]
    pub struct AlreadyRegistered;

    #[derive(Debug, pvm_contract_sdk::SolError)]
    pub struct NotRegistered;

    #[derive(Debug, pvm_contract_sdk::SolError)]
    pub struct IndexOutOfBounds;

    pub struct Leaderboard {
        #[slot(0)]
        player_count: Lazy<u64>,
        #[slot(1)]
        player_at: Mapping<u64, [u8; 20]>,
        #[slot(2)]
        is_registered: Mapping<[u8; 20], bool>,
        #[slot(3)]
        player_cid: Mapping<[u8; 20], String>,
        #[slot(4)]
        player_points: Mapping<[u8; 20], i64>,
    }

    impl Leaderboard {
        #[pvm_contract_sdk::constructor]
        pub fn new(&mut self) {
            self.player_count.set(&0);
        }

        #[pvm_contract_sdk::method]
        pub fn register(&mut self) -> Result<u64, Error> {
            let caller = self.caller();

            if self.is_registered.get(&caller.0) {
                return Err(AlreadyRegistered.into());
            }

            let idx = self.player_count.get();
            self.player_at.insert(&idx, &caller.0);
            self.is_registered.insert(&caller.0, &true);
            self.player_points.insert(&caller.0, &0);
            self.player_count.set(&(idx + 1));

            Ok(idx)
        }

        #[pvm_contract_sdk::method]
        pub fn update_result(&mut self, new_cid: String, points_delta: i64) -> Result<(), Error> {
            let caller = self.caller();

            if !self.is_registered.get(&caller.0) {
                return Err(NotRegistered.into());
            }

            self.player_cid.insert(&caller.0, &new_cid);

            let current = self.player_points.get(&caller.0);
            self.player_points.insert(&caller.0, &(current + points_delta));

            Ok(())
        }

        #[pvm_contract_sdk::method]
        pub fn get_player_count(&self) -> u64 {
            self.player_count.get()
        }

        #[pvm_contract_sdk::method]
        pub fn get_player_at(&self, index: u64) -> Result<Address, Error> {
            if index >= self.player_count.get() {
                return Err(IndexOutOfBounds.into());
            }
            Ok(Address(self.player_at.get(&index)))
        }

        #[pvm_contract_sdk::method]
        pub fn get_player_cid(&self, player: Address) -> String {
            self.player_cid.get(&player.0)
        }

        #[pvm_contract_sdk::method]
        pub fn get_player_points(&self, player: Address) -> i64 {
            self.player_points.get(&player.0)
        }

        #[pvm_contract_sdk::method]
        pub fn is_registered(&self, player: Address) -> bool {
            self.is_registered.get(&player.0)
        }

        fn caller(&self) -> Address {
            let mut buf = [0u8; 20];
            self.host().caller(&mut buf);
            Address(buf)
        }
    }
}
```

This keeps the public ABI close to the old contract:

- `Address` ABI-encodes as Solidity `address`.
- The frontend's existing `0x...` values should work for `getPlayerCid`, `getPlayerPoints`, and `isRegistered`.
- `getPlayerAt` will return an address-like hex value instead of a raw `bytes20`/`Uint8Array` shape. The current frontend already handles hex string returns.

If exact `bytes20` ABI compatibility is required, return `[u8; 20]` and accept `[u8; 20]` instead of `Address`. Prefer `Address` unless a deployed frontend already depends on `bytes20`.

## Frontend Manifest Migration

Remove the old target-hash `cdm.json` and reinstall after deploy:

```sh
rm -rf .cdm
cdm build
cdm deploy -n paseo
cdm i -n paseo @example/leaderboard
```

The new manifest should look like:

```json
{
  "registry": "0xf62c2ece29cd8df2e10040ecfa5a894a5c5d9cb0",
  "dependencies": {
    "@example/leaderboard": "latest"
  },
  "contracts": {
    "@example/leaderboard": {
      "version": 1,
      "address": "0x...",
      "abi": [],
      "metadataCid": "..."
    }
  }
}
```

Do not keep `targets`.

`cdm.json.registry` is still valid and is used by product-sdk live address resolution. Asset Hub and IPFS gateway URLs are no longer read from `cdm.json`; keep them in app config or constants.

## Product SDK Migration

Update product-sdk packages to the released versions that include flat CDM support. At minimum:

```json
{
  "dependencies": {
    "@parity/product-sdk-contracts": "<latest release>",
    "@parity/product-sdk-descriptors": "<latest release>",
    "@parity/product-sdk-address": "<latest release>",
    "@parity/product-sdk-tx": "<latest release>"
  }
}
```

Keep `@novasamatech/product-sdk` and `@novasamatech/host-api` aligned with the product-sdk release used by the app shell. Do not leave old local overrides in `package.json`.

In `src/utils.ts`, switch contract manager initialization to product-sdk's live resolver if the app should always use the latest deployed leaderboard address:

```ts
_contractManager = await ContractManager.fromLiveClient(
  _cdmJson,
  _polkadotClient,
  paseo_asset_hub,
  _state.account
    ? {
        defaultOrigin: _state.account.address as never,
        defaultSigner: _state.account.signer,
        registryOrigin: _state.account.address as never,
        libraries: ["@example/leaderboard"]
      }
    : {
        defaultOrigin: READ_ONLY_QUERY_ORIGIN as never,
        registryOrigin: READ_ONLY_QUERY_ORIGIN as never,
        libraries: ["@example/leaderboard"]
      }
);
```

Use `ContractManager.fromClient(...)` only if the app intentionally wants the installed snapshot address.

Do not implement a local CDM registry ABI or hand-written `getAddress` query. Product-sdk now owns that.

## Query Origin

This app already has account mapping logic for signed leaderboard updates. Live registry lookup also runs as a contract query, so it needs a valid origin.

For public pages before sign-in, either:

- configure a stable mapped read origin, or
- delay contract initialization until the user has connected a mapped product account.

If you keep public leaderboard reads without sign-in, add one configured read origin:

```ts
const READ_ONLY_QUERY_ORIGIN = "5...";
```

Make sure that account is mapped on Paseo Asset Hub. Pass it as both `defaultOrigin` and `registryOrigin`.

## Frontend Call-Site Checks

After changing the contract to `Address`, verify these existing call sites:

- `src/pages/Leaderboard.tsx`
- `src/pages/SoloGame.tsx`
- `src/pages/MultiplayerGame.tsx`
- `src/pages/MyProfile.tsx`
- `src/pages/PlayerHistory.tsx`

The helper `asBytes20(...)` may become better named as `asAddress(...)`, but a `0x` H160 string should still be accepted by the ABI encoder.

Watch these method result shape changes:

- `register.tx()` now calls a method returning `Result<u64, Error>`. Product-sdk should expose successful tx as before, but dry-run failures now carry typed revert details.
- `getPlayerAt.query(...)` may return a hex address string instead of `Uint8Array`.
- `updateResult.tx(...)` returns `Result<(), Error>` rather than reverting with raw bytes.

## Verification

Run:

```sh
pnpm install
cargo pvm-contract build --manifest-path Cargo.toml -p leaderboard
cdm build
cdm deploy -n paseo
cdm i -n paseo @example/leaderboard
pnpm build:frontend
```

Then test in the app:

- public leaderboard loads
- account connect works
- first-time account mapping works
- `register` succeeds
- `updateResult` succeeds
- page refresh still resolves the current contract from the registry

## Gaps To Discuss

- Public read-only contract queries need a mapped origin if they initialize before a user connects. This should become a shared app pattern rather than per-page logic.
- `Address` is cleaner than `bytes20`, but it is technically an ABI change. The current frontend appears tolerant because it already accepts hex strings.
- `ContractManager.fromLiveClient(...)` resolves addresses strictly. If the registry is down or `@example/leaderboard` is not registered, the app should show a real error rather than falling back to a stale snapshot.
