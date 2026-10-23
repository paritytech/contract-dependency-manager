/**
 * Errors that `Cdm` contract handles throw, re-exported from the product-sdk
 * module instance cdm-codegen runs on so `instanceof` works for consumers (a
 * separately resolved copy of the package would define different classes).
 *
 * `.tx()` rejects with a `ContractError` subclass when it refuses to submit
 * (dry-run failed or reverted, invalid origin), and with a `TxError` subclass
 * from `@parity/product-sdk-tx` when submission or dispatch fails. `.query()`
 * throws `ContractInvalidOriginError` for a non-SS58 origin.
 */
export {
    ContractError,
    ContractDryRunFailedError,
    ContractInvalidOriginError,
    ContractRevertedError,
    ContractSignerMissingError,
} from "@parity/product-sdk-contracts";
export {
    TxError,
    TxDispatchError,
    TxSigningRejectedError,
    TxTimeoutError,
    TxValidityError,
} from "@parity/product-sdk-tx";
