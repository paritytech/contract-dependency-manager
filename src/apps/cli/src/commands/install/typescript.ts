import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { resolve } from "path";
import { readCdmJson } from "@dotdm/contracts";
import { generateContractTypes, generateContractsAugmentation } from "@dotdm/cdm";

/**
 * Ensures the project's tsconfig.json includes the `.cdm/` directory so that
 * TypeScript picks up the generated module augmentation in `.cdm/cdm.d.ts`.
 *
 * Without this, the `CdmContracts` interface stays empty and all contract
 * names resolve to `never` in `getContract()` calls.
 *
 * - Creates a minimal tsconfig.json if one doesn't exist.
 * - Appends `./.cdm/**\/*` to the existing `include` array if not already present.
 * - Normalizes leading `./` when checking for duplicates.
 * - Silently skips if the tsconfig exists but can't be parsed (e.g. has comments/trailing commas).
 */
function ensureTsconfigInclude(artifactsPath: string): void {
    const tsconfigPath = resolve(process.cwd(), "tsconfig.json");
    const cdmInclude = `${artifactsPath.replace(/^\.\//, "").replace(/\/+$/, "")}/**/*`;

    let tsconfig: Record<string, unknown>;
    if (existsSync(tsconfigPath)) {
        try {
            tsconfig = JSON.parse(readFileSync(tsconfigPath, "utf-8"));
        } catch {
            return; // malformed tsconfig, don't touch it
        }
    } else {
        tsconfig = {};
    }

    const include = Array.isArray(tsconfig.include) ? tsconfig.include : [];
    const alreadyHas = include.some(
        (entry: unknown) => typeof entry === "string" && entry.replace(/^\.\//, "") === cdmInclude,
    );

    if (alreadyHas) return;

    include.push(`./${cdmInclude}`);
    tsconfig.include = include;
    writeFileSync(tsconfigPath, JSON.stringify(tsconfig, null, 4) + "\n");
}

/**
 * Post-install hook for TypeScript projects. Runs after all contracts have been
 * fetched and saved to `cdm.json`.
 *
 * Reads the installed contracts from `cdm.json` and generates `.cdm/cdm.d.ts` — a
 * module augmentation that extends the empty `CdmContracts` interface in
 * `@dotdm/cdm` with typed method signatures for each installed contract.
 *
 * Also patches tsconfig.json to include the `.cdm/` directory so the
 * augmentation is visible to the TypeScript compiler.
 */
export async function postInstallTypeScript(): Promise<void> {
    const cdmResult = readCdmJson();
    if (!cdmResult) return;

    const installedContracts = cdmResult.cdmJson.contracts;
    if (!installedContracts) return;
    const artifactsPath = ".cdm";

    const contracts = Object.entries(installedContracts).map(([lib, data]) => ({
        library: lib,
        abi: data.abi as any[],
    }));

    if (contracts.length === 0) return;

    const cdmDir = resolve(process.cwd(), artifactsPath);
    mkdirSync(cdmDir, { recursive: true });
    writeFileSync(resolve(cdmDir, "cdm.d.ts"), generateContractTypes(contracts));
    writeFileSync(resolve(cdmDir, "contracts.d.ts"), generateContractsAugmentation(contracts));

    // Ensure tsconfig.json includes .cdm/ for module augmentation
    ensureTsconfigInclude(artifactsPath);
}
