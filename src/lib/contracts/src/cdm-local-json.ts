import { readFileSync, existsSync, writeFileSync } from "fs";
import { resolve } from "path";

export interface CdmLocalJson {
    features?: string[];
    /**
     * H160 of the local-chain ContractRegistry deployment. Written by
     * `cdm deploy --bootstrap` against `-n local` so tooling
     * (e.g. `setupForeignContracts`) can locate it without per-project
     * config. Per-machine because the actual deploy address depends on
     * the local toolchain's bytecode and the deploying signer.
     */
    localRegistry?: `0x${string}`;
}

export function readCdmLocalJson(
    dir: string = process.cwd(),
): { cdmLocalJson: CdmLocalJson; cdmLocalJsonPath: string } | null {
    const candidate = resolve(dir, "cdm.local.json");
    if (!existsSync(candidate)) return null;

    let raw: unknown;
    try {
        raw = JSON.parse(readFileSync(candidate, "utf-8"));
    } catch (err) {
        throw new Error(`Invalid JSON in ${candidate}: ${(err as Error).message}`);
    }

    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
        throw new Error(`${candidate}: expected an object at the top level`);
    }

    const r = raw as Record<string, unknown>;
    const out: CdmLocalJson = {};

    if (r.features !== undefined) {
        if (!Array.isArray(r.features) || !r.features.every((f) => typeof f === "string")) {
            throw new Error(`${candidate}: "features" must be an array of strings`);
        }
        out.features = r.features as string[];
    }

    if (r.localRegistry !== undefined) {
        if (typeof r.localRegistry !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(r.localRegistry)) {
            throw new Error(
                `${candidate}: "localRegistry" must be a 0x-prefixed 20-byte hex address`,
            );
        }
        out.localRegistry = r.localRegistry as `0x${string}`;
    }

    return { cdmLocalJson: out, cdmLocalJsonPath: candidate };
}

/**
 * Merge a partial update into cdm.local.json, creating the file if absent.
 * Preserves any existing fields not present in `update`.
 */
export function writeCdmLocalJson(dir: string, update: Partial<CdmLocalJson>): string {
    const path = resolve(dir, "cdm.local.json");
    const existing = readCdmLocalJson(dir)?.cdmLocalJson ?? {};
    const merged: CdmLocalJson = { ...existing, ...update };
    writeFileSync(path, `${JSON.stringify(merged, null, 4)}\n`);
    return path;
}

export function resolveLocalRegistry(dir?: string): `0x${string}` | undefined {
    return readCdmLocalJson(dir)?.cdmLocalJson.localRegistry;
}

/**
 * Resolve the effective --features value. CLI flag fully replaces the file.
 * Returns a comma-separated string (cargo's format), or undefined if neither
 * source provided features.
 */
export function resolveFeatures(cliFeatures: string | undefined, dir?: string): string | undefined {
    if (cliFeatures !== undefined) return cliFeatures;
    const local = readCdmLocalJson(dir);
    const features = local?.cdmLocalJson.features;
    if (features && features.length > 0) return features.join(",");
    return undefined;
}
