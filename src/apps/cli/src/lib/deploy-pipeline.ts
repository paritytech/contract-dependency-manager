import type {
    BuildEvent,
    DeployEvent,
    BuildSummary,
    DeploySummary,
    ContractInfo,
} from "@dotdm/contracts";

/**
 * CLI-local `ContractStatus` shape that the Ink `DeployTable.tsx` component
 * consumes. Populated by adapting `BuildEvent` / `DeployEvent` streams from
 * `@dotdm/contracts` `buildContracts()` / `deployContracts()`.
 *
 * The pipeline itself now lives in `@dotdm/contracts`; this file only handles
 * event → UI-status translation so the terminal table stays unchanged.
 */
export type ContractState =
    | "waiting"
    | "building"
    | "built"
    | "checking"
    | "cached"
    | "deploying"
    | "registering"
    | "done"
    | "error";

export interface ContractStatus {
    crateName: string;
    state: ContractState;
    error?: string;
    address?: string;
    cid?: string;
    deployTxHash?: string;
    deployBlockHash?: string;
    publishTxHash?: string;
    publishBlockHash?: string;
    /** Same value as `deployTxHash` since deploy+register are one batch now. */
    registerTxHash?: string;
    registerBlockHash?: string;
    durationMs?: number;
    buildProgress?: { compiled: number; total: number; currentCrate: string };
    deployInProgress?: boolean;
    publishInProgress?: boolean;
    registerInProgress?: boolean;
}

export interface AdapterOptions {
    /** Called on every status mutation (after the update is applied). */
    onStatusChange?: (crateName: string, status: ContractStatus) => void;
    /** Called when a build reveals a crate's CDM package name. */
    onCdmPackageDetected?: (crateName: string, cdmPackage: string) => void;
}

/**
 * Build/deploy adapter — maintains a `Map<crate, ContractStatus>` that the Ink
 * UI reads, plus an `onEvent` handler to pass into `buildContracts()` or
 * `deployContracts()`. Also exposes `crates` / `layers` / `contracts` so the UI
 * can render the table layout as soon as detection completes.
 */
export class PipelineStatusAdapter {
    readonly statuses = new Map<string, ContractStatus>();
    crates: string[] = [];
    layers: string[][] = [];
    contracts: ContractInfo[] = [];
    cdmPackageMap = new Map<string, string>();

    constructor(private opts: AdapterOptions = {}) {}

    private update(crate: string, state: ContractState, extra?: Partial<ContractStatus>) {
        const current = this.statuses.get(crate) ?? { crateName: crate, state: "waiting" };
        const updated: ContractStatus = { ...current, state, ...extra };
        this.statuses.set(crate, updated);
        this.opts.onStatusChange?.(crate, updated);
    }

    /** Forward a `BuildEvent` (emitted by `buildContracts()`) into the UI map. */
    handleBuildEvent = (e: BuildEvent) => {
        switch (e.type) {
            case "detect":
                this.contracts = e.contracts;
                this.layers = e.layers;
                this.crates = e.layers.flat();
                for (const c of e.contracts) {
                    if (c.cdmPackage) this.cdmPackageMap.set(c.name, c.cdmPackage);
                }
                for (const crate of this.crates) {
                    this.statuses.set(crate, { crateName: crate, state: "waiting" });
                    this.opts.onStatusChange?.(crate, this.statuses.get(crate)!);
                }
                for (const [crate, pkg] of this.cdmPackageMap) {
                    this.opts.onCdmPackageDetected?.(crate, pkg);
                }
                return;
            case "build-start":
                this.update(e.crate, "building");
                return;
            case "build-progress":
                this.update(e.crate, "building", {
                    buildProgress: {
                        compiled: e.compiled,
                        total: e.total,
                        currentCrate: e.crate,
                    },
                });
                return;
            case "build-done":
                this.update(e.crate, "built", { durationMs: e.durationMs });
                return;
            case "build-error":
                this.update(e.crate, "error", { error: e.error });
                return;
            case "pipeline-done":
                // In build-only mode, flip every non-error "built" to "done"
                // so the table renders with completed checkmarks. For
                // `deployContracts`, states are already terminal by the time
                // the deploy summary arrives.
                for (const [crate, s] of this.statuses) {
                    if (s.state === "built") this.update(crate, "done");
                }
                return;
        }
    };

    /** Forward a `DeployEvent` (emitted by `deployContracts()`) into the UI map. */
    handleDeployEvent = (e: DeployEvent) => {
        switch (e.type) {
            case "detect":
            case "build-start":
            case "build-progress":
            case "build-done":
            case "build-error":
                this.handleBuildEvent(e as BuildEvent);
                return;
            case "check-cached":
                this.update(e.crate, "cached", { address: e.address });
                return;
            case "check-needs-deploy":
                // Address precomputed — no state change yet, deploy-register
                // will follow.
                return;
            case "sign-request":
                // Not forwarded to UI for now — `deploy-register-start` /
                // `publish-start` drive the spinner columns.
                return;
            case "deploy-register-start":
                for (const crate of e.crates) {
                    const cdm = this.cdmPackageMap.has(crate);
                    this.update(crate, "deploying", {
                        deployInProgress: true,
                        ...(cdm ? { registerInProgress: true } : {}),
                    });
                }
                return;
            case "publish-start":
                for (const crate of e.crates) {
                    this.update(crate, "deploying", { publishInProgress: true });
                }
                return;
            case "deploy-register-done": {
                for (const crate of Object.keys(e.addresses)) {
                    const addr = e.addresses[crate];
                    if (!addr) continue;
                    const cdm = this.cdmPackageMap.has(crate);
                    // CDM: deploy+register combined batch → mark done for both
                    // columns; non-CDM: no register, mark done.
                    this.update(crate, "done", {
                        address: addr,
                        deployInProgress: false,
                        registerInProgress: false,
                        deployTxHash: e.txHash,
                        deployBlockHash: e.blockHash,
                        ...(cdm
                            ? {
                                  registerTxHash: e.txHash,
                                  registerBlockHash: e.blockHash,
                              }
                            : {}),
                    });
                }
                return;
            }
            case "publish-done":
                for (const crate of Object.keys(e.cids)) {
                    const cid = e.cids[crate];
                    const existing = this.statuses.get(crate);
                    this.update(crate, existing?.state ?? "done", {
                        publishInProgress: false,
                        cid,
                        publishTxHash: e.txHash,
                    });
                }
                return;
            case "deploy-register-error":
                for (const crate of e.crates) {
                    this.update(crate, "error", {
                        error: e.error,
                        deployInProgress: false,
                        publishInProgress: false,
                        registerInProgress: false,
                    });
                }
                return;
            case "publish-error":
                for (const crate of e.crates) {
                    this.update(crate, "error", {
                        error: e.error,
                        publishInProgress: false,
                    });
                }
                return;
            case "tx-status":
                // Currently unused by the Ink UI — reserved for a future,
                // finer-grained spinner. Safe to ignore.
                return;
            case "pipeline-done":
            case "pipeline-error":
                return;
        }
    };

    /** Snapshot of addresses suitable for the old `PipelineResult` consumers. */
    addressesFromSummary(summary: DeploySummary | BuildSummary): Record<string, string> {
        const out: Record<string, string> = {};
        for (const c of (summary as DeploySummary).contracts) {
            const dc = c as { crate: string; address?: string };
            if (dc.address) out[dc.crate] = dc.address;
        }
        return out;
    }
}

export interface PipelineResult {
    addresses: Record<string, string>;
    statuses: Map<string, ContractStatus>;
    success: boolean;
}
