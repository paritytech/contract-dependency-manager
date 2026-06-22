import { dirname, resolve } from "path";
import { mkdirSync, writeFileSync } from "fs";
import { generateSolidityImport, readCdmJson } from "@parity/cdm-builder";
import type { SolidityAbiEntry } from "@parity/cdm-builder";

export async function postInstallSolidity(): Promise<void> {
    const cdmResult = readCdmJson();
    if (!cdmResult) return;

    const installedContracts = cdmResult.cdmJson.contracts;
    if (!installedContracts) return;

    for (const [library, data] of Object.entries(installedContracts)) {
        const generated = generateSolidityImport({
            library,
            address: data.address,
            version: data.version,
            abi: data.abi as SolidityAbiEntry[],
        });
        const outputPath = resolve(process.cwd(), generated.path);
        mkdirSync(dirname(outputPath), { recursive: true });
        writeFileSync(outputPath, generated.content);
    }
}
