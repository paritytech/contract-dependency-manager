import type { CdmJson } from "@dotdm/contracts";
import { Cdm } from "./cdm-core";
import type { CdmOptions } from "./types";

export function createCdm(cdmJson: CdmJson, options?: CdmOptions): Cdm {
    return new Cdm(cdmJson, options);
}
