import { describe, test, expect, beforeAll } from "vitest";
import {
    detectContracts,
    buildDependencyGraph,
    toposort,
    detectDeploymentOrder,
} from "../src/detection";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { rmSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATE_DIR = resolve(__dirname, "../../../templates/shared-counter");

describe("detection via cargo metadata", () => {
    beforeAll(() => {
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
