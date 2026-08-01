import type { BuildEvent, DeployEvent } from "@parity/cdm-builder";

/**
 * CLI-local `ContractStatus` shape that the Ink `DeployTable.tsx` component
 * consumes. Populated by adapting `BuildEvent` / `DeployEvent` streams from
 * `@parity/cdm-builder` `buildContracts()` / `deployContracts()`.
 *
 * The pipeline itself now lives in `@parity/cdm-builder`; this file only handles
 * event → UI-status translation so the terminal table stays unchanged.
 */
export type ContractState = "waiting" | "building" | "built" | "deploying" | "done" | "error";

export interface ContractStatus {
    crateName: string;
    state: ContractState;
    error?: string;
    address?: string;
    cid?: string;
    deployTxHash?: string;
    deployBlockHash?: string;
    /** Same value as `deployTxHash` since deploy+register are one batch now. */
    registerTxHash?: string;
    registerBlockHash?: string;
    durationMs?: number;
    buildProgress?: { compiled: number; total?: number; currentCrate: string };
    /** Bytecode size in bytes (populated from `build-done` event). */
    bytecodeSize?: number;
    deployInProgress?: boolean;
    publishInProgress?: boolean;
    registerInProgress?: boolean;
}

export interface AdapterOptions {
    /** Called when a build reveals a crate's CDM package name. */
    onCdmPackageDetected?: (crateName: string, cdmPackage: string) => void;
}

/**
 * Build/deploy adapter — maintains a `Map<crate, ContractStatus>` and a log
 * tail that the Ink UI reads on each render tick, plus an `onEvent` handler
 * to pass into `buildContracts()` or `deployContracts()`. Rows appear as the
 * library's `detect` event populates `statuses`.
 */
export class PipelineStatusAdapter {
    static readonly LOG_TAIL_LINES = 5;

    readonly statuses = new Map<string, ContractStatus>();
    readonly logLines: string[] = [];
    cdmPackageMap = new Map<string, string>();

    constructor(private opts: AdapterOptions = {}) {}

    private appendLog(rawLine: string) {
        const line = cleanLogLine(rawLine);
        if (!line) return;
        this.logLines.push(line);
        if (this.logLines.length > PipelineStatusAdapter.LOG_TAIL_LINES) {
            this.logLines.splice(0, this.logLines.length - PipelineStatusAdapter.LOG_TAIL_LINES);
        }
    }

    private clearLogs() {
        this.logLines.splice(0);
    }

    private update(crate: string, state: ContractState, extra?: Partial<ContractStatus>) {
        const current = this.statuses.get(crate) ?? { crateName: crate, state: "waiting" };
        this.statuses.set(crate, { ...current, state, ...extra });
    }

    /** Forward a `BuildEvent` (emitted by `buildContracts()`) into the UI map. */
    handleBuildEvent = (e: BuildEvent) => {
        switch (e.type) {
            case "log":
                this.appendLog(e.line);
                return;
            case "detect":
                for (const c of e.contracts) {
                    if (c.cdmPackage) this.cdmPackageMap.set(c.name, c.cdmPackage);
                }
                for (const crate of e.layers.flat()) {
                    this.statuses.set(crate, { crateName: crate, state: "waiting" });
                }
                for (const [crate, pkg] of this.cdmPackageMap) {
                    this.opts.onCdmPackageDetected?.(crate, pkg);
                }
                for (const c of e.contracts) {
                    if (!c.cdmPackage && c.displayName && c.displayName !== c.name) {
                        this.opts.onCdmPackageDetected?.(c.name, c.displayName);
                    }
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
                this.update(e.crate, "built", {
                    durationMs: e.durationMs,
                    bytecodeSize: e.bytecodeSize,
                });
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
                if (e.summary.contracts.every((contract) => !contract.error)) {
                    this.clearLogs();
                }
                return;
        }
    };

    /** Forward a `DeployEvent` (emitted by `deployContracts()`) into the UI map. */
    handleDeployEvent = (e: DeployEvent) => {
        switch (e.type) {
            case "detect":
            case "log":
            case "build-start":
            case "build-progress":
            case "build-done":
            case "build-error":
                this.handleBuildEvent(e as BuildEvent);
                return;
            case "check-needs-deploy":
                // Address precomputed — no state change yet, deploy-register
                // will follow.
                return;
            case "deploy-plan":
                // Diagnostic-only — no per-crate state change and nothing to
                // mutate here.
                return;
            case "phase":
                // Coarse progress signal — not surfaced in the table UI.
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
                // Multiple done events can fire per layer when the deployer
                // weight-chunks a layer into >1 batches — each event only
                // carries the crates in THAT chunk. We only mutate crates
                // named in `e.addresses`; others stay in "deploying" until
                // their chunk lands.
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
            case "pipeline-done":
                if (e.summary.contracts.every((contract) => contract.status !== "error")) {
                    this.clearLogs();
                }
                return;
            case "pipeline-error":
                return;
        }
    };
}

const ANSI_PATTERN = /\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1B\\))/g;

function cleanLogLine(line: string): string {
    return line.replace(ANSI_PATTERN, "").replace(/\r/g, "").trimEnd();
}

export interface PipelineResult {
    addresses: Record<string, string>;
    statuses: Map<string, ContractStatus>;
    success: boolean;
}
