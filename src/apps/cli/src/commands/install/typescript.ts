import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { resolve } from "path";
import { readCdmJson } from "@dotdm/contracts";
import { resolveContract, generateContractTypes } from "@dotdm/cdm";
import type { InstallResult } from "./index";

const CDM_INCLUDE = ".cdm/**/*";

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
function ensureTsconfigInclude(): void {
    const tsconfigPath = resolve(process.cwd(), "tsconfig.json");

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
        (entry: unknown) => typeof entry === "string" && entry.replace(/^\.\//, "") === CDM_INCLUDE,
    );

    if (alreadyHas) return;

    include.push(`./${CDM_INCLUDE}`);
    tsconfig.include = include;
    writeFileSync(tsconfigPath, JSON.stringify(tsconfig, null, 4) + "\n");
    console.log(`  TypeScript: Added "./${CDM_INCLUDE}" to tsconfig.json include`);
}

/**
 * Post-install hook for TypeScript projects. Runs after all contracts have been
 * fetched and saved to `~/.cdm/`.
 *
 * Reads the current target's dependencies from `cdm.json`, resolves each
 * contract's ABI from the local store, and generates `.cdm/cdm.d.ts` — a
 * module augmentation that extends the empty `CdmContracts` interface in
 * `@dotdm/cdm` with typed method signatures for each installed contract.
 *
 * Also patches tsconfig.json to include the `.cdm/` directory so the
 * augmentation is visible to the TypeScript compiler.
 */
export async function postInstallTypeScript(result: InstallResult): Promise<void> {
    const cdmResult = readCdmJson();
    if (!cdmResult) return;

    const deps = cdmResult.cdmJson.dependencies[result.targetHash] ?? {};

    // Collect all contracts for this target
    const contracts = Object.entries(deps).map(([lib, ver]) => {
        const resolved = resolveContract(result.targetHash, lib, ver);
        return { library: lib, abi: resolved.abi };
    });

    if (contracts.length === 0) return;

    // Generate .cdm/cdm.d.ts with module augmentation
    const types = generateContractTypes(contracts);
    const cdmDir = resolve(process.cwd(), ".cdm");
    mkdirSync(cdmDir, { recursive: true });
    writeFileSync(resolve(cdmDir, "cdm.d.ts"), types);

    console.log(`  TypeScript: Generated .cdm/cdm.d.ts (${contracts.length} contract(s))`);

    // Ensure tsconfig.json includes .cdm/ for module augmentation
    ensureTsconfigInclude();
}
