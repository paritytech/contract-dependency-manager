import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { PolkadotSigner } from "polkadot-api";
import type { CdmJson } from "@dotdm/contracts";
import { Cdm } from "../cdm-core";
import type { DevAccount } from "./accounts";

const LOCAL_WS_PREFIX = "ws://127.0.0.1";

export interface MakeCdmOptions {
    /** Project directory containing cdm.json. Default: process.cwd(). */
    rootDir?: string;
    signer: PolkadotSigner;
    /** SS58 origin for queries; typically matches the signer's ss58 address. */
    origin: string;
    /**
     * Target hash to use. Resolution order if omitted:
     *   1. `CDM_TARGET_HASH` env var
     *   2. First target with `asset-hub` matching `ws://127.0.0.1` (local)
     *   3. First target in cdm.json
     */
    targetHash?: string;
}

/**
 * Read cdm.json from `rootDir` (default cwd) and construct a `Cdm` for
 * tests. Auto-selects a local target if available, env override wins.
 */
export function makeCdm(opts: MakeCdmOptions): Cdm {
    const root = opts.rootDir ?? process.cwd();
    // Direct fs read instead of `readCdmJson` from `@dotdm/contracts`: an
    // in-source `vi.mock("fs", ...)` in pipeline.ts hoists globally and
    // intercepts `cdm-json.ts`'s `from "fs"` imports during test runs.
    // `node:fs` bypasses that mock.
    const cdmJsonPath = resolve(root, "cdm.json");
    if (!existsSync(cdmJsonPath)) {
        throw new Error(`cdm.json not found at ${cdmJsonPath}. Did you run \`cdm install\`?`);
    }
    const cdmJson = JSON.parse(readFileSync(cdmJsonPath, "utf-8")) as CdmJson;
    const targetHash = opts.targetHash ?? selectTargetHash(cdmJson);
    return new Cdm(cdmJson, {
        targetHash,
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

/**
 * Pick the best target hash from a cdm.json: env override > first local
 * (ws://127.0.0.1) target > first target. Exported for advanced cases
 * (e.g., picking a target for a non-cdm code path).
 */
export function selectTargetHash(cdmJson: CdmJson): string {
    const envOverride = process.env.CDM_TARGET_HASH;
    if (envOverride) return envOverride;
    const entries = Object.entries(cdmJson.targets);
    if (entries.length === 0) {
        throw new Error("cdm.json has no targets. Run `cdm install` first.");
    }
    for (const [hash, target] of entries) {
        if (target["asset-hub"].startsWith(LOCAL_WS_PREFIX)) return hash;
    }
    return entries[0][0];
}
