import type { HexString } from "polkadot-api";

// ─── registry snapshot (semver version keys + per-name proxies) ──────────────

export interface MigratedContractVersion {
    /** Packed u128 semver key (`major<<64|minor<<32|patch`) as a decimal string. */
    versionKey: string;
    target: HexString;
    metadataUri: string;
}

export interface MigratedContract {
    contract_name: string;
    owner: HexString;
    /** The name's per-name proxy — every registered name has one. */
    proxy: HexString;
    versions: MigratedContractVersion[];
}

export interface RegistryMigrationSnapshot {
    schema: "cdm.registry.v2";
    exported_at: string;
    chain?: string;
    assethub_url: string;
    registry_address: HexString;
    contract_count: number;
    contracts: MigratedContract[];
}

// ─── adminImportContracts wire payload (registry ABI tuple shapes) ───────────

export interface ImportContractVersion {
    version_key: bigint;
    target: HexString;
    metadata_uri: string;
}

export interface ImportContract {
    contract_name: string;
    owner: HexString;
    /** The name's live per-name proxy address. */
    proxy: HexString;
    versions: ImportContractVersion[];
}
