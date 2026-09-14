import type { HexString } from "polkadot-api";

export interface MigratedContractVersion {
    address: HexString;
    metadata_uri: string;
}

export interface MigratedContract {
    contract_name: string;
    owner: HexString;
    versions: MigratedContractVersion[];
}

export interface RegistryMigrationSnapshot {
    schema: "cdm.registry.v1";
    exported_at: string;
    chain?: string;
    assethub_url: string;
    registry_address: HexString;
    contract_count: number;
    contracts: MigratedContract[];
}
