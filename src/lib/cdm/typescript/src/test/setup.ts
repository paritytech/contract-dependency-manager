import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { PolkadotSigner } from "polkadot-api";
import type { CdmJson } from "@parity/cdm-builder";
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

const DEFAULT_LOCAL_ASSETHUB_URL = "ws://127.0.0.1:10020";

/**
 * Read cdm.json from `rootDir` (default cwd) and construct a `Cdm` for tests.
 *
 * `assethubUrl` defaults to the local PPN (ws://127.0.0.1:10020). Override
 * via the option, the `CDM_ASSETHUB_URL` env var, or by passing `options.client`
 * directly to `new Cdm(...)`.
 */
export function makeCdm(opts: MakeCdmOptions): Cdm {
    const root = opts.rootDir ?? process.cwd();
    // Direct fs read instead of `readCdmJson` from `@parity/cdm-builder`: an
    // in-source `vi.mock("fs", ...)` in pipeline.ts hoists globally and
    // intercepts `cdm-json.ts`'s `from "fs"` imports during test runs.
    // `node:fs` bypasses that mock.
    const cdmJsonPath = resolve(root, "cdm.json");
    if (!existsSync(cdmJsonPath)) {
        throw new Error(`cdm.json not found at ${cdmJsonPath}. Did you run \`cdm install\`?`);
    }
    const cdmJson = JSON.parse(readFileSync(cdmJsonPath, "utf-8")) as CdmJson;
    const assethubUrl =
        opts.assethubUrl ?? process.env.CDM_ASSETHUB_URL ?? DEFAULT_LOCAL_ASSETHUB_URL;
    return new Cdm(cdmJson, {
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
