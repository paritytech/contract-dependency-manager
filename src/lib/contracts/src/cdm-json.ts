import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve } from "path";

/**
 * A resolved dependency snapshot in `cdm.json`.
 *
 * `version` spans two registry eras:
 * - string — a semver version (`"1.2.3"`) published to the v2 factory
 *   registry; `address` is the name's STABLE address (the per-name proxy for
 *   proxied names).
 * - number — a v1-era registry version INDEX. Only used as an artifact path
 *   segment; `address` is that version's standalone contract.
 */
export interface CdmJsonContract {
    version: string | number;
    address: string;
    abi: unknown[];
    metadataCid?: string;
}

/**
 * Flat project manifest.
 *
 * `dependencies` values are version REQUESTS, also spanning both eras:
 * - string — `"latest"`, an exact semver (`"1.2.3"`), or an npm-style range
 *   (`"^1.2.3"`) resolved against v2 semver version keys.
 * - number — a v1-era legacy version index, resolved positionally.
 */
export interface CdmJson {
    dependencies: Record<string, string | number>;
    contracts?: Record<string, CdmJsonContract>;
    registry?: string;
}

export function normalizeCdmJson(value: unknown): CdmJson {
    return value as CdmJson;
}

export function readCdmJson(pathOrDir?: string): { cdmJson: CdmJson; cdmJsonPath: string } | null {
    const input = pathOrDir ?? process.cwd();
    // If the input already points to a file, use it directly; otherwise treat as directory
    const candidate = input.endsWith(".json") ? resolve(input) : resolve(input, "cdm.json");
    if (existsSync(candidate)) {
        const content = readFileSync(candidate, "utf-8");
        return { cdmJson: normalizeCdmJson(JSON.parse(content)), cdmJsonPath: candidate };
    }
    return null;
}

export function writeCdmJson(cdmJson: CdmJson, dir?: string): void {
    const target = resolve(dir ?? process.cwd(), "cdm.json");
    writeFileSync(target, JSON.stringify(cdmJson, null, 2) + "\n");
}

if (import.meta.vitest) {
    const { describe, expect, test } = import.meta.vitest;

    describe("normalizeCdmJson", () => {
        test("keeps semver-era manifests unchanged", () => {
            const manifest = {
                dependencies: { "@example/counter": "^1.2.0", "@example/other": "latest" },
                contracts: {
                    "@example/counter": {
                        version: "1.2.3",
                        address: "0x0000000000000000000000000000000000000001",
                        abi: [],
                    },
                },
                registry: "0x0000000000000000000000000000000000000002",
            };

            expect(normalizeCdmJson(manifest)).toEqual(manifest);
        });

        test("keeps legacy numeric-index manifests unchanged", () => {
            const manifest = {
                dependencies: { "@example/counter": 1 },
                contracts: {
                    "@example/counter": {
                        version: 1,
                        address: "0x0000000000000000000000000000000000000001",
                        abi: [],
                    },
                },
                registry: "0x0000000000000000000000000000000000000002",
            };

            expect(normalizeCdmJson(manifest)).toEqual(manifest);
        });
    });
}
