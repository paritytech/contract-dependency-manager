import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

export interface CdmJsonContract {
    version: number;
    address: string;
    abi: unknown[];
    metadataCid?: string;
}

export interface CdmJson {
    dependencies: Record<string, number | string>;
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
        test("keeps manifests unchanged", () => {
            const manifest = {
                dependencies: { "@example/counter": "latest" },
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
