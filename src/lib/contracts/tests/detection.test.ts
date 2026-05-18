import { describe, test, expect } from "vitest";
import { detectContracts, buildDependencyGraph, detectDeploymentOrder } from "../src/detection";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATE_DIR = resolve(__dirname, "../../../templates/shared-counter");

describe("detection via cargo metadata", () => {
    test("detects all 3 contracts in shared-counter template", () => {
        const contracts = detectContracts(TEMPLATE_DIR);
        const names = contracts.map((c) => c.name).sort();
        expect(names).toEqual(["counter", "counter_reader", "counter_writer"]);
    });

    test("detects dependency graph from Cargo.toml", () => {
        const contracts = detectContracts(TEMPLATE_DIR);
        const graph = buildDependencyGraph(contracts);

        expect(graph.get("counter")).toEqual([]);
        expect(graph.get("counter_writer")).toContain("counter");
        expect(graph.get("counter_reader")).toContain("counter");
    });

    test("topological sort puts counter first", () => {
        const order = detectDeploymentOrder(TEMPLATE_DIR);
        expect(order.crateNames[0]).toBe("counter");
        expect(order.crateNames.length).toBe(3);
    });

    test("CDM package names come from [package.metadata.cdm-package] in Cargo.toml", () => {
        // After the new SDK migration, cdmPackage is resolved at detection
        // time from `[package.metadata.cdm-package]` (surfaced by `cargo
        // metadata`), not from a post-build `.cdm.json` artifact.
        const contracts = detectContracts(TEMPLATE_DIR);
        const byName = new Map(contracts.map((c) => [c.name, c.cdmPackage]));
        expect(byName.get("counter")).toBe("@example/counter");
        expect(byName.get("counter_writer")).toBe("@example/counter-writer");
        expect(byName.get("counter_reader")).toBe("@example/counter-reader");
    });
});
