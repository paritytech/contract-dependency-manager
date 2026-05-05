import { readFileSync, existsSync } from "fs";
import { resolve } from "path";

export interface CdmLocalJson {
    features?: string[];
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

    return { cdmLocalJson: out, cdmLocalJsonPath: candidate };
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
