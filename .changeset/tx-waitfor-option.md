---
"@dotdm/cdm": minor
---

Add `waitFor: "best-block" | "finalized"` option to `TxOpts`.

`contract.method.tx(...)` now accepts a `waitFor` option that controls when
the returned Promise resolves. Defaults to `"finalized"` (existing behavior).
Setting it to `"best-block"` returns as soon as the tx is included in a
block — typically 5-10× faster on chains with slow GRANDPA finality (local
zombienet, dev networks).

Useful for local dev loops where finality guarantees aren't needed and
sub-second tx feedback materially improves UX.

Implementation switches from PAPI's `signAndSubmit` (always waits for
finalization) to `submitAndWatch` from `@polkadot-apps/tx`, which exposes the
lifecycle option. Behavior is unchanged for callers that don't pass `waitFor`.
