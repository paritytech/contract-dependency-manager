# CDM System

**Status**

- **Rust / PVM**: implemented end-to-end (build · deploy · publish metadata · register · install · consume).
- **Foundry / Hardhat**: build invocation lifts cleanly from playground-cli; CDM-side adapter design (cdmPackage source, metadata source, deploy wiring) is open. See [Toolchain matrix](#toolchain-matrix).
- **TypeScript SDK**: migrating from `@dotdm/cdm` to `@parity/product-sdk-contracts` (targets `pallet-revive` directly, not Ink). Old SDK to be deprecated once parity is reached.

## System map

![CDM system map](./assets/cdm-system-map.svg)

A CDM package name is a globally unique identifier resolved by an on-chain registry. Contracts publish `(name → address, name → metadataCid)` on Asset Hub; metadata blobs live on Bulletin (content-addressed, retrievable via IPFS gateway). Consumers install a frozen snapshot of `(ABI, address, version)` to `~/.cdm/`, after which Rust contracts use `cdm::import!()` and TypeScript apps use `@parity/product-sdk-contracts`.

## Toolchain matrix

![Toolchain matrix](./assets/cdm-toolchain-matrix.svg)

All three toolchains produce PolkaVM bytecode (Solidity via `resolc`, Rust via `cargo pvm-contract build`). The Rust path is end-to-end CDM today. The Solidity paths have a working **build** invocation (liftable from playground-cli) but their three CDM-specific concerns are still open:

1. **`cdmPackage` source** — where does the human-readable name live? Candidates: an entry in `cdm.json[contracts]`, a NatSpec `@cdm` tag in source, or a toolchain config field (`foundry.toml`, hardhat config).
2. **Metadata source** — Cargo.toml + git for Rust is automatic. Solidity has no equivalent convention; needs design (probably `package.json` + repo metadata + toolchain config).
3. **Deploy + register adapter** — wrapping the bytecode into the existing `deployBatch` flow, with `publish_latest` payloads, is mechanical once the above two are decided.

## Publish pipeline

![Publish pipeline](./assets/cdm-publish-pipeline.svg)

Three stages:

- **① BUILD** — detect toolchain from workspace markers; invoke its native build; normalize the output into a unified internal shape `{ bytecode, cdmPackage, abi, deps, metadataFields }`. Cargo metadata + `__PVM_CDM` ELF symbol give Rust this for free.
- **② PLAN** — `detect + toposort` produces deployment layers; each contract is dry-run for weight; contracts are greedy-packed into chunks fitting `System.BlockWeights.normal.max_extrinsic`; CREATE2 addresses are pre-computed.
- **③ SUBMIT** — per chunk: first upload metadata blobs to Bulletin (sequential per Bulletin's nonce ordering, returns CIDs), then a single `Utility.batch_all` atomically issues `Revive.instantiate_with_code` and `Registry.publish_latest(name, addr, cid)`. Atomic within a chunk; chunks across are non-atomic by design.

CREATE2 salt:

```
salt = blake2b-256(cdmPackage)
addr = create2_address(deployer, salt, keccak256(bytecode))
```

This makes a contract's address a function of `(deployer, cdmPackage, bytecode)` only — so the same compiled blob deployed by the same address lands at the same on-chain address everywhere. The registry itself is deployed this way under salt `blake2b-256("@cdm/registry")`.

The metadata blob composition is in the right panel of the publish-pipeline diagram. Two non-obvious fields: `publish_block` is set to Asset Hub's head at submit time; `published_at` is the deployer's wall clock at submit time.

## ContractRegistry

![ContractRegistry — state machine, storage, queries](./assets/cdm-registry.svg)

The registry is a `pallet-revive` contract on Asset Hub, CREATE2-deployed under `@cdm/registry`. Address is a compile-time constant in `@dotdm/utils` (`REGISTRY_ADDRESS`) — no `--registry-address` flag is needed.

Key invariants:

- **First-write-wins ownership.** First publisher of a name becomes its owner. Subsequent calls revert unless `caller == info[name].owner`.
- **Monotonic versions.** No overwrite, no delete, no yank. Upgrades publish at `(name, version + 1)`; old versions remain queryable indefinitely.
- **Org prefixes are not reserved.** Anyone can claim `@polkadot/foo` if no one else has. Org-level access control (e.g., OpenGov-owned `@polkadot/*`) is an open design question.

The Storage struct and query surface (`get_address`, `get_metadata_uri`, `get_owner`, `get_version_count`, `get_contract_count`, enumeration via `get_contract_name_at`, plus `_at_version` variants) are in the right pane of the diagram.

## Install pipeline

![Install pipeline](./assets/cdm-install-pipeline.svg)

`cdm install` reads `cdm.json`, resolves a target environment (from `-n <preset>` or the first `targets[]` entry), computes its `targetHash`, then in parallel per library:

1. **Query registry** — `getVersionCount` → `getMetadataUri(@v)` → `getAddress(@v)`.
2. **Fetch metadata** — `GET <ipfs-gateway>/<cid>` → parse JSON → validate ABI shape.
3. **Save to disk** — write `{abi, metadata, info}.json` under `~/.cdm/<targetHash>/contracts/<pkg>/<v>/` and update the `latest` symlink.
4. **Post-install hooks** — TypeScript: `generateContractTypes` writes `.cdm/contracts.d.ts`. Rust: no-op (the `cdm::import!()` proc-macro reads `~/.cdm/` directly at compile time).

Finally `cdm.json.contracts[targetHash][pkg]` is updated with `{ version, address, abi, metadataCid }`. The inlined ABI makes builds reproducible and offline-capable; the pinned version pins against future `latest` drift.

`~/.cdm/` is shared across workspaces — installing `@polkadot/reputation@7` once benefits every project on the machine.

## Consumption

Address resolution happens **at runtime** for Rust contracts (registry call from inside the contract) and **at install time** for TypeScript (baked into `cdm.json.contracts`).

### Rust contract

```rust
cdm::import!("@org/foo");

#[pvm::contract(cdm = "@myorg/forum")]
mod forum {
    use super::*;

    #[pvm::method]
    pub fn call_foo(&mut self) {
        // Resolves @org/foo's address via Registry.get_address at runtime.
        let f = foo::cdm_reference();
        f.do_something().expect("call failed");
    }
}
```

The `cdm::import!()` proc-macro reads `cdm.json` + `~/.cdm/<targetHash>/contracts/<pkg>/<v>/abi.json` at compile time and generates the `foo` module. `cdm_reference()` performs the registry read at runtime.

### TypeScript app

Use `@parity/product-sdk-contracts` (replaces `@dotdm/cdm`):

```ts
import { createChainClient } from "@parity/product-sdk-chain-client";
import { paseo_asset_hub } from "@parity/product-sdk-descriptors/paseo-asset-hub";
import { ContractManager } from "@parity/product-sdk-contracts";
import { SignerManager } from "@parity/product-sdk-signer";
import cdmJson from "./cdm.json";

const client = await createChainClient({
    chains: { assetHub: paseo_asset_hub },
    rpcs:   { assetHub: ["wss://paseo-asset-hub-next-rpc.polkadot.io"] },
});

const signerManager = new SignerManager();
await signerManager.connect();

const manager = ContractManager.fromClient(
    cdmJson, client.raw.assetHub, paseo_asset_hub, { signerManager },
);

const counter = manager.getContract("@org/counter");

// Read (dry-run, no tx)
const { value } = await counter.getCount.query();

// Write (signed tx; uses signerManager's current account, falls back to defaultSigner)
await counter.increment.tx();

// Batchable form (combine with non-contract Asset Hub calls via batchSubmitAndWatch)
const prepared = counter.increment.prepare();
```

Material differences from `@dotdm/cdm`:

- Targets `pallet-revive` directly (not Ink) — wholesale replacement, not an upgrade.
- Consumer owns the chain client; the SDK wraps it (rather than constructing one internally).
- `SignerManager` enables dynamic account switching; static `defaultSigner` is a fallback for queries.
- `.prepare()` enables batching with other Asset Hub extrinsics.
- Named error classes: `ContractNotFoundError`, `ContractSignerMissingError`, `ContractDryRunFailedError`.

Build-time codegen (Node-only) — emits typed module augmentation for `manager.getContract(...)`:

```ts
import { generateContractTypes, resolveContractTypeInputs } from "@parity/product-sdk-contracts/codegen";
import { writeFileSync } from "node:fs";

const resolved = await resolveContractTypeInputs([
    { library: "@org/counter", abiPath: "./target/counter.release.abi.json" },
]);
writeFileSync(".cdm/contracts.d.ts", generateContractTypes(resolved));
```

## Implementation references

**Current CDM (this repo):**

- `src/apps/cli/src/commands/{build,deploy,install/index}.ts`
- `src/apps/cli/src/lib/{install-pipeline,deploy-pipeline}.ts`
- `src/lib/contracts/src/{detection,builder,pipeline,deployer,publisher,store,cdm-json,cdm-local-json}.ts`
- `src/lib/cdm/rust-macros/src/lib.rs` — `cdm::import!()` proc-macro
- `src/contract/src/lib.rs` — ContractRegistry on-chain contract

**New TypeScript SDK (separate repo, replaces `@dotdm/cdm`):**

- `/Users/charleshetterich/code/product-sdk/product-sdk/packages/contracts/src/manager.ts` — `ContractManager`
- `/Users/charleshetterich/code/product-sdk/product-sdk/packages/contracts/src/codegen.ts` — `generateContractTypes`
- `/Users/charleshetterich/code/product-sdk/product-sdk/packages/contracts/README.md` — full API reference

**Solidity build adapters (to lift into `@dotdm/contracts`):**

- `/Users/charleshetterich/code/playground-cli/src/utils/build/detect.ts` — file-based toolchain detection
- `/Users/charleshetterich/code/playground-cli/src/utils/deploy/contracts.ts` — `compileFoundry`, `compileHardhat`, `extractFoundryBytecode`, `extractHardhatBytecode`, `hexToBytes`, `writeTmpBytecode`
