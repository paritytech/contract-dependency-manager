---
"@parity/cdm-env": major
"@parity/cdm-builder": major
"@parity/cdm-codegen": minor
"@parity/cdm-utils": patch
"@parity/cdm-cli": minor
---

Upgrade to polkadot-api 3 and the latest product-sdk (contracts 0.11, tx 0.5, chain-client/cloud-storage 0.13, descriptors 0.14, host 0.29). Scaffolded templates now pin the same versions.

Breaking: signers are papi-3 `TxCreator`s. `prepareSigner*` from `@parity/cdm-env` return the new exported `CdmSigner` type (papi's `CommonSignerTxCreator`). `@parity/cdm-builder`'s `deployContracts({ signer, metadataSigner })` and `MetadataPublisher` take `CdmSigner` instead of `PolkadotSigner`, which papi 3 removed. Callers must build signers with `getTxCreator` from `polkadot-api/tx-creator`.

Breaking for `@parity/cdm-codegen`: `Cdm` now runs on product-sdk's `ContractManager` instead of `@polkadot-api/sdk-ink`, which has no papi-3 release. Queries and transactions still resolve at finalized.
- The `inkSdk` getter is removed.
- A new optional `descriptor` option defaults to Paseo Asset Hub.
- `.tx()` now throws product-sdk's `TxDispatchError` when an included transaction fails, where it used to resolve with `ok: false`. It also throws when the pre-submit dry-run reverts.
- Calling a method with the wrong number of arguments now rejects.
- `TxOpts.gasLimit` and `QueryResult.gasRequired` are typed as a papi `Weight` (`{ ref_time, proof_size }`). The previous `gasLimit` shape was never accepted by the SDK.
- `QueryResult` gains an `error` field.

`cdm account map` and `cdm deploy` now map accounts through product-sdk's `ensureContractAccountMapped`, which skips the extrinsic when the account is already mapped.
