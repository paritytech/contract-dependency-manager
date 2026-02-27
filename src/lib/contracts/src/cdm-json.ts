import { blake2b } from "@noble/hashes/blake2.js";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";

export interface CdmJsonTarget {
    "asset-hub": string;
    bulletin: string;
    registry: string;
}

export interface CdmJsonContract {
    version: number;
    address: string;
    abi: unknown[];
    metadataCid: string;
}

export interface CdmJson {
    targets: Record<string, CdmJsonTarget>;
    dependencies: Record<string, Record<string, number | string>>;
    contracts?: Record<string, Record<string, CdmJsonContract>>;
}

export function computeTargetHash(
    assethubUrl: string,
    ipfsGatewayUrl: string,
    registryAddress: string,
): string {
    const input = `${assethubUrl}\n${ipfsGatewayUrl}\n${registryAddress}`;
    const hash = blake2b(new TextEncoder().encode(input), { dkLen: 32 });
    return Buffer.from(hash.slice(0, 8)).toString("hex");
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
