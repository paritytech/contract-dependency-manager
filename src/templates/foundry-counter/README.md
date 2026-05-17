# Foundry Counter

This template is a minimal Solidity workspace for compiling PolkaVM-compatible artifacts with the Polkadot Foundry fork.

```bash
cdm build
```

The contracts are intentionally simple and include CDM metadata:

- `CounterA` owns a counter.
- `CounterB` owns a local counter and calls `CounterA` through the generated CDM Solidity import.

`package.json` provides workspace-level metadata. Contract-level descriptions come from NatSpec, and `contracts/CounterA.md` / `contracts/CounterB.md` are published as the per-contract README content.

Use `cdm build` instead of invoking Forge directly; CDM builds dependency layers in order and generates the Solidity imports needed by cross-contract calls.
