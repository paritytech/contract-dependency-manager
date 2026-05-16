# Foundry Counter

This template is a minimal Solidity workspace for compiling PolkaVM-compatible artifacts with the Polkadot Foundry fork.

```bash
forge build --resolc
```

The contracts are intentionally simple:

- `CounterA` owns a counter.
- `CounterB` owns a local counter and can call `CounterA` after `setCounterA(address)`.

CDM deployment and metadata registration for Solidity contracts will be wired into a later pass.
