import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve } from "path";

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

export function readCdmJson(pathOrDir?: string): { cdmJson: CdmJson; cdmJsonPath: string } | null {
    const input = pathOrDir ?? process.cwd();
    // If the input already points to a file, use it directly; otherwise treat as directory
    const candidate = input.endsWith(".json") ? resolve(input) : resolve(input, "cdm.json");
    if (existsSync(candidate)) {
        const content = readFileSync(candidate, "utf-8");
        return { cdmJson: JSON.parse(content) as CdmJson, cdmJsonPath: candidate };
    }
    return null;
}

export function writeCdmJson(cdmJson: CdmJson, dir?: string): void {
    const target = resolve(dir ?? process.cwd(), "cdm.json");
    writeFileSync(target, JSON.stringify(cdmJson, null, 2) + "\n");
}
