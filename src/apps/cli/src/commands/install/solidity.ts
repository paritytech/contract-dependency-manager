import { dirname, resolve } from "path";
import { mkdirSync, writeFileSync } from "fs";
import { generateSolidityImport, readCdmJson } from "@dotdm/contracts";
import type { AbiEntry } from "@dotdm/contracts";
import type { InstallResult } from "./index";

export async function postInstallSolidity(result: InstallResult): Promise<void> {
    const cdmResult = readCdmJson();
    if (!cdmResult) return;

    const contractsForTarget = cdmResult.cdmJson.contracts?.[result.targetHash];
    if (!contractsForTarget) return;

    for (const [library, data] of Object.entries(contractsForTarget)) {
        const generated = generateSolidityImport({
            library,
            address: data.address,
            version: data.version,
            abi: data.abi as AbiEntry[],
        });
        const outputPath = resolve(process.cwd(), generated.path);
        mkdirSync(dirname(outputPath), { recursive: true });
        writeFileSync(outputPath, generated.content);
    }
}
