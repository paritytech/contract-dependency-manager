import React from "react";
import { render } from "ink";
import {
    installContracts,
    type InstallContractsOptions,
    type InstallEvent,
    type InstallResult,
    type InstallSummary,
} from "@dotdm/contracts";
import { InstallTable } from "./components/InstallTable";

export type { InstallResult, InstallSummary } from "@dotdm/contracts";

export type InstallState = "waiting" | "querying" | "fetching" | "done" | "error";

export interface InstallStatus {
    library: string;
    state: InstallState;
    error?: string;
    version?: number;
    address?: string;
    metadataCid?: string;
    savedPath?: string;
}

export type InstallRunnerOptions = Omit<InstallContractsOptions, "onEvent"> & {
    ipfsGatewayUrl?: string;
};

export type InstallRunnerResult = InstallSummary;

function updateStatus(
    statuses: Map<string, InstallStatus>,
    library: string,
    state: InstallState,
    extra?: Partial<InstallStatus>,
): void {
    const current = statuses.get(library) ?? { library, state: "waiting" };
    statuses.set(library, { ...current, state, ...extra });
}

function handleInstallEvent(statuses: Map<string, InstallStatus>, event: InstallEvent): void {
    switch (event.type) {
        case "install-start":
            updateStatus(statuses, event.library, "waiting");
            return;
        case "query-start":
            updateStatus(statuses, event.library, "querying");
            return;
        case "query-done":
        case "fetch-start":
            updateStatus(statuses, event.library, "fetching", {
                ...("version" in event ? { version: event.version } : {}),
                ...("address" in event ? { address: event.address } : {}),
                metadataCid: event.metadataCid,
            });
            return;
        case "install-done":
            updateStatus(statuses, event.library, "done", {
                version: event.result.version,
                address: event.result.address,
                metadataCid: event.result.metadataCid,
                savedPath: event.result.savedPath,
            });
            return;
        case "install-error":
            updateStatus(statuses, event.library, "error", { error: event.error });
            return;
        case "pipeline-done":
        case "pipeline-error":
            return;
    }
}

export async function runInstallWithUI(opts: InstallRunnerOptions): Promise<InstallRunnerResult> {
    const libraryNames = opts.libraries.map((l) => l.library);
    const statuses = new Map<string, InstallStatus>();
    for (const { library } of opts.libraries) {
        statuses.set(library, { library, state: "waiting" });
    }

    const app = render(
        React.createElement(InstallTable, {
            statuses,
            libraries: libraryNames,
            ipfsGatewayUrl: opts.ipfsGatewayUrl,
        }),
    );

    try {
        return await installContracts({
            ...opts,
            onEvent: (event) => handleInstallEvent(statuses, event),
        });
    } finally {
        await new Promise((r) => setTimeout(r, 200));
        app.unmount();
    }
}
