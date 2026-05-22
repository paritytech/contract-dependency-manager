/**
 * Browser-safe subpath exporting contract ABIs only.
 *
 * Importing from `@dotdm/contracts/abi` instead of `@dotdm/contracts` avoids
 * pulling the Node-only pipeline/deployer surface (fs, child_process, path,
 * etc.) into frontend bundles.
 */
export { CONTRACTS_REGISTRY_ABI } from "./abi/registry";
export { type QueryResult, unwrapOption, unwrapQueryOption } from "./query";
