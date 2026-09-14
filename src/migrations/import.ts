#!/usr/bin/env bun
import { parseArgs } from "node:util";
import { importRegistrySnapshot, readRegistrySnapshot, resolveMigrationTarget } from "./registry";

const { values: opts } = parseArgs({
    args: process.argv.slice(2),
    options: {
        name: { type: "string", short: "n" },
        "assethub-url": { type: "string" },
        "registry-address": { type: "string" },
        in: { type: "string", short: "i", default: "registry-migration.json" },
        suri: { type: "string" },
        "batch-size": { type: "string", default: "10" },
    },
});

const snapshot = await readRegistrySnapshot(opts.in!);
const batchSize = Number(opts["batch-size"]);
const target = resolveMigrationTarget({
    name: opts.name,
    assethubUrl: opts["assethub-url"],
    registryAddress: opts["registry-address"],
});

const { imported, skipped } = await importRegistrySnapshot(
    snapshot,
    {
        name: opts.name,
        assethubUrl: opts["assethub-url"],
        registryAddress: opts["registry-address"],
        suri: opts.suri,
        batchSize,
    },
    ({ imported, total, batchIndex, totalBatches }) => {
        console.log(`Imported ${imported}/${total} contracts (${batchIndex}/${totalBatches})`);
    },
);

console.log(
    `Imported ${imported} contracts into ${target.registryAddress}` +
        (skipped > 0 ? ` (${skipped} already present)` : ""),
);
