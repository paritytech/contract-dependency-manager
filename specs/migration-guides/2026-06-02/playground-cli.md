# Playground CLI CDM Migration Guide

Date: 2026-06-02

Repository to migrate: `/Users/charleshetterich/code/playground-cli`

This guide assumes the CDM flat `cdm.json` PR and the matching `@parity/product-sdk-contracts` PR have been merged and released.

## Current State

`playground-cli` embeds CDM behavior instead of only consuming the public `cdm` binary.

Important current paths:

- `src/commands/contract.ts` implements `playground contract install` and writes old target-hash `cdm.json` data.
- `src/utils/contractManifest.ts` implements a local live address resolver against the CDM registry.
- `src/utils/registry.ts` uses that local resolver before constructing `ContractManager`.
- `src/utils/toolchain.ts` installs `cargo-pvm-contract` from `charles/cdm-integration`.
- `e2e/cli/fixtures/projects/rust-cdm` contains legacy Rust CDM contracts.

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
      "@w3s/playground-registry": "latest"
    }
  },
  "contracts": {
    "b7a87bf51613d89f": {}
  }
}
```

## Migration Target

Move the CLI's CDM manifest handling to the new flat shape:

```json
{
  "registry": "0xf62c2ece29cd8df2e10040ecfa5a894a5c5d9cb0",
  "dependencies": {
    "@w3s/playground-registry": "latest"
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

The registry address can still be resolved from `cdm.json.registry` by product-sdk. Asset Hub, Bulletin, and IPFS gateway endpoints cannot be resolved from `cdm.json` anymore. They must come from CLI flags, `src/config.ts`, or chain presets.

## Package Updates

Update CDM and product-sdk dependencies to the released versions that include:

- flat `CdmJson`
- `ContractManager.fromLive(...)`
- `ContractManager.fromLiveClient(...)`
- `withLiveContractAddresses(...)`
- strict live address resolution with no snapshot fallback
- version-aware live lookup: `"latest"` uses `getAddress`, numeric dependencies use `getAddressAtVersion`

Replace old product-sdk and CDM package versions in `package.json`:

```json
{
  "dependencies": {
    "@dotdm/cdm": "<latest release>",
    "@dotdm/contracts": "<latest release>",
    "@dotdm/env": "<latest release>",
    "@parity/product-sdk-contracts": "<latest release>",
    "@parity/product-sdk-descriptors": "<latest release>"
  }
}
```

Use the actual released versions from the CDM/product-sdk release, not local file overrides.

## Keep The Legacy Contract Toolchain For Now

The CLI's Rust fixture and any legacy user projects still target the old contract language.

Keep `src/utils/toolchain.ts` installing:

```sh
git clone --depth 1 --branch charles/cdm-integration \
  https://github.com/paritytech/cargo-pvm-contract.git "$tmp_dir"
cargo install --force --locked --target "$host_target" \
  --path "$tmp_dir/crates/cargo-pvm-contract"
```

Do not switch the CLI's toolchain installer to current `sm/cdm` unless the fixture projects and expected user projects are migrated to `pvm-contract-sdk`.

## Rewrite `playground contract install`

`src/commands/contract.ts` currently imports target-hash helpers:

```ts
computeTargetHash
resolveTargetRegistryAddress
```

Those should go away.

The install target should be resolved from:

1. explicit flags: `--assethub-url`, `--ipfs-gateway-url`, `--registry-address`
2. `--name <preset>`
3. playground's default config
4. `cdmJson.registry` only for the registry address, not endpoints

The flat install logic should be:

```ts
const cdmJson = readCdmJson(rootDir)?.cdmJson ?? {
  dependencies: {},
  contracts: {}
};

cdmJson.registry = registryAddress;

for (const result of installResults) {
  const request = requests.find((entry) => entry.library === result.library);
  if (!request) continue;

  cdmJson.dependencies[result.library] = request.requestedVersion;
  cdmJson.contracts ??= {};
  cdmJson.contracts[result.library] = {
    version: result.version,
    address: result.address,
    abi: result.abi,
    metadataCid: result.metadataCid
  };
}
```

When no libraries are passed, reinstall from the flat dependency map:

```ts
Object.entries(cdmJson.dependencies).map(([library, version]) => ({
  library,
  requestedVersion: version === "latest" ? "latest" : Number(version)
}));
```

The old `targetHash` argument should be removed from UI status and post-install hooks.

## Post-Install Hooks

Update codegen hooks to read flat contracts:

```ts
const installedContracts = cdmJson.contracts ?? {};

const contracts = Object.entries(installedContracts).map(([library, data]) => ({
  library,
  abi: data.abi
}));
```

Solidity generation should also iterate `cdmJson.contracts`, not `cdmJson.contracts[targetHash]`.

Keep `.cdm/**/*` in `tsconfig.json`. New CDM still writes project-local `.cdm/contracts.d.ts` for product-sdk module augmentation.

## Replace Local Live Resolver

`src/utils/contractManifest.ts` should not hand-write the CDM registry ABI or patch target-hash manifests anymore.

Use product-sdk directly:

```ts
import { ContractManager, type CdmJson } from "@parity/product-sdk-contracts";
import { paseo_asset_hub } from "@parity/product-sdk-descriptors/paseo-asset-hub";
import cdmJson from "../../cdm.json";

const manager = await ContractManager.fromLiveClient(
  cdmJson as CdmJson,
  rawClient,
  paseo_asset_hub,
  {
    libraries: [PLAYGROUND_REGISTRY_CONTRACT],
    defaultOrigin: origin,
    registryOrigin: origin,
    defaultSigner: signer?.signer
  }
);
```

Then `src/utils/registry.ts` can become much smaller:

- For signed writes, call `fromLiveClient(...)` with `defaultSigner`, `defaultOrigin`, and `registryOrigin` set to the signed account.
- For read-only commands, call `fromLiveClient(...)` with one stable mapped read origin.
- Continue to refuse stale snapshots for Playground registry access. Use `fromClient(...)` only if a command explicitly wants snapshot-only behavior.

The product-sdk live resolver is strict. If it cannot read the registry or the package is not registered, it rejects. Do not catch that and silently fall back to `cdm.json.contracts[pkg].address` for normal Playground registry operations.

## Query Origin

The current CLI already knows that registry dry-runs need an origin:

```ts
const REGISTRY_QUERY_ORIGIN_SS58 = "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY";
```

Keep the concept, but centralize it:

- signed calls use the signer address
- read-only calls use a stable mapped read origin
- registry live-resolution calls pass the same value as `registryOrigin`

Avoid separate helpers that choose different origins for CDM install, registry reads, and contract reads.

## Rust Fixture Metadata

The fixture under `e2e/cli/fixtures/projects/rust-cdm` is still legacy Rust. Keep:

```toml
pvm_contract = { git = "https://github.com/paritytech/cargo-pvm-contract", branch = "charles/cdm-integration" }
```

Add `[package.metadata.cdm]` to each deployable fixture crate because latest CDM detection reads Cargo metadata. This is an expected migration step, not a workaround:

```toml
[package.metadata.cdm]
package = "@example/counter"
```

For consumers, keep the legacy path dependency because this fixture uses the old branch's generated `counter::cdm_reference()` flow:

```toml
[dependencies]
counter = { path = "../counter" }
```

Do not replace those fixture path dependencies with current `[package.metadata.cdm].dependencies` unless you also rewrite the fixture source to new `pvm-contract-sdk` and `cdm::import!`.

## Tests To Rewrite

Update tests that assert target-hash behavior:

- `src/commands/contract.test.ts`
- `src/utils/contractManifest.test.ts`
- `src/utils/registry.test.ts`

Delete expectations around:

- `computeTargetHash`
- `targets`
- preserving legacy target keys
- choosing a target with dependencies
- `cdmJson.contracts[targetHash]`

Add expectations around:

- flat dependency reinstall
- `cdmJson.registry` written after install
- no endpoints written to `cdm.json`
- product-sdk `fromLiveClient` called with `registryOrigin`
- live resolver failure is surfaced, not silently downgraded to snapshot

## Verification

Run:

```sh
pnpm install
pnpm build
pnpm test
pnpm format:check
pnpm lint:license
```

Then verify contract commands against a throwaway fixture:

```sh
cd e2e/cli/fixtures/projects/rust-cdm
playground contract install -n paseo @example/counter
playground contract deploy --suri //Alice --registry-address <registry>
```

Adjust the exact command to the test harness. The key checks are:

- `cdm.json` is flat
- `.cdm/contracts.d.ts` is generated
- legacy fixture contracts are still detected because of `[package.metadata.cdm]`
- install/deploy no longer mention target hashes

## Gaps To Discuss

- `playground-cli` has an embedded CDM install pipeline. It must migrate with CDM; simply updating dependencies is not enough.
- The CLI still intentionally installs the legacy contract compiler. That is correct for the current fixture/user support, but it means this repo is not a proof that the new contract SDK path works.
- If future legacy projects need external `cdm::import!`, the current CDM Rust macro/new flat manifest path is not legacy-compatible yet. The fixture uses legacy path dependencies instead, so it does not exercise that gap.
