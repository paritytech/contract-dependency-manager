# CREATE3 factory

Deploys contracts at addresses that are a pure function of **(factory address, salt)** — independent of the target's bytecode AND its constructor input. Under pallet-revive, plain CREATE2 commits to both (`address = f(deployer, keccak(code ++ input), salt)`), so a stable address like the CDM registry proxy would otherwise move whenever its bytecode or constructor argument changed.

## The scheme

Two contracts compose two derivations:

```
child  = create2(factory, childCodeHash, salt)   # fixed, committed child blob; no constructor input
target = create1(child, 1)                       # code-blind: commits only to the child's address
       = f(factory, salt)
```

- **factory** (`factory/src/main.rs`) — owner-gated `deploy(salt, codeHash, input)`: CREATE2s one child per salt, then has the child CREATE1 the target from pre-uploaded code. `predict(salt)` returns the same derivation as a view.
- **child** (`child/src/main.rs`) — performs the single CREATE1 and stays on-chain forever, permanently burning its salt (revive rejects instantiation over an existing contract).

Deploys go through the pallet's *deploy-by-code-hash* path, so **every blob must be pre-uploaded with `Revive.upload_code` first** — the child blob before the factory can deploy anything, and any target blob (e.g. the registry proxy) before `factory.deploy` references its hash.

## The frozen-artifact rule

`artifacts/create3-factory.polkavm` and `artifacts/create3-child.polkavm` are **frozen, committed blobs**, hash-pinned by `artifacts/manifest.json` (keccak-256, the pallet-revive code hash):

- the **child blob's hash** feeds the create2 step — a changed child moves every future salt's address;
- the **factory blob's bytes** (plus the child hash constructor argument and the fixed `CREATE3_FACTORY_PACKAGE` salt) pin the factory's own CREATE2 address — a changed factory blob is a different factory, and every address it derives moves with it.

Never rebuild or replace them casually. The TS loaders (`@parity/cdm-builder`'s `create3.ts`) verify blob bytes against the manifest on every load and throw on mismatch; `CREATE3_CHILD_CODE_HASH` / `CREATE3_FACTORY_CODE_HASH` mirror the manifest as embedded constants. Deliberately shipping a new generation means bumping `CREATE3_FACTORY_PACKAGE` in `@parity/cdm-utils` and accepting a brand-new address universe.

## Per-network bootstrap

Performed automatically (and idempotently) by `pnpm deploy:registry` / `cdm deploy --bootstrap`:

1. `Revive.upload_code(child blob)` — skipped if the code hash already exists.
2. CREATE2-deploy the committed factory blob from the operator's EOA with the committed child code hash as its single constructor argument and salt `CREATE3_FACTORY_PACKAGE` — skipped if the factory address already has code. Same EOA ⇒ same factory address on every network ⇒ same CREATE3 addresses everywhere.
3. From then on: `upload_code(target blob)` + `factory.deploy(salt, codeHash, ctorInput)` for anything that needs a bytecode-independent stable address.

Deploys are owner-gated (the factory's deployer): a CREATE3 address does not commit to code, so whoever may consume a salt decides what lands at it — gating keeps the salt namespace ours. The offline TS mirror of the address math lives in `src/lib/contracts/src/create3.ts` (`predictCreate3Address`), validated end-to-end against the on-chain `predict` in `src/lib/contracts/tests/e2e/create3.e2e.test.ts`.
