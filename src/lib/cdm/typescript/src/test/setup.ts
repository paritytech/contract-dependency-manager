import { resolve } from "node:path";
import type { PolkadotSigner } from "polkadot-api";
import { readCdmJson } from "@parity/cdm-builder";
import { LOCAL_ASSETHUB_URL } from "@parity/cdm-utils";
import { Cdm } from "../cdm-core";
import type { DevAccount } from "./accounts";

export interface MakeCdmOptions {
    /** Project directory containing cdm.json. Default: process.cwd(). */
    rootDir?: string;
    signer: PolkadotSigner;
    /** SS58 origin for queries; typically matches the signer's ss58 address. */
    origin: string;
    /** Asset Hub WebSocket URL for chain queries. Default: local PPN. */
    assethubUrl?: string;
}

/**
 * Read cdm.json from `rootDir` (default cwd) and construct a `Cdm` for tests.
 *
 * `assethubUrl` defaults to the local PPN (`LOCAL_ASSETHUB_URL`). Override
 * via the option, the `CDM_ASSETHUB_URL` env var, or by passing `options.client`
 * directly to `new Cdm(...)`.
 */
export function makeCdm(opts: MakeCdmOptions): Cdm {
    const root = opts.rootDir ?? process.cwd();
    const result = readCdmJson(root);
    if (!result) {
        throw new Error(
            `cdm.json not found at ${resolve(root, "cdm.json")}. Did you run \`cdm install\`?`,
        );
    }
    const assethubUrl = opts.assethubUrl ?? process.env.CDM_ASSETHUB_URL ?? LOCAL_ASSETHUB_URL;
    return new Cdm(result.cdmJson, {
        assethubUrl,
        defaultSigner: opts.signer,
        defaultOrigin: opts.origin,
    });
}

/** Convenience: take signer + origin from a DevAccount. */
export function makeCdmAs(
    account: DevAccount,
    opts?: Omit<MakeCdmOptions, "signer" | "origin">,
): Cdm {
    return makeCdm({ ...opts, signer: account.signer, origin: account.ss58 });
}
