/**
 * Browser-safe subpath exporting contract ABIs only.
 *
 * Importing from `@parity/cdm-builder/abi` instead of `@parity/cdm-builder` avoids
 * pulling the Node-only pipeline/deployer surface (fs, child_process, path,
 * etc.) into frontend bundles.
 */
export { CONTRACTS_REGISTRY_ABI } from "./abi/registry";
export { type QueryResult, unwrapOption, unwrapQueryOption } from "./query";
