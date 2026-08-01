import React from "react";
import { render } from "ink";
import {
    buildContracts,
    deployContracts,
    type BuildContractsOptions,
    type DeployContractsOptions,
    type BuildSummary,
    type DeploySummary,
    type DeployEvent,
} from "@parity/cdm-builder";
import { PipelineStatusAdapter, type ContractStatus, type PipelineResult } from "./deploy-pipeline";
import { DeployTable } from "./components/DeployTable";
import { SPINNER_FRAMES } from "./components/shared";

/** Plain stdout spinner for connection/setup phases (before Ink rendering starts) */
export function spinner(label: string, detail: string) {
    let i = 0;
    let currentDetail = detail;
    const id = setInterval(() => {
        process.stdout.write(
            `\r\x1b[2K\x1b[1m${label}\x1b[0m ${SPINNER_FRAMES[i++ % SPINNER_FRAMES.length]} ${currentDetail}`,
        );
    }, 80);
    return {
        update(nextDetail: string) {
            currentDetail = nextDetail;
        },
        succeed(finalDetail: string = currentDetail) {
            clearInterval(id);
            process.stdout.write(
                `\r\x1b[2K\x1b[1m${label}\x1b[0m \x1b[32m✔\x1b[0m ${finalDetail}\n`,
            );
        },
        fail(finalDetail: string = currentDetail) {
            clearInterval(id);
            process.stdout.write(
                `\r\x1b[2K\x1b[1m${label}\x1b[0m \x1b[31m✖\x1b[0m ${finalDetail}\n`,
            );
        },
    };
}

export interface BuildUIOptions extends Omit<BuildContractsOptions, "onEvent"> {}

export interface DeployUIOptions extends Omit<DeployContractsOptions, "onEvent"> {
    assethubUrl?: string;
    bulletinUrl?: string;
    ipfsGatewayUrl?: string;
}

interface RenderArgs {
    adapter: PipelineStatusAdapter;
    displayNames: Map<string, string>;
    buildOnly: boolean;
    assethubUrl?: string;
    bulletinUrl?: string;
    ipfsGatewayUrl?: string;
}

function makeUI(args: RenderArgs) {
    return render(
        React.createElement(DeployTable, {
            statuses: args.adapter.statuses,
            displayNames: args.displayNames,
            logLines: args.adapter.logLines,
            buildOnly: args.buildOnly,
            assethubUrl: args.assethubUrl,
            bulletinUrl: args.bulletinUrl,
            ipfsGatewayUrl: args.ipfsGatewayUrl,
        }),
    );
}

/**
 * Run `buildContracts()` and render progress into the Ink `DeployTable`.
 *
 * The table layout is populated from the library's `detect` event — the
 * adapter fills `statuses` (row order) and `displayNames` in place, and the
 * table re-reads both on every render tick. Nothing is detected up-front in
 * the CLI.
 */
export async function runBuildWithUI(opts: BuildUIOptions): Promise<{
    summary: BuildSummary;
    result: PipelineResult;
}> {
    const displayNames = new Map<string, string>();
    const adapter = new PipelineStatusAdapter({
        onCdmPackageDetected: (crate, pkg) => displayNames.set(crate, pkg),
    });

    const app = makeUI({ adapter, displayNames, buildOnly: true });

    let summary: BuildSummary;
    try {
        summary = await buildContracts({ ...opts, onEvent: adapter.handleBuildEvent });
    } finally {
        await new Promise((r) => setTimeout(r, 200));
        app.unmount();
    }

    const success = summary.contracts.every((c: { error?: string }) => !c.error);
    return {
        summary,
        result: {
            addresses: {},
            statuses: adapter.statuses,
            success,
        },
    };
}

/**
 * Run `deployContracts()` and render progress into the Ink `DeployTable`.
 *
 * Same event-adapter pattern as `runBuildWithUI`, plus the chain URLs so the
 * table can render tx/CID/block hyperlinks.
 */
export async function runDeployWithUI(opts: DeployUIOptions): Promise<{
    summary: DeploySummary;
    result: PipelineResult;
}> {
    const displayNames = new Map<string, string>();
    const adapter = new PipelineStatusAdapter({
        onCdmPackageDetected: (crate, pkg) => displayNames.set(crate, pkg),
    });

    const app = makeUI({
        adapter,
        displayNames,
        buildOnly: false,
        assethubUrl: opts.assethubUrl,
        bulletinUrl: opts.bulletinUrl,
        ipfsGatewayUrl: opts.ipfsGatewayUrl,
    });

    let summary: DeploySummary;
    try {
        summary = await deployContracts({
            ...opts,
            onEvent: (e: DeployEvent) => adapter.handleDeployEvent(e),
        });
    } finally {
        await new Promise((r) => setTimeout(r, 200));
        app.unmount();
    }

    const addresses: Record<string, string> = {};
    for (const c of summary.contracts) {
        if (c.address) addresses[c.crate] = c.address;
    }
    const success = summary.contracts.every((c: { status: string }) => c.status !== "error");
    return {
        summary,
        result: {
            addresses,
            statuses: adapter.statuses,
            success,
        },
    };
}
