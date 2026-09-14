/**
 * Browser-safe subpath exporting contract ABIs only.
 *
 * Importing from `@parity/cdm-builder/abi` instead of `@parity/cdm-builder` avoids
 * pulling the Node-only pipeline/deployer surface (fs, child_process, path,
 * etc.) into frontend bundles.
 */
export { CONTRACTS_REGISTRY_ABI, CONTRACTS_REGISTRY_PROXY_ABI } from "./abi/registry";
export { CREATE3_FACTORY_ABI } from "./abi/create3-factory";
