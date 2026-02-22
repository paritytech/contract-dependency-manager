import { mkdirSync, writeFileSync } from "fs";
import { resolve } from "path";
import { readCdmJson } from "@dotdm/contracts";
import { resolveContract, generateContractTypes } from "@dotdm/cdm";
import type { InstallResult } from "./index";

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
}
