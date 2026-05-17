# Foundry Counter

This template is a minimal Solidity workspace for compiling PolkaVM-compatible artifacts with the Polkadot Foundry fork.

```bash
forge build --resolc
```

The contracts are intentionally simple and include CDM metadata:

- `CounterA` owns a counter.
- `CounterB` owns a local counter and calls `CounterA` through the generated CDM Solidity import.

`package.json` provides workspace-level metadata. Contract-level descriptions come from NatSpec, and `contracts/CounterA.md` / `contracts/CounterB.md` are published as the per-contract README content.
