import { describe, expect, test } from "vitest";
import {
    legacyContractToImport,
    snapshotToImportContracts,
    versionedContractToImport,
    ZERO_ADDRESS,
} from "../registry";
import type {
    MigratedContract,
    MigratedContractV2,
    RegistryMigrationSnapshotV1,
    RegistryMigrationSnapshotV2,
} from "../types";

const KEY_0_0_1 = 1n;
const KEY_0_0_2 = 2n;
const KEY_1_2_3 = (1n << 64n) | (2n << 32n) | 3n;

const legacyContract: MigratedContract = {
    contract_name: "@cdm/alpha",
    owner: "0x1111111111111111111111111111111111111111",
    versions: [
        { address: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", metadata_uri: "ipfs://one" },
        { address: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", metadata_uri: "ipfs://two" },
    ],
};

const versionedContract: MigratedContractV2 = {
    contract_name: "@cdm/beta",
    owner: "0x2222222222222222222222222222222222222222",
    proxy: "0x3333333333333333333333333333333333333333",
    versions: [
        {
            versionKey: KEY_1_2_3.toString(),
            target: "0xcccccccccccccccccccccccccccccccccccccccc",
            metadataUri: "ipfs://three",
        },
    ],
};

function snapshotBase() {
    return {
        exported_at: "2026-08-11T00:00:00.000Z",
        assethub_url: "ws://127.0.0.1:10020",
        registry_address: "0x4444444444444444444444444444444444444444",
    } as const;
}

describe("legacyContractToImport", () => {
    test("derives keys 0.0.(index + 1) and a zero proxy", () => {
        const imported = legacyContractToImport(legacyContract);
        expect(imported).toEqual({
            contract_name: "@cdm/alpha",
            owner: "0x1111111111111111111111111111111111111111",
            proxy: ZERO_ADDRESS,
            versions: [
                {
                    version_key: KEY_0_0_1,
                    target: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                    metadata_uri: "ipfs://one",
                },
                {
                    version_key: KEY_0_0_2,
                    target: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
                    metadata_uri: "ipfs://two",
                },
            ],
        });
        // Keys must be strictly increasing — adminImportContracts rejects
        // anything else with VersionNotMonotonic.
        const keys = imported.versions.map((version) => version.version_key);
        for (let i = 1; i < keys.length; i++) {
            expect(keys[i - 1] < keys[i]).toBe(true);
        }
    });
});

describe("versionedContractToImport", () => {
    test("passes keys and proxy through verbatim, reviving bigints", () => {
        expect(versionedContractToImport(versionedContract)).toEqual({
            contract_name: "@cdm/beta",
            owner: "0x2222222222222222222222222222222222222222",
            proxy: "0x3333333333333333333333333333333333333333",
            versions: [
                {
                    version_key: KEY_1_2_3,
                    target: "0xcccccccccccccccccccccccccccccccccccccccc",
                    metadata_uri: "ipfs://three",
                },
            ],
        });
    });
});

describe("snapshotToImportContracts", () => {
    test("transforms v1 snapshots via the legacy key derivation", () => {
        const snapshot: RegistryMigrationSnapshotV1 = {
            schema: "cdm.registry.v1",
            ...snapshotBase(),
            contract_count: 1,
            contracts: [legacyContract],
        };
        expect(snapshotToImportContracts(snapshot)).toEqual([
            legacyContractToImport(legacyContract),
        ]);
    });

    test("transforms v2 snapshots verbatim", () => {
        const snapshot: RegistryMigrationSnapshotV2 = {
            schema: "cdm.registry.v2",
            ...snapshotBase(),
            contract_count: 1,
            contracts: [versionedContract],
        };
        expect(snapshotToImportContracts(snapshot)).toEqual([
            versionedContractToImport(versionedContract),
        ]);
    });
});
