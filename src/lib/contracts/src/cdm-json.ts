import { blake2b } from "@noble/hashes/blake2.js";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";

export interface CdmJsonTarget {
    "asset-hub": string;
    bulletin: string;
    registry: string;
}

export interface CdmJson {
    targets: Record<string, CdmJsonTarget>;
    dependencies: Record<string, Record<string, number | "latest">>;
}

export function computeTargetHash(assethubUrl: string, ipfsGatewayUrl: string, registryAddress: string): string {
    const input = `${assethubUrl}\n${ipfsGatewayUrl}\n${registryAddress}`;
    const hash = blake2b(new TextEncoder().encode(input), { dkLen: 32 });
    return Buffer.from(hash.slice(0, 8)).toString("hex");
}

export function readCdmJson(startDir?: string): { cdmJson: CdmJson; cdmJsonPath: string } | null {
    let dir = startDir ?? process.cwd();
    while (true) {
        const candidate = resolve(dir, "cdm.json");
        if (existsSync(candidate)) {
            const content = readFileSync(candidate, "utf-8");
            return { cdmJson: JSON.parse(content) as CdmJson, cdmJsonPath: candidate };
        }
        const parent = dirname(dir);
        if (parent === dir) return null;
        dir = parent;
    }
}

export function writeCdmJson(cdmJson: CdmJson, dir?: string): void {
    const target = resolve(dir ?? process.cwd(), "cdm.json");
    writeFileSync(target, JSON.stringify(cdmJson, null, 2) + "\n");
}
