# Add `@parity/cdm-codegen/test` subpath for shared integration-test helpers

**Status:** Design note for the next `@parity/cdm-codegen` release after `cdm test` lands.

## Summary

Every project running `cdm test` reproduces the same three helper files:
dev accounts, `cdm.json` + ContractManager setup, and tx-result assertions.
Ship them once from `@parity/cdm-codegen` under a new `./test` subpath so consumers
import them instead of copy-pasting.

`setupForeignContracts` ships in the same subpath and solves a separate
problem: testing against contracts you don't own (pulled from a live
chain, redeployed locally, version-pinned).

## Proposed exports

Package wiring:

```jsonc
// src/lib/cdm/typescript/package.json
"exports": {
    ".":         { ... },
    "./codegen": { ... },
    "./test":    { "types": "./dist/test.d.ts", "import": "./dist/test.js" }
}
// tsup entry added: src/test.ts (or src/test/index.ts)
// New dep: @parity/product-sdk-keys (for seedToAccount + DEV_PHRASE)
```

API surface:

```ts
// dev accounts
export interface DevAccount {
    name: string;
    h160: `0x${string}`;
    ss58: string;
    signer: PolkadotSigner;
}
export function dev(name: string, path: string): DevAccount;
export const Alice: DevAccount;
export const Bob: DevAccount;
export const Charlie: DevAccount;
export const Dave: DevAccount;
export const Eve: DevAccount;
export const Ferdie: DevAccount;

// cdm.json + ContractManager
interface MakeCdmOptions {
    rootDir?: string;          // default process.cwd()
    signer: PolkadotSigner;
    origin: string;
    assethubUrl?: string;      // else CDM_ASSETHUB_URL env, else local PPN
}
export function makeCdm(opts: MakeCdmOptions): Cdm;
export function makeCdmAs(account: DevAccount, opts?: Omit<MakeCdmOptions, "signer" | "origin">): Cdm;
// (An earlier draft keyed connections off cdm.json "targets" via a targetHash;
// the flat cdm.json shape dropped targets, so the chain is now selected by URL.)

// vitest-agnostic assertions (throw on failure; expect-style without depending on vitest)
export function expectOk(promise: Promise<{ ok: boolean }>, label?: string): Promise<void>;
export function expectRevert(promise: Promise<{ ok: boolean }>, label?: string): Promise<void>;

// foreign contracts
interface SetupForeignContractsOptions {
    from: "paseo" | "polkadot" | "devnet" | "custom";
    assethubUrl?: string;          // required if from === "custom"
    sourceRegistryAddress?: string; // required if from === "custom"
    packages: string[];            // "@org/name:version", ":latest" allowed (warns)
    to?: string;                   // local target, default "local"
    destRegistryAddress?: string;  // else cdm.local.json / ~/.cdm/local-registry, else preset
    signer?: PolkadotSigner;       // default Alice
    cacheDir?: string;             // default ~/.cdm/cache/foreign/
}
interface SetupForeignContractsResult {
    addresses: Record<string, string>;   // pkg → local H160
}
export function setupForeignContracts(opts: SetupForeignContractsOptions): Promise<SetupForeignContractsResult>;
```

Migration is one `import` swap per test file. See "Migration" below.

## `setupForeignContracts` — testing against contracts you don't own

Shaped to drop into vitest's `globalSetup`. Idempotent across re-runs.

```ts
// tests/global-setup.ts
import { setupForeignContracts } from "@parity/cdm-codegen/test";
export default () => setupForeignContracts({
    from: "paseo",
    packages: ["@polkadot/contexts:3", "@polkadot/reputation:5"],
});
```

```ts
// vitest.config.ts
export default defineConfig({ test: { globalSetup: ["./tests/global-setup.ts"] } });
```

### Resolution

For `@polkadot/contexts:3`:

1. Connect to source chain. Resolve via its CDM registry:
   `get_address_at_version("@polkadot/contexts", 3)` → H160.
2. `Revive.AccountInfoOf → PristineCode` → bytecode bytes.
3. Cache at `~/.cdm/cache/foreign/<pkg>/v<v>@<chain>.polkavm`. (The content
   hash can't be part of the lookup key — it's only known after the fetch —
   so hash checking happens at deploy time instead.)
4. If the local registry already has this package at this bytecode hash
   (sha256 of cached vs on-chain bytes), skip.
5. Otherwise redeploy locally and register under the same `@org/pkg` name.

### Why `:version`, not `:atBlock`

CDM's registry tracks per-package versions. `@org/pkg:N` is the natural
primitive — same model as npm/Cargo deps, no chain-state thinking required.
Block pinning stays as an escape hatch for raw EVM contracts not in any
CDM registry, but `:version` is the default.

### Caveats

- **Local version index diverges from source's.** First call publishes the
  pulled bytecode as local version 1 regardless of `:N` on the source.
  Tests should use version-agnostic lookups (`get_address(pkg)` or
  `cdm::import!`'s implicit latest), not numeric version queries. The
  helper's JSDoc spells this out.
- **`:latest` is allowed but discouraged.** Logs a warning; refetches when
  source-chain's version count changes. Use only during development.
- **Recursive deps are explicit.** If reputation imports contexts, list
  both. Auto-resolution from the ABI is future work.

## Migration

1. Add `src/test.ts` to `@parity/cdm-codegen`. Build, publish minor version.
2. Once published, update consumers:
   - `contract-developer-tools/src/tests/helpers/` → delete; switch to
     `import { ... } from "@parity/cdm-codegen/test"` in each test file.
   - `src/templates/shared-counter/tests/` → same. Re-run
     `pnpm embed:templates` so scaffolded projects pick it up.

The `tests/helpers/` files in `contract-developer-tools` carry a
`CANDIDATE FOR @parity/cdm-codegen/test` comment so the lift-and-shift target is
findable when this work happens.

## What stays per-repo

- `vitest.config.ts` (project-specific includes, timeouts).
- Per-contract test files (`<contract>.test.ts`).
- Pre-flight probes — pattern is generic, contents are contract-specific.

## References

- Existing helpers being lifted:
  [`contract-developer-tools/src/tests/helpers/`](file:///Users/reinhard/projects/contract-developer-tools/src/tests/helpers/)
- Existing `@parity/cdm-codegen` package:
  [`src/lib/cdm/typescript/`](../../src/lib/cdm/typescript/)
- `cdm test` command consumers:
  [`src/apps/cli/src/commands/test.ts`](../../src/apps/cli/src/commands/test.ts)
- Bytecode pull primitive:
  `getOnChainCode` in
  [`src/lib/contracts/src/deployer.ts`](../../src/lib/contracts/src/deployer.ts)