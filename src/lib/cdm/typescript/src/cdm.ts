import { readCdmJson } from "@dotdm/contracts";
import type { CdmJson } from "@dotdm/contracts";
import { Cdm } from "./cdm-core";
import type { CdmOptions } from "./types";

export function createCdm(cdmJsonOrOpts?: CdmJson | CdmOptions, options?: CdmOptions): Cdm {
    // If first arg has "targets", treat as CdmJson data (passed directly)
    if (cdmJsonOrOpts && "targets" in cdmJsonOrOpts) {
        return new Cdm(cdmJsonOrOpts as CdmJson, options);
    }

    // Otherwise treat as CdmOptions (Node-style usage)
    const opts = cdmJsonOrOpts as CdmOptions | undefined;
    const result = readCdmJson(opts?.cdmJsonPath);
    if (!result) {
        throw new Error("cdm.json not found. Run 'cdm install' first.");
    }
    return new Cdm(result.cdmJson, opts);
}
