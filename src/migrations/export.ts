#!/usr/bin/env bun
import { parseArgs } from "node:util";
import { exportRegistrySnapshot, writeRegistrySnapshot } from "./registry";

const { values: opts } = parseArgs({
    args: process.argv.slice(2),
    options: {
        name: { type: "string", short: "n" },
        "assethub-url": { type: "string" },
        "registry-address": { type: "string" },
        out: { type: "string", short: "o", default: "registry-migration.json" },
    },
});

const snapshot = await exportRegistrySnapshot({
    name: opts.name,
    assethubUrl: opts["assethub-url"],
    registryAddress: opts["registry-address"],
});

await writeRegistrySnapshot(opts.out!, snapshot);
console.log(
    `Exported ${snapshot.contracts.length} contracts from ${snapshot.registry_address} to ${opts.out}`,
);
