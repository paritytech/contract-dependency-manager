import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { contractToImport, readRegistrySnapshot } from "../registry";
import type { MigratedContract, RegistryMigrationSnapshot } from "../types";

const KEY_1_2_3 = (1n << 64n) | (2n << 32n) | 3n;
const KEY_1_3_0 = (1n << 64n) | (3n << 32n);

const contract: MigratedContract = {
    contract_name: "@cdm/beta",
    owner: "0x2222222222222222222222222222222222222222",
    proxy: "0x3333333333333333333333333333333333333333",
    versions: [
        {
            versionKey: KEY_1_2_3.toString(),
            target: "0xcccccccccccccccccccccccccccccccccccccccc",
            metadataUri: "ipfs://three",
        },
        {
            versionKey: KEY_1_3_0.toString(),
            target: "0xdddddddddddddddddddddddddddddddddddddddd",
            metadataUri: "ipfs://four",
        },
    ],
};

function makeSnapshot(contracts: MigratedContract[]): RegistryMigrationSnapshot {
    return {
        schema: "cdm.registry.v2",
        exported_at: "2026-08-11T00:00:00.000Z",
        assethub_url: "ws://127.0.0.1:10020",
        registry_address: "0x4444444444444444444444444444444444444444",
        contract_count: contracts.length,
        contracts,
    };
}

describe("contractToImport", () => {
    test("passes keys and proxy through verbatim, reviving bigints", () => {
        const imported = contractToImport(contract);
        expect(imported).toEqual({
            contract_name: "@cdm/beta",
            owner: "0x2222222222222222222222222222222222222222",
            proxy: "0x3333333333333333333333333333333333333333",
            versions: [
                {
                    version_key: KEY_1_2_3,
                    target: "0xcccccccccccccccccccccccccccccccccccccccc",
                    metadata_uri: "ipfs://three",
                },
                {
                    version_key: KEY_1_3_0,
                    target: "0xdddddddddddddddddddddddddddddddddddddddd",
                    metadata_uri: "ipfs://four",
                },
            ],
        });
    });

    test("rejects entries without a per-name proxy", () => {
        const proxyless = {
            ...contract,
            proxy: "0x0000000000000000000000000000000000000000" as const,
        };
        expect(() => contractToImport(proxyless)).toThrow(
            "Snapshot entry for @cdm/beta has no per-name proxy",
        );
    });
});

describe("readRegistrySnapshot", () => {
    let dir: string | undefined;

    afterEach(() => {
        if (dir) rmSync(dir, { recursive: true, force: true });
        dir = undefined;
    });

    function writeSnapshotFile(value: unknown): string {
        dir = mkdtempSync(join(tmpdir(), "cdm-migrations-"));
        const path = join(dir, "snapshot.json");
        writeFileSync(path, JSON.stringify(value, null, 2));
        return path;
    }

    test("round-trips a written snapshot", async () => {
        const snapshot = makeSnapshot([contract]);
        await expect(readRegistrySnapshot(writeSnapshotFile(snapshot))).resolves.toEqual(snapshot);
    });

    test("rejects other schemas", async () => {
        const path = writeSnapshotFile({ ...makeSnapshot([]), schema: "cdm.registry.v1" });
        await expect(readRegistrySnapshot(path)).rejects.toThrow(
            "Unsupported registry migration schema: cdm.registry.v1",
        );
    });
});
