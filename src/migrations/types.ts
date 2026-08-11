import type { HexString } from "polkadot-api";

// ─── v1 snapshot (index-only version histories, pre-versioning registries) ──

export interface MigratedContractVersion {
    address: HexString;
    metadata_uri: string;
}

export interface MigratedContract {
    contract_name: string;
    owner: HexString;
    versions: MigratedContractVersion[];
}

export interface RegistryMigrationSnapshotV1 {
    schema: "cdm.registry.v1";
    exported_at: string;
    chain?: string;
    assethub_url: string;
    registry_address: HexString;
    contract_count: number;
    contracts: MigratedContract[];
}

// ─── v2 snapshot (semver version keys + per-name proxies) ────────────────────

export interface MigratedContractVersionV2 {
    /** Packed u128 semver key (`major<<64|minor<<32|patch`) as a decimal string. */
    versionKey: string;
    target: HexString;
    metadataUri: string;
}

export interface MigratedContractV2 {
    contract_name: string;
    owner: HexString;
    /** The name's per-name proxy; the zero address for legacy histories. */
    proxy: HexString;
    versions: MigratedContractVersionV2[];
}

export interface RegistryMigrationSnapshotV2 {
    schema: "cdm.registry.v2";
    exported_at: string;
    chain?: string;
    assethub_url: string;
    registry_address: HexString;
    contract_count: number;
    contracts: MigratedContractV2[];
}

/** Any readable snapshot — exports produce v2 unless the source registry is v1. */
export type RegistryMigrationSnapshot = RegistryMigrationSnapshotV1 | RegistryMigrationSnapshotV2;

// ─── adminImportContracts wire payload (registry v2 ABI tuple shapes) ────────

export interface ImportContractVersion {
    version_key: bigint;
    target: HexString;
    metadata_uri: string;
}

export interface ImportContract {
    contract_name: string;
    owner: HexString;
    /** Live per-name proxy address, or the zero address for legacy histories. */
    proxy: HexString;
    versions: ImportContractVersion[];
}
