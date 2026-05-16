import React from "react";
import { render } from "ink";
import {
    buildContracts,
    deployContracts,
    detectBuildOrder,
    type BuildContractsOptions,
    type DeployContractsOptions,
    type BuildSummary,
    type DeploySummary,
    type DeployEvent,
} from "@dotdm/contracts";
import { PipelineStatusAdapter, type ContractStatus, type PipelineResult } from "./deploy-pipeline";
import { DeployTable } from "./components/DeployTable";
import { SPINNER_FRAMES } from "./components/shared";

/** Plain stdout spinner for connection/setup phases (before Ink rendering starts) */
export function spinner(label: string, detail: string) {
    let i = 0;
    const id = setInterval(() => {
        process.stdout.write(
            `\r\x1b[2K\x1b[1m${label}\x1b[0m ${SPINNER_FRAMES[i++ % SPINNER_FRAMES.length]} ${detail}`,
        );
    }, 80);
    return {
        succeed() {
            clearInterval(id);
            process.stdout.write(`\r\x1b[2K\x1b[1m${label}\x1b[0m \x1b[32m✔\x1b[0m ${detail}\n`);
        },
        fail() {
            clearInterval(id);
            process.stdout.write(`\r\x1b[2K\x1b[1m${label}\x1b[0m \x1b[31m✖\x1b[0m ${detail}\n`);
        },
    };
}

export function progressBar(current: number, total: number, width: number = 20): string {
    if (total === 0) return "░".repeat(width);
    const filled = Math.round((current / total) * width);
    return "█".repeat(filled) + "░".repeat(width - filled);
}

export function formatDuration(ms: number): string {
    return `${(ms / 1000).toFixed(1)}s`;
}

export interface BuildUIOptions extends Omit<BuildContractsOptions, "onEvent"> {}

export interface DeployUIOptions extends Omit<DeployContractsOptions, "onEvent"> {
    assethubUrl?: string;
    bulletinUrl?: string;
    ipfsGatewayUrl?: string;
}

interface RenderArgs {
    statuses: Map<string, ContractStatus>;
    displayNames: Map<string, string>;
    crates: string[];
    logLines: string[];
    buildOnly: boolean;
    assethubUrl?: string;
    bulletinUrl?: string;
    ipfsGatewayUrl?: string;
}

function makeUI(args: RenderArgs) {
    return render(
        React.createElement(DeployTable, {
            statuses: args.statuses,
            displayNames: args.displayNames,
            crates: args.crates,
            logLines: args.logLines,
            buildOnly: args.buildOnly,
            assethubUrl: args.assethubUrl,
            bulletinUrl: args.bulletinUrl,
            ipfsGatewayUrl: args.ipfsGatewayUrl,
        }),
    );
}

function precomputeBuildDisplay(rootDir: string, contracts: string[] | undefined) {
    const order = detectBuildOrder(rootDir, contracts);
    const crates = order.layers.flat();
    const displayNames = new Map<string, string>();
    for (const contract of order.contracts) {
        displayNames.set(
            contract.name,
            contract.cdmPackage ?? contract.displayName ?? contract.name,
        );
    }
    return { crates, displayNames };
}

/**
 * Run `buildContracts()` and render progress into the Ink `DeployTable`.
 *
 * The table layout is populated lazily from the `detect` event — crates, layers,
 * and CDM package names are all supplied by the library, not derived up-front
 * in the CLI.
 */
export async function runBuildWithUI(opts: BuildUIOptions): Promise<{
    summary: BuildSummary;
    result: PipelineResult;
}> {
    const { crates, displayNames } = precomputeBuildDisplay(opts.rootDir, opts.contracts);

    const adapter = new PipelineStatusAdapter({
        onCdmPackageDetected: (crate, pkg) => displayNames.set(crate, pkg),
    });

    const app = makeUI({
        statuses: adapter.statuses,
        displayNames,
        crates,
        logLines: adapter.logLines,
        buildOnly: true,
    });

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
    const { crates, displayNames } = precomputeBuildDisplay(opts.rootDir, opts.contracts);

    const adapter = new PipelineStatusAdapter({
        onCdmPackageDetected: (crate, pkg) => displayNames.set(crate, pkg),
    });

    const app = makeUI({
        statuses: adapter.statuses,
        displayNames,
        crates,
        logLines: adapter.logLines,
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
