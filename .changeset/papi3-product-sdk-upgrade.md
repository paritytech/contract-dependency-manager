---
"@parity/cdm-env": major
"@parity/cdm-builder": major
"@parity/cdm-codegen": minor
"@parity/cdm-utils": patch
"@parity/cdm-cli": minor
---

Upgrade to polkadot-api 3 and the latest product-sdk (contracts 0.11, tx 0.5, chain-client/cloud-storage 0.13, descriptors 0.14, host 0.29). Scaffolded templates now pin the same versions.

Breaking: signers are papi-3 `TxCreator`s. `prepareSigner*` from `@parity/cdm-env` return the new exported `CdmSigner` type (papi's `CommonSignerTxCreator`). `@parity/cdm-builder`'s `deployContracts({ signer, metadataSigner })` and `MetadataPublisher` take `CdmSigner` instead of `PolkadotSigner`, which papi 3 removed. Any `CommonSignerTxCreator` works, for example one from `getTxCreator` in `polkadot-api/tx-creator` or from `@parity/product-sdk-signer`.

Breaking for `@parity/cdm-codegen`: `Cdm` now runs on product-sdk's `ContractManager` instead of `@polkadot-api/sdk-ink`, which has no papi-3 release. Queries and successful transactions still resolve at finalized.
- The `inkSdk` getter is removed. A new optional `descriptor` option defaults to Paseo Asset Hub.
- When no origin is set explicitly (per call, `defaultOrigin` or `setDefaults({ origin })`), queries and dry-runs use the address of the signer in effect. They used to always use Alice. A `Cdm` configured with only `defaultSigner` now queries as that signer.
- `.tx()` throws instead of resolving with `ok: false`. Dispatch failures are detected at best-block inclusion.
  - Before submission, a failed or reverted dry-run throws `ContractDryRunFailedError` or `ContractRevertedError`.
  - After submission, failures throw product-sdk-tx's `TxDispatchError`, `TxValidityError` or `TxTimeoutError`. The timeout is 300 s.
  - The `ContractError` and `TxError` classes are re-exported from `@parity/cdm-codegen`, so `instanceof` checks use the same module instance.
- Query results follow product-sdk's decoding, which matches the generated types.
  - A single named output is the bare value; it was `{ name: value }`.
  - Several unnamed outputs are `{ _0, _1, … }`; they were an array.
  - `bytes`/`bytesN` values are hex strings; they were papi `Binary`.
- Generated types map Solidity `bytes` to `HexString`; it was `Uint8Array`, which the encoder never accepted. Re-run `cdm install` to regenerate `.cdm` types.
- Calling a method with the wrong number of arguments now rejects. A trailing `undefined` options argument is still allowed.
- `TxOpts.gasLimit` and `QueryResult.gasRequired` are typed as a papi `Weight` (`{ ref_time, proof_size }`). The previous `gasLimit` shape was never accepted by the SDK. `QueryResult` gains an `error` field.

`cdm account map` and `cdm deploy` now map accounts through product-sdk's `ensureContractAccountMapped`, which skips the extrinsic when the account is already mapped.
