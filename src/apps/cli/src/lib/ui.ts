import React from "react";
import { render } from "ink";
import { detectDeploymentOrderLayered } from "@dotdm/contracts";
import { executePipeline } from "./deploy-pipeline";
import type { PipelineOptions, PipelineResult, ContractStatus } from "./deploy-pipeline";
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

export interface UIOptions extends PipelineOptions {
    assethubUrl?: string;
    bulletinUrl?: string;
    ipfsGatewayUrl?: string;
}

export async function runPipelineWithUI(opts: UIOptions): Promise<PipelineResult> {
    const order = opts.order ?? detectDeploymentOrderLayered(opts.rootDir);

    // Apply same filter as pipeline does
    let layers = order.layers;
    if (opts.contractFilter && opts.contractFilter.length > 0) {
        const filterSet = new Set(opts.contractFilter);
        layers = layers
            .map((layer) => layer.filter((crate) => filterSet.has(crate)))
            .filter((layer) => layer.length > 0);
    }

    const crates = layers.flat();
    const buildOnly = !opts.services;

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

    const onCdmPackageDetected = (crateName: string, cdmPackage: string) => {
        displayNames.set(crateName, cdmPackage);
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
        }),
    );

    // Run pipeline — pass order so it doesn't re-detect
    const result = await executePipeline({ ...opts, order, onStatusChange, onCdmPackageDetected });

    // Brief delay for final render
    await new Promise((r) => setTimeout(r, 200));
    app.unmount();

    return result;
}
