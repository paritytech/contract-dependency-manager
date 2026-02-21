import { homedir } from "os";
import { resolve } from "path";
import { mkdirSync, writeFileSync, symlinkSync, unlinkSync } from "fs";

export function getCdmRoot(): string {
    return resolve(homedir(), ".cdm");
}

export function getContractDir(targetHash: string, library: string, version: number): string {
    return resolve(getCdmRoot(), targetHash, "contracts", library, String(version));
}

export interface SaveContractOptions {
    targetHash: string;
    library: string;
    version: number;
    abi: unknown[];
    metadata: unknown;
    address: string;
    metadataCid: string;
}

export function saveContract(opts: SaveContractOptions): string {
    const dir = getContractDir(opts.targetHash, opts.library, opts.version);
    mkdirSync(dir, { recursive: true });

    writeFileSync(resolve(dir, "abi.json"), JSON.stringify(opts.abi, null, 2));
    writeFileSync(resolve(dir, "metadata.json"), JSON.stringify(opts.metadata, null, 2));
    writeFileSync(
        resolve(dir, "info.json"),
        JSON.stringify(
            {
                name: opts.library,
                targetHash: opts.targetHash,
                version: opts.version,
                address: opts.address,
                metadataCid: opts.metadataCid,
            },
            null,
            2,
        ),
    );

    // Update latest symlink
    const parentDir = resolve(dir, "..");
    const latestLink = resolve(parentDir, "latest");
    try {
        unlinkSync(latestLink);
    } catch {}
    symlinkSync(String(opts.version), latestLink);

    return dir;
}

export function resolveContractAbiPath(targetHash: string, library: string, version: number): string {
    return resolve(getContractDir(targetHash, library, version), "abi.json");
}
