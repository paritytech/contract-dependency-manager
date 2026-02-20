import React from "react";
import { render } from "ink";
import { detectDeploymentOrderLayered } from "./detection.js";
import { executePipeline } from "./pipeline.js";
import type { PipelineOptions, PipelineResult, ContractStatus } from "./pipeline.js";
import { DeployTable } from "./components/DeployTable.js";

export function progressBar(current: number, total: number, width: number = 20): string {
    if (total === 0) return "░".repeat(width);
    const filled = Math.round((current / total) * width);
    return "█".repeat(filled) + "░".repeat(width - filled);
}

export function formatDuration(ms: number): string {
    return `${(ms / 1000).toFixed(1)}s`;
}

export interface UIOptions extends PipelineOptions {
    assethubUrl?: string;
    bulletinUrl?: string;
    ipfsGatewayUrl?: string;
}

export async function runPipelineWithUI(opts: UIOptions): Promise<PipelineResult> {
    const order = detectDeploymentOrderLayered(opts.rootDir);

    // Apply same filter as pipeline does
    let layers = order.layers;
    if (opts.contractFilter && opts.contractFilter.length > 0) {
        const filterSet = new Set(opts.contractFilter);
        layers = layers
            .map((layer) => layer.filter((crate) => filterSet.has(crate)))
            .filter((layer) => layer.length > 0);
    }

    const crates = layers.flat();
    const buildOnly = !opts.deployer;

    // Display names
    const displayNames = new Map<string, string>();
    for (const crate of crates) {
        displayNames.set(crate, order.cdmPackageMap.get(crate) ?? crate);
    }

    // Mutable status map — pipeline writes, component reads
    const statuses = new Map<string, ContractStatus>();
    const startTimes = new Map<string, number>();

    const onStatusChange = (crateName: string, status: ContractStatus) => {
        statuses.set(crateName, status);
        if (!startTimes.has(crateName)) {
            startTimes.set(crateName, Date.now());
        }
    };

    // Render ink UI
    const app = render(
        React.createElement(DeployTable, {
            statuses,
            displayNames,
            crates,
            buildOnly,
            assethubUrl: opts.assethubUrl,
            bulletinUrl: opts.bulletinUrl,
            ipfsGatewayUrl: opts.ipfsGatewayUrl,
        })
    );

    // Run pipeline
    const result = await executePipeline({ ...opts, onStatusChange });

    // Brief delay for final render
    await new Promise((r) => setTimeout(r, 200));
    app.unmount();

    return result;
}
