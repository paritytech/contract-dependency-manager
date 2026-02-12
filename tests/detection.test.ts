import { describe, test, expect, beforeAll } from "bun:test";
import {
    detectContracts,
    buildDependencyGraph,
    toposort,
    detectDeploymentOrder,
} from "../src/lib/detection.js";
import { resolve } from "path";
import { rmSync } from "fs";

const TEMPLATE_DIR = resolve(import.meta.dir, "../templates/shared-counter");

describe("detection via cargo metadata", () => {
    beforeAll(() => {
        // Clean any .cdm.json files from previous builds so tests start fresh
        const targetDir = resolve(TEMPLATE_DIR, "target");
        for (const name of ["counter", "counter_reader", "counter_writer"]) {
            try {
                rmSync(resolve(targetDir, `${name}.release.cdm.json`));
            } catch {}
        }
    });

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

    test("CDM packages are null before build (no .cdm.json files)", () => {
        const contracts = detectContracts(TEMPLATE_DIR);
        for (const c of contracts) {
            expect(c.cdmPackage).toBeNull();
        }
    });
});

describe("toposort algorithm", () => {
    test("handles empty graph", () => {
        const result = toposort(new Map());
        expect(result).toEqual([]);
    });

    test("handles linear chain", () => {
        const graph = new Map([
            ["c", ["b"]],
            ["b", ["a"]],
            ["a", []],
        ]);
        expect(toposort(graph)).toEqual(["a", "b", "c"]);
    });

    test("detects circular dependencies", () => {
        const graph = new Map([
            ["a", ["b"]],
            ["b", ["a"]],
        ]);
        expect(() => toposort(graph)).toThrow("Circular dependency");
    });
});
