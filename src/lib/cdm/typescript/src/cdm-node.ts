import { readCdmJson } from "@dotdm/contracts";
import { Cdm } from "./cdm-core";
import type { CdmOptions } from "./types";

export function createCdmFromFile(options?: CdmOptions): Cdm {
    const result = readCdmJson(options?.cdmJsonPath);
    if (!result) {
        throw new Error("cdm.json not found. Run 'cdm install' first.");
    }
    return new Cdm(result.cdmJson, options);
}
