import { resolve } from "path";
import { mkdirSync, writeFileSync, symlinkSync, unlinkSync } from "fs";

export function getCdmRoot(artifactsDir?: string): string {
    return (
        artifactsDir ??
        process.env.CDM_ARTIFACTS_DIR ??
        process.env.CDM_ROOT ??
        resolve(process.cwd(), ".cdm")
    );
}

/**
 * Directory a contract version's artifacts live in:
 * `<root>/contracts/<library>/<semver>`.
 */
export function getContractDir(library: string, version: string, artifactsDir?: string): string {
    return resolve(getCdmRoot(artifactsDir), "contracts", library, version);
}

export interface SaveContractOptions {
    artifactsDir?: string;
    library: string;
    /** The installed semver — used verbatim as the directory segment. */
    version: string;
    abi: unknown[];
    metadata: unknown;
    address: string;
    metadataCid: string;
}

export function saveContract(opts: SaveContractOptions): string {
    const dir = getContractDir(opts.library, opts.version, opts.artifactsDir);
    mkdirSync(dir, { recursive: true });

    writeFileSync(resolve(dir, "abi.json"), JSON.stringify(opts.abi, null, 2));
    writeFileSync(resolve(dir, "metadata.json"), JSON.stringify(opts.metadata, null, 2));
    writeFileSync(
        resolve(dir, "info.json"),
        JSON.stringify(
            {
                name: opts.library,
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
    symlinkSync(opts.version, latestLink);

    return dir;
}

export function resolveContractAbiPath(
    library: string,
    version: string,
    artifactsDir?: string,
): string {
    return resolve(getContractDir(library, version, artifactsDir), "abi.json");
}
