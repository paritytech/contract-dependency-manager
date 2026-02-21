import { homedir } from "os";
import { resolve } from "path";
import { mkdirSync, writeFileSync, symlinkSync, unlinkSync } from "fs";

export function getCdmRoot(): string {
    return resolve(homedir(), ".cdm");
}

export function getContractDir(chain: string, library: string, version: number): string {
    return resolve(getCdmRoot(), chain, "contracts", library, String(version));
}

export interface SaveContractOptions {
    chain: string;
    library: string;
    version: number;
    abi: unknown[];
    metadata: unknown;
    address: string;
    metadataCid: string;
}

export function saveContract(opts: SaveContractOptions): string {
    const dir = getContractDir(opts.chain, opts.library, opts.version);
    mkdirSync(dir, { recursive: true });

    writeFileSync(resolve(dir, "abi.json"), JSON.stringify(opts.abi, null, 2));
    writeFileSync(resolve(dir, "metadata.json"), JSON.stringify(opts.metadata, null, 2));
    writeFileSync(
        resolve(dir, "info.json"),
        JSON.stringify(
            {
                name: opts.library,
                chain: opts.chain,
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
