# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

---

# cargo-pvm-contract Reference

A Rust framework for writing smart contracts that compile to PolkaVM on Polkadot. Contracts are `#![no_std]` / `#![no_main]` and compile to RISC-V PolkaVM bytecode. Uses nightly Rust.

## Contract Definition

```rust
#![no_main]
#![no_std]

use pvm_contract as pvm;

#[pvm::contract(cdm = "@org/contract-name")]
mod my_contract {
    use super::*;
    // constructors, methods, errors...
}
```

**`#[pvm::contract]` attributes:**
- `cdm = "@namespace/name"` — Register with CDM (enables cross-contract lookup via registry)
- `"path/to/Interface.sol"` — Optional Solidity interface file for ABI

Rust `snake_case` method names automatically convert to Solidity `camelCase` in the generated ABI.

## Constructor

```rust
#[pvm::constructor]
pub fn new(param: u32) -> Result<(), Error> {
    Storage::my_field().set(&param);
    Ok(())
}
```

Must return `Result<(), Error>`. Called once at deploy time. Parameters are ABI-encoded in calldata (no selector).

## Methods

```rust
#[pvm::method]
pub fn my_method(arg1: u32, arg2: String) -> u64 {
    // ...
}

#[pvm::method]
pub fn fallible_method() -> Result<u32, Error> {
    // Err(e) triggers revert with e.as_ref() bytes
    Ok(42)
}
```

- Return `Result<T, Error>` for methods that can revert
- Return `T` directly for infallible methods
- `#[pvm::method(rename = "customName")]` to override the Solidity name

## Fallback

```rust
#[pvm::fallback]
pub fn fallback() -> Result<(), Error> {
    Err(Error::UnknownSelector)
}
```

Called when calldata < 4 bytes or selector doesn't match any method.

## Storage

```rust
use pvm::storage::{Lazy, Mapping};

#[pvm::storage]
struct Storage {
    count: u32,                              // becomes Lazy<u32>
    owner: [u8; 20],                         // becomes Lazy<[u8; 20]>
    balances: Mapping<[u8; 20], u128>,       // stays Mapping
    approvals: Mapping<([u8; 20], [u8; 20]), bool>,  // composite tuple key
}
```

The `#[pvm::storage]` macro transforms fields into storage accessors on the struct.

**Lazy\<V\> (single values):**
```rust
Storage::count().get()        // -> Option<V>
Storage::count().set(&value)
Storage::count().exists()     // -> bool
Storage::count().clear()
```

**Mapping\<K, V\>:**
```rust
Storage::balances().get(&key)           // -> Option<V>
Storage::balances().insert(&key, &val)
Storage::balances().remove(&key)
Storage::balances().contains(&key)      // -> bool
```

**Composite keys** use tuples: `Mapping<(A, B), V>`, `Mapping<(A, B, C), V>`. Storage keys are keccak256-hashed from SCALE-encoded data.

You can define **multiple storage structs** for organization:
```rust
#[pvm::storage]
struct Workers { profiles: Mapping<Address, String> }

#[pvm::storage]
struct Tasks { items: Mapping<[u8; 32], TaskData>, count: u64 }
```

You can also store cross-contract references in storage:
```rust
#[pvm::storage]
struct Contracts {
    reputation: reputation::Reference,
    disputes: disputes::Reference,
}
```

## Supported Types

| Rust Type | Solidity Type | Notes |
|-----------|--------------|-------|
| `bool` | `bool` | |
| `u8` - `u128` | `uint8` - `uint128` | |
| `i8` - `i128` | `int8` - `int128` | |
| `U256` | `uint256` | from `alloy_primitives` |
| `I256` | `int256` | from `alloy_primitives` |
| `Address` | `address` | from `ethereum_types`, 20 bytes |
| `[u8; N]` | `bytesN` | N in {1,2,4,8,16,20,32} |
| `String` | `string` | dynamic, requires alloc |
| `Vec<u8>` | `bytes` | dynamic, requires alloc |
| `Vec<T>` | `T[]` | dynamic array |
| `[T; N]` | fixed array | |
| `(T1, T2)` | `tuple` | |
| `Option<T>` | `(bool, T)` | encoded as bool+value tuple |

## Custom Structs with SolAbi

For **return types / method parameters** (Solidity ABI encoding):
```rust
#[derive(pvm::SolAbi)]
pub struct TaskData {
    pub id: [u8; 32],
    pub owner: Address,
    pub status: u8,
    pub budget: u64,
    pub title: String,
}

#[pvm::method]
pub fn get_task(id: [u8; 32]) -> TaskData { ... }
```

For **storage values** (SCALE encoding):
```rust
use parity_scale_codec::{Encode, Decode};

#[derive(Default, Clone, Encode, Decode)]
struct Review {
    rating: u8,
    comment: String,
}
```

These serve different purposes — `SolAbi` is for the external ABI, `Encode`/`Decode` is for on-chain storage serialization.

## Error Handling

**Never use `.expect()` or `.unwrap()` in contracts.** A panic produces a generic "contract trapped" error with no useful information. Always use `revert()` with a descriptive message so callers know what went wrong.

Define a custom Error enum inside or outside the contract module:
```rust
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Error {
    Unauthorized,
    InsufficientBalance,
}

impl AsRef<[u8]> for Error {
    fn as_ref(&self) -> &[u8] {
        match self {
            Self::Unauthorized => b"Unauthorized",
            Self::InsufficientBalance => b"InsufficientBalance",
        }
    }
}
```

Or use the `common` crate's `revert` (preferred — see Common Library below):
```rust
use common::revert;
revert(b"Unauthorized");
```

## Cross-Contract Calls

There are two ways to reference other contracts depending on whether they're in the same workspace or external.

### Same-workspace contracts (Cargo path dependency)

When contracts are in the same Cargo workspace, add a direct path dependency:

```toml
# counter-writer/Cargo.toml
[dependencies]
counter = { path = "../counter" }
```

The dependency contract's `#[pvm::contract(cdm = "...")]` annotation automatically generates a module with `cdm_reference()`:

```rust
#[pvm::method]
pub fn write_increment() {
    let counter = counter::cdm_reference();
    if let Err(_) = counter.increment() {
        revert(b"IncrementFailed");
    }
}
```

### External contracts (cdm::import!)

For contracts published to the CDM registry (not in your workspace), use `cdm::import!`:

```rust
cdm::import!("@polkadot/reputation");
cdm::import!("@polkadot/disputes");
cdm::import!("@polkadot/contexts");
```

This requires:
1. The `cdm` crate as a dependency in Cargo.toml: `cdm = { workspace = true }`
2. The contracts installed via CLI: `cdm i -n paseo @polkadot/reputation @polkadot/disputes @polkadot/contexts`
3. A `cdm.json` in the project root (created/updated by `cdm install`)

**What happens at compile time:** The `cdm::import!` macro reads `cdm.json` to find the package, resolves the ABI from `~/.cdm/<targetHash>/contracts/<package>/<version>/abi.json`, and generates a typed module with a `Reference` struct and `cdm_reference()` function — identical to what same-workspace contracts produce.

After importing, usage is the same regardless of which method was used:
```rust
let rep = reputation::cdm_reference();
if let Err(_) = rep.submit_review(context_id, reviewer, entity, rating, comment) {
    revert(b"SubmitReviewFailed");
}

let disp = disputes::cdm_reference();
if let Err(_) = disp.open_dispute(context_id, entity_id, claimant, against, evidence, rule) {
    revert(b"OpenDisputeFailed");
}
```

The module name is derived from the package name: `@polkadot/reputation` → `reputation`, `@org/my-contract` → `my_contract`.

### CallError handling

Cross-contract calls return `Result<T, CallError>`. **Never use `.expect()` or `.unwrap()` on these** — a panic produces a useless "contract trapped" error. Always revert with a descriptive message:

```rust
// Preferred — concise with revert:
let count = match counter.get_count() {
    Ok(val) => val,
    Err(_) => revert(b"GetCountFailed"),
};

// Exhaustive matching when you need to distinguish error types:
match disp.open_dispute(context_id, entity_id, claimant, against, evidence, rule) {
    Ok(val) => val,
    Err(e) => match e {
        pvm::call::CallError::Reverted => revert(b"CallReverted"),
        pvm::call::CallError::Trapped => revert(b"CallTrapped"),
        pvm::call::CallError::TransferFailed => revert(b"TransferFailed"),
        pvm::call::CallError::OutOfResources => revert(b"OutOfResources"),
        pvm::call::CallError::Unknown => revert(b"UnknownCallError"),
    },
}
```

### Storing references for later use

References can be stored in storage and retrieved in methods instead of calling `cdm_reference()` each time:

```rust
#[pvm::storage]
struct Contracts {
    reputation: reputation::Reference,
    disputes: disputes::Reference,
}

// In constructor:
Contracts::reputation().set(&reputation::cdm_reference());
Contracts::disputes().set(&disputes::cdm_reference());

// In methods:
let rep = match Contracts::reputation().get() {
    Some(r) => r,
    None => revert(b"ReputationNotInitialized"),
};
if let Err(_) = rep.submit_review(...) {
    revert(b"SubmitReviewFailed");
}
```

## Low-Level API

Available via `pvm::api` (re-exported from `pallet_revive_uapi`):

```rust
pvm::caller()                              // -> Address (20 bytes)
pvm::api::value_transferred(&mut buf)      // native token sent with call (32 bytes LE)
pvm::api::now(&mut buf)                    // current block timestamp in seconds (32 bytes LE)
pvm::api::address(&mut buf)               // contract's own address (20 bytes)
pvm::api::hash_keccak_256(input, &mut out) // keccak256 hash
pvm::api::deposit_event(&topics, &data)    // emit event (manual topic construction)
pvm::api::return_value(flags, &data)       // return/revert with data
pvm::api::call(flags, addr, ref_time, proof_size, deposit, value, input, output) // low-level call
```

**Flags:** `ReturnFlags::empty()` (success), `ReturnFlags::REVERT`, `CallFlags::empty()`, `CallFlags::ALLOW_REENTRY`

## Common Patterns

**Access control:**
```rust
if pvm::caller() != Storage::owner().get().unwrap() {
    revert(b"Unauthorized");
}
```

**Counter/index pattern (simulating iterable collections):**
```rust
let idx = Storage::count().get().unwrap_or(0);
Storage::items().insert(&idx, &item);
Storage::count().set(&(idx + 1));
```

**Reading transferred value:**
```rust
let mut buf = [0u8; 32];
pvm::api::value_transferred(&mut buf);
let amount = u128::from_le_bytes(buf[..16].try_into().unwrap());
```

**Transferring native tokens:**
```rust
fn transfer(to: &Address, amount: u128) {
    let mut value = [0u8; 32];
    value[..16].copy_from_slice(&amount.to_le_bytes());
    let deposit = [0u8; 32];
    let mut out: &mut [u8] = &mut [];
    let _ = pvm::api::call(
        CallFlags::empty(), to.as_fixed_bytes(),
        0, 0, &deposit, &value, &[], Some(&mut out),
    );
}
```

**Getting current timestamp:**
```rust
let mut buf = [0u8; 32];
pvm::api::now(&mut buf);
let seconds = u64::from_le_bytes(buf[0..8].try_into().unwrap());
```

**no_std heap types (when needed):**
```rust
extern crate alloc;
use alloc::string::String;
use alloc::vec::Vec;
```

## Cargo.toml Setup

Workspace root:
```toml
[workspace]
resolver = "2"
members = ["contracts/*"]

[workspace.dependencies]
cdm = { git = "https://github.com/paritytech/contract-dependency-manager" }
pvm_contract = { git = "https://github.com/paritytech/cargo-pvm-contract", branch = "charles/cdm-integration" }
polkavm-derive = "0.31"
parity-scale-codec = { version = "3.7", default-features = false, features = ["derive"] }
picoalloc = "5.2"
```

Per-contract:
```toml
[lib]
path = "lib.rs"

[[bin]]
name = "my_contract"
path = "lib.rs"

[dependencies]
pvm_contract = { workspace = true }
polkavm-derive = { workspace = true }
parity-scale-codec = { workspace = true }
picoalloc = { workspace = true }
# Add if using cdm::import! for external contracts:
cdm = { workspace = true }
# Add for same-workspace cross-contract calls:
other_contract = { path = "../other_contract" }
```

---

# Common Library (`common` crate)

Shared types and utilities used across contracts. Add as a dependency: `common = { path = "../path/to/common" }` (or via workspace).

## Core Types

```rust
pub type UUID = [u8; 32];
pub type EntityId = UUID;    // Identifier for any entity (task, agreement, user, etc.)
pub type ContextId = UUID;   // Identifier for a context (namespace owned by a contract)
```

These are all `[u8; 32]` aliases. The distinction is semantic — `ContextId` identifies a namespace, `EntityId` identifies something within one.

## Helpers

```rust
use common::{revert, generate_id, EntityId, ContextId, UUID};

// Revert with message (cleanly reverts all state changes)
revert(b"Unauthorized");

// Generate deterministic ID from a counter nonce
let id: UUID = generate_id(count);  // nonce stored in bytes 24..32
```

## Math: RunningAverage

For computing incremental averages (used by reputation and disputes for vote tallying):

```rust
use common::math::RunningAverage;

let mut avg = RunningAverage::new();
avg.update(None, Some(200));        // Add new rating of 200
avg.update(None, Some(100));        // Add another
avg.update(Some(200), Some(150));   // Replace 200 with 150
avg.val()        // -> current average as u8
avg.n_entries()  // -> count of entries
avg.sum()        // -> sum of all values
```

`RunningAverage` derives `Encode + Decode + Clone + Default` so it can be stored in contract storage directly.

---

# Context-Aware System Contracts

The ecosystem includes shared "system contracts" that any app contract can integrate with. These are generic, context-scoped services deployed once and used by many apps.

## Architecture

```
┌─────────────────────────────────────────────────┐
│                 contexts contract                │
│          (@polkadot/contexts)                    │
│   Maps ContextId -> owner Address               │
│   "First registration wins"                     │
└──────────────┬──────────────────┬───────────────┘
               │                  │
       ┌───────┴───────┐  ┌──────┴────────┐
       │  reputation   │  │   disputes    │
       │(@polkadot/    │  │(@polkadot/    │
       │  reputation)  │  │  disputes)    │
       │               │  │               │
       │ Scoped by     │  │ Scoped by     │
       │ (ContextId,   │  │ (ContextId,   │
       │  EntityId)    │  │  EntityId)    │
       └───────────────┘  └───────────────┘
               ▲                  ▲
               │                  │
       ┌───────┴──────────────────┴───────┐
       │         Your App Contract        │
       │      (e.g. @yourorg/appname)     │
       │                                  │
       │  1. Registers a ContextId        │
       │  2. Delegates to reputation/     │
       │     disputes as context owner    │
       └──────────────────────────────────┘
```

**Key concept:** An app contract registers a `ContextId` with the contexts contract, becoming its owner. It then calls reputation/disputes as the context owner, which those contracts verify via `contexts.is_owner(context_id, caller())`. All data is scoped by `(ContextId, EntityId)` so multiple apps share the same system contracts without data collision.

## Contexts Contract (@polkadot/contexts)

The base registry. A context is simply a `ContextId -> owner Address` mapping.

**Methods:**
- `register_context(context_id: ContextId)` — Claim a context ID (first-come-first-served, caller becomes owner)
- `get_owner(context_id: ContextId) -> Address` — Query owner
- `is_owner(context_id: ContextId, address: Address) -> bool` — Verify ownership

**Typical pattern:** An app contract derives its context ID from its own address in the constructor:
```rust
#[pvm::constructor]
pub fn new() -> Result<(), Error> {
    let mut addr = [0u8; 20];
    pvm::api::address(&mut addr);
    let mut context_id: ContextId = [0u8; 32];
    context_id[..20].copy_from_slice(&addr);

    if let Err(_) = contexts::cdm_reference().register_context(context_id) {
        revert(b"RegisterContextFailed");
    }
    Storage::context_id().set(&context_id);
    Ok(())
}
```

## Reputation Contract (@polkadot/reputation)

Manages reviews and ratings scoped by `(ContextId, EntityId)`.

**Methods (context owner only):**
- `submit_review(context_id, reviewer: Address, entity: EntityId, rating: u8, comment_uri: String)` — Add or update a review. If the reviewer already reviewed this entity, their rating is updated in-place.
- `delete_review(context_id, reviewer: Address, entity: EntityId)` — Remove a review (swap-and-pop)

**Query methods (anyone):**
- `get_rating(context_id, reviewer: Address, entity: EntityId) -> u8` — Single reviewer's rating
- `get_review_at(context_id, entity: EntityId, index: u64) -> Review` — Review by index (for iteration)
- `get_metrics(context_id, entity: EntityId) -> Metrics` — `{ average: u8, count: u64 }`

**Return types:**
```rust
struct Review { reviewer: Address, rating: u8, comment_uri: String }
struct Metrics { average: u8, count: u64 }
```

Ratings use the full `u8` range (0-255). Frontend maps to stars via factor of 51 (1 star = 51, 5 stars = 255).

## Disputes Contract (@polkadot/disputes)

Manages the full lifecycle of disputes scoped by `(ContextId, EntityId)`.

**Dispute lifecycle:**
```
OPEN (0)  ->  EVIDENCE_SUBMITTED (1)  ->  VOTING (2)  ->  RESOLVED (3)
```

**Instructions** are per-context templates defining dispute types:
- `RULE_BINARY (0)` — Voters choose 0 or 1 (stored as 0 or 255). Decision: avg >= 128 → 1, else 0.
- `RULE_RANGE (1)` — Voters submit 0-255. Decision: the average value.

Auto-resolves after 4 votes.

**Methods (context owner only):**
- `add_instruction(context_id, metadata_uri: String, voting_rule_id: u8)` — Create dispute template
- `open_dispute(context_id, dispute_id: EntityId, claimant: Address, against: EntityId, claim_uri: String, instruction_index: u32)` — Open a dispute
- `submit_counter_evidence(context_id, dispute_id, counter_claim_uri: String)` — Defendant responds
- `begin_voting(context_id, dispute_id)` — Open for community votes
- `provide_judgment(context_id, dispute_id, decision: u8, resolution_uri: String)` — Owner override
- `delete_dispute(context_id, dispute_id)` — Remove (only if OPEN or RESOLVED)

**Methods (anyone):**
- `cast_vote(context_id, dispute_id, value: u8)` — Vote (supports updates)

**Query methods (anyone):**
- `get_dispute_status(context_id, dispute_id) -> u8` — Status (0-3, or 255 if not found)
- `get_decision(context_id, dispute_id) -> u8` — Final decision
- `get_vote_count(context_id, dispute_id) -> u32`
- `get_dispute_info(context_id, dispute_id) -> DisputeInfo` — Full details
- `get_instruction_count(context_id) -> u32`
- `get_instruction(context_id, index: u32) -> InstructionInfo`
- `get_total_dispute_count() -> u32` — Global across all contexts
- `get_dispute_at(index: u32) -> DisputeRef` — Global enumeration

## Using System Contracts from an App

Full example of an app contract integrating all three system contracts:

```rust
cdm::import!("@polkadot/reputation");
cdm::import!("@polkadot/disputes");
cdm::import!("@polkadot/contexts");

#[pvm::storage]
struct Contracts {
    context_id: ContextId,
    reputation: reputation::Reference,
    disputes: disputes::Reference,
}

#[pvm::contract(cdm = "@yourorg/myapp")]
mod myapp {
    use super::*;

    #[pvm::constructor]
    pub fn new() -> Result<(), Error> {
        // Derive context ID from contract address
        let mut addr = [0u8; 20];
        pvm::api::address(&mut addr);
        let mut context_id: ContextId = [0u8; 32];
        context_id[..20].copy_from_slice(&addr);

        // Register context (this contract becomes the owner)
        if let Err(_) = contexts::cdm_reference().register_context(context_id) {
            revert(b"RegisterContextFailed");
        }
        Contracts::context_id().set(&context_id);

        // Store references for later use
        Contracts::reputation().set(&reputation::cdm_reference());
        let disp = disputes::cdm_reference();
        Contracts::disputes().set(&disp);

        // Set up a dispute instruction (template)
        if let Err(_) = disp.add_instruction(context_id, String::from(""), 0u8) {
            revert(b"AddInstructionFailed");
        }

        Ok(())
    }

    #[pvm::method]
    pub fn leave_review(reviewed: Address, rating: u8, comment_uri: String) {
        let context_id = match Contracts::context_id().get() {
            Some(id) => id,
            None => revert(b"ContextIdNotSet"),
        };
        let rep = match Contracts::reputation().get() {
            Some(r) => r,
            None => revert(b"ReputationNotInitialized"),
        };
        // App contract is context owner, so this call is authorized
        if let Err(_) = rep.submit_review(context_id, caller(), address_to_entity(&reviewed), rating, comment_uri) {
            revert(b"SubmitReviewFailed");
        }
    }

    #[pvm::method]
    pub fn open_dispute(entity_id: EntityId, evidence_uri: String) {
        let context_id = match Contracts::context_id().get() {
            Some(id) => id,
            None => revert(b"ContextIdNotSet"),
        };
        let disp = match Contracts::disputes().get() {
            Some(d) => d,
            None => revert(b"DisputesNotInitialized"),
        };
        if let Err(_) = disp.open_dispute(context_id, entity_id, caller(), entity_id, evidence_uri, 0u32) {
            revert(b"OpenDisputeFailed");
        }
    }
}
```

Key point: the app contract is the context owner, so when it calls `reputation.submit_review(...)` or `disputes.open_dispute(...)`, those system contracts verify `contexts.is_owner(context_id, caller())` — and the caller is the app contract's address, which is indeed the registered owner.

---

# CDM (Contract Dependency Manager) Reference

CDM handles building, deploying, versioning, and interacting with PVM smart contracts on Polkadot.

## CLI Commands

```bash
cdm build                              # Build all contracts
cdm build --contracts counter writer   # Build specific contracts
cdm deploy -n <chain>                  # Build + deploy + register on chain
cdm deploy -n <chain> --bootstrap      # Also deploy the ContractRegistry first
cdm deploy -n <chain> --suri "//Bob"   # Custom signer
cdm i -n <chain> @org/contract         # Install contract (latest version)
cdm i -n <chain> @org/contract:3       # Install specific version
cdm template shared-counter            # Scaffold from template
cdm init                               # Generate keypair, save to ~/.cdm/accounts.json
cdm account map -n <chain>             # Map account for Revive pallet (required before first deploy)
cdm account bal -n <chain>             # Show balances
```

**Chain presets:** `paseo`, `preview-net`, `polkadot`, `local`, `custom`

## Workflow

### Building

`cdm build` detects PVM contracts via Cargo metadata, builds them in dependency order, and outputs to `target/`:
- `{name}.release.polkavm` — bytecode
- `{name}.release.abi.json` — Solidity-compatible ABI
- `{name}.release.cdm.json` — CDM package metadata (`{ cdmPackage: "@org/name" }`)

### Deploying

`cdm deploy -n <chain>` does build -> deploy -> publish metadata -> register:

1. **Build** all contracts in topological dependency order
2. **Deploy** to Asset Hub via `Revive.instantiate_with_code` (dry-runs for gas estimation first)
3. **Publish metadata** to Bulletin chain -> gets an IPFS CID
4. **Register** in on-chain ContractRegistry: maps `@org/name:version -> (address, CID)`

Use `--bootstrap` on first deploy to a chain to deploy the ContractRegistry itself.

### Installing (for consumers)

`cdm install` (alias `cdm i`) fetches published contract ABIs for use from Rust or TypeScript:

```bash
cdm i -n paseo @polkadot/reputation @polkadot/disputes @polkadot/contexts
```

This:
1. Queries the on-chain registry for version, address, and metadata CID
2. Fetches ABI from IPFS
3. Saves to `~/.cdm/<targetHash>/contracts/<library>/<version>/abi.json`
4. Updates `cdm.json` with contract address, ABI, version, and CID
5. Generates `.cdm/cdm.d.ts` TypeScript type augmentations
6. Ensures `tsconfig.json` includes `"./.cdm/**/*"`

After installing, contracts are available via:
- **Rust:** `cdm::import!("@polkadot/reputation")` -> gives `reputation::cdm_reference()`
- **TypeScript:** `cdm.getContract("@polkadot/reputation")` -> gives typed `.query()` / `.tx()` handle

## cdm.json Format

```json
{
  "targets": {
    "<targetHash>": {
      "asset-hub": "wss://asset-hub-paseo-rpc.n.dwellir.com",
      "bulletin": "https://paseo-ipfs.polkadot.io/ipfs",
      "registry": "0xede6d5f092de34152f8952baa99a35363ed087c0"
    }
  },
  "dependencies": {
    "<targetHash>": { "@org/contract": "latest" }
  },
  "contracts": {
    "<targetHash>": {
      "@org/contract": {
        "version": 0,
        "address": "0x...",
        "abi": [...],
        "metadataCid": "bafk..."
      }
    }
  }
}
```

Target hash = first 8 bytes of `blake2b(assethubUrl + "\n" + bulletinUrl + "\n" + registryAddress)`.

## TypeScript Client (@dotdm/cdm)

### Setup

Pass the `cdm.json` explicitly — this works in both Node and browser environments:

```typescript
import { createCdm } from "@dotdm/cdm";
import cdmJson from "../cdm.json";

const cdm = createCdm(cdmJson);
```

The `cdm.json` is detected by the presence of a `"targets"` key. You can also pass options as a second arg:

```typescript
const cdm = createCdm(cdmJson, {
  targetHash?: string,           // override target (defaults to first)
  client?: PolkadotClient,       // provide existing WebSocket client
  defaultOrigin?: SS58String,    // signer origin for queries
  defaultSigner?: PolkadotSigner // signer for transactions
});
```

### Contract Handles

```typescript
const counter = cdm.getContract("@example/counter");
// Fully typed via .cdm/cdm.d.ts module augmentation (generated by cdm install)
```

### Querying (Read-Only)

```typescript
const result = await counter.getCount.query();
// result: { success: boolean, value: number, gasRequired?: bigint }
console.log(result.value);
```

### Transactions (State-Changing)

```typescript
await counterWriter.writeIncrement.tx();
// Returns: { txHash, blockHash, ok, events[] }

// With arguments:
await counterWriter.writeIncrementN.tx(5);

// With overrides:
await counter.increment.tx({
  signer: customSigner,
  origin: "5GrwvaEF...",
  value: 1000n,
  gasLimit: { refTime: 500000n, proofSize: 100000n },
  storageDepositLimit: 1000n,
});
```

### Signer Setup

```typescript
import { DEV_PHRASE, mnemonicToEntropy, entropyToMiniSecret } from "@polkadot-labs/hdkd-helpers";
import { sr25519CreateDerive } from "@polkadot-labs/hdkd";
import { getPolkadotSigner } from "polkadot-api/signer";

const entropy = mnemonicToEntropy(DEV_PHRASE);
const miniSecret = entropyToMiniSecret(entropy);
const derive = sr25519CreateDerive(miniSecret);
const aliceKeyPair = derive("//Alice");
const signer = getPolkadotSigner(aliceKeyPair.publicKey, "Sr25519", aliceKeyPair.sign);
```

### Cleanup

```typescript
cdm.destroy(); // closes WebSocket connection (only if CDM owns it)
```

### Generated Types (.cdm/cdm.d.ts)

`cdm install` generates module augmentation providing full autocomplete:
```typescript
declare module "@dotdm/cdm" {
  interface CdmContracts {
    "@example/counter": {
      methods: {
        getCount: { args: []; response: number };
        increment: { args: []; response: undefined };
      };
    };
  };
}
```

**ABI -> TypeScript type mapping:** `uint8/16/32` -> `number`, `uint64+` -> `bigint`, `address` -> `HexString`, `string` -> `string`, `bool` -> `boolean`, `bytes` -> `Binary`, `bytesN` -> `FixedSizeBinary<N>`, `tuple` -> `{ field: type }`.

### Dependencies

```json
{
  "dependencies": {
    "@dotdm/cdm": "latest",
    "polkadot-api": "^1.23.3",
    "@polkadot-labs/hdkd": "^0.0.26",
    "@polkadot-labs/hdkd-helpers": "^0.0.27"
  }
}
```

Runtime: Bun or Node.js. Package manager: pnpm or bun.
