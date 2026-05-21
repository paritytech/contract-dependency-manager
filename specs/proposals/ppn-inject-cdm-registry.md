# Pre-inject CDM `ContractRegistry` into PPN genesis

**Status:** Proposal, to be filed as an issue against `paritytech/product-preview-net`.

## Summary

Add the CDM `ContractRegistry` to Asset Hub's genesis state, at the canonical
`REGISTRY_ADDRESS` that CDM uses on Paseo and Polkadot. Same mechanism PPN
already uses to inject the 26 DotNS contracts — just one more entry.

## Proposed change

Extend PPN's chain-spec generator (the path that prints
"Injecting DotNS genesis contracts" during `make generate`) to also inject
the cdm `ContractRegistry`:

- **Address:** `0xae344f7f0f91d3a2176032af2990abcc7606c7d4`
  (from `@dotdm/utils/constants.ts:REGISTRY_ADDRESS`).
- **Bytecode:** `contract-registry.release.polkavm`, published as a release
  asset on `paritytech/contract-dependency-manager` once CDM ships the
  CI-built artifact (currently builds at install time; see "Dependency on
  CDM" below).
- **Storage:** empty. First `publish_latest` call from CDM tooling will set
  Alice (or whichever signer) as owner of each registered package name —
  same as on a fresh testnet.

## User-facing effect

```bash
make start-network          # PPN boots with ContractRegistry at REGISTRY_ADDRESS
cdm test                    # registry present → no bootstrap step → straight to deploy + tests
```

PPN matches the public `previewnet.substrate.dev` deployment: contracts find
the registry at the same address, locally and remotely.

## Dependency on CDM

This proposal depends on CDM shipping a stable, byte-deterministic
`contract-registry.release.polkavm` as a release asset. CDM builds the
artifact at install time today (`install.sh` clones the cdm repo and
`cargo pvm-contract build`s it into `~/.cdm/share/`); moving that build into
the cdm CI release workflow is a CDM-internal change tracked separately.
Until that's stable, PPN has no canonical artifact to pull.

## Required coordination

- Injected bytecode must match the `REGISTRY_ADDRESS` constant in
  `@dotdm/utils`. If the registry source changes, CDM and PPN release in
  lockstep.
- `previewnet.substrate.dev` operators already deploy this contract on the
  public testnet. This proposal adds the local-PPN side so the two match.

## Future: arbitrary contract injection

The same mechanism generalizes to "inject any contract from a live chain at
genesis," which is the long-term answer to "I want to test against
`@someorg/foo` that I don't own":

```yaml
# in PPN config (future)
genesis-contracts:
  - source: cdm-release
    package: "@cdm/registry"
    address: 0xae34...
  - source: paseo-asset-hub
    package: "@polkadot/contexts:3"   # CDM-registry-versioned
  - source: file
    path: ./fixtures/my-mock.polkavm
    address: 0x1234...
```

For CDM-registered contracts, `@org/pkg:N` is the natural primitive
(`get_address_at_version` resolves it). PPN would pull `PristineCode` for
the resolved address and inject. Block-pinning could stay as a fallback for
non-CDM EVM contracts. Separate proposal; ship the registry-only case
first.

## References

- CDM `REGISTRY_ADDRESS` constant: [`src/lib/utils/src/constants.ts`](../../src/lib/utils/src/constants.ts)
- CDM registry source: [`src/contract/src/lib.rs`](../../src/contract/src/lib.rs)
- CDM auto-bootstrap detection: [`src/apps/cli/src/commands/deploy.ts`](../../src/apps/cli/src/commands/deploy.ts) (`checkRegistryOnChain`)
- CDM bytecode pull from a live chain: [`src/lib/contracts/src/deployer.ts`](../../src/lib/contracts/src/deployer.ts) (`getOnChainCode`)
- PPN's existing genesis-injection path: the "Injecting DotNS genesis
  contracts" stage of `make generate`.