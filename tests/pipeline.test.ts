import { describe, test, expect } from "bun:test";
import { toposortLayers } from "../src/lib/detection.js";

describe("toposortLayers", () => {
    test("diamond graph", () => {
        const graph = new Map([
            ["A", []],
            ["B", []],
            ["C", ["A", "B"]],
        ]);
        const result = toposortLayers(graph);
        expect(result).toEqual([["A", "B"], ["C"]]);
    });

    test("linear chain", () => {
        const graph = new Map([
            ["A", []],
            ["B", ["A"]],
            ["C", ["B"]],
        ]);
        const result = toposortLayers(graph);
        expect(result).toEqual([["A"], ["B"], ["C"]]);
    });

    test("all independent", () => {
        const graph = new Map([
            ["A", []],
            ["B", []],
            ["C", []],
        ]);
        const result = toposortLayers(graph);
        expect(result).toEqual([["A", "B", "C"]]);
    });

    test("single node", () => {
        const graph = new Map([["A", []]]);
        const result = toposortLayers(graph);
        expect(result).toEqual([["A"]]);
    });

    test("empty graph", () => {
        const graph = new Map<string, string[]>();
        const result = toposortLayers(graph);
        expect(result).toEqual([]);
    });

    test("complex DAG", () => {
        const graph = new Map([
            ["A", []],
            ["B", []],
            ["C", []],
            ["D", ["A", "B"]],
            ["E", ["B", "C"]],
            ["F", ["D", "E"]],
        ]);
        const result = toposortLayers(graph);
        expect(result).toEqual([["A", "B", "C"], ["D", "E"], ["F"]]);
    });

    test("wide fan-out", () => {
        const graph = new Map([
            ["A", []],
            ["B", ["A"]],
            ["C", ["A"]],
            ["D", ["A"]],
            ["E", ["A"]],
        ]);
        const result = toposortLayers(graph);
        expect(result).toEqual([["A"], ["B", "C", "D", "E"]]);
    });

    test("wide fan-in", () => {
        const graph = new Map([
            ["A", []],
            ["B", []],
            ["C", []],
            ["D", []],
            ["E", ["A", "B", "C", "D"]],
        ]);
        const result = toposortLayers(graph);
        expect(result).toEqual([["A", "B", "C", "D"], ["E"]]);
    });

    test("circular dependency throws", () => {
        const graph = new Map([
            ["A", ["B"]],
            ["B", ["A"]],
        ]);
        expect(() => toposortLayers(graph)).toThrow("Circular dependency");
    });

    test("self-loop throws", () => {
        const graph = new Map([["A", ["A"]]]);
        expect(() => toposortLayers(graph)).toThrow("Circular dependency");
    });

    test("deterministic ordering", () => {
        const graph = new Map([
            ["C", []],
            ["A", []],
            ["B", []],
            ["F", ["C", "A"]],
            ["E", ["B", "A"]],
            ["D", ["F", "E"]],
        ]);
        const first = toposortLayers(graph);
        for (let i = 0; i < 10; i++) {
            const result = toposortLayers(graph);
            expect(result).toEqual(first);
        }
        // Elements within layers should be sorted alphabetically
        for (const layer of first) {
            const sorted = [...layer].sort();
            expect(layer).toEqual(sorted);
        }
    });

    test("deep chain with branches", () => {
        // A->B->D->F, A->C->E->F
        const graph = new Map([
            ["A", []],
            ["B", ["A"]],
            ["C", ["A"]],
            ["D", ["B"]],
            ["E", ["C"]],
            ["F", ["D", "E"]],
        ]);
        const result = toposortLayers(graph);
        expect(result).toEqual([["A"], ["B", "C"], ["D", "E"], ["F"]]);
    });
});

describe("pipeline execution", () => {
    test.todo("contracts in same layer build concurrently");
    test.todo("layer N+1 waits for layer N to complete");
    test.todo("error in one contract cascades to dependents");
    test.todo("error in one contract does not affect independent contracts");
    test.todo("build-only mode skips deploy phase");
    test.todo("skip-build mode jumps to deploy");
    test.todo("status callbacks fire in correct order");
    test.todo("empty pipeline succeeds immediately");
    test.todo("single contract works without parallelism overhead");
});
