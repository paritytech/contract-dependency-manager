import { afterEach, describe, test, expect } from "vitest";
import { detectContracts, buildDependencyGraph, detectDeploymentOrder } from "../src/detection";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { tmpdir } from "node:os";
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

    test("CDM package names come from [package.metadata.cdm] in Cargo.toml", () => {
        // After the new SDK migration, cdmPackage is resolved at detection
        // time from `[package.metadata.cdm]` (surfaced by `cargo metadata`),
        // not from a post-build `.cdm.json` artifact.
        const contracts = detectContracts(TEMPLATE_DIR);
        const byName = new Map(contracts.map((c) => [c.name, c.cdmPackage]));
        expect(byName.get("counter")).toBe("@example/counter");
        expect(byName.get("counter_writer")).toBe("@example/counter-writer");
        expect(byName.get("counter_reader")).toBe("@example/counter-reader");
    });
});

describe("detection skips PVM crates without cdm metadata", () => {
    let tmpRoot: string | null = null;

    afterEach(() => {
        if (tmpRoot) rmSync(tmpRoot, { recursive: true, force: true });
        tmpRoot = null;
    });

    test("crate with pvm-contract-sdk + bin but no cdm metadata is excluded", () => {
        // Build a minimal Cargo workspace with two members:
        //   - `good`: declares [package.metadata.cdm], should be detected
        //   - `harness`: depends on pvm-contract-sdk with a [[bin]] target but
        //     has no cdm metadata — modelling cdm-import-test in this repo.
        //     Detection must silently skip it.
        tmpRoot = mkdtempSync(join(tmpdir(), "cdm-detection-skip-"));

        writeFileSync(
            join(tmpRoot, "Cargo.toml"),
            [
                "[workspace]",
                'resolver = "2"',
                'members = ["good", "harness"]',
                "",
                "[workspace.dependencies]",
                'pvm-contract-sdk = "0.0.1"',
                "",
            ].join("\n"),
        );

        // Detection only inspects manifests; the dep doesn't need to resolve,
        // so we point both crates at a local stub path to keep `cargo metadata
        // --no-deps` self-contained.
        const sdkStub = join(tmpRoot, "pvm-contract-sdk-stub");
        mkdirSync(join(sdkStub, "src"), { recursive: true });
        writeFileSync(
            join(sdkStub, "Cargo.toml"),
            [
                "[package]",
                'name = "pvm-contract-sdk"',
                'version = "0.0.1"',
                'edition = "2021"',
                "",
                "[lib]",
                'path = "src/lib.rs"',
                "",
            ].join("\n"),
        );
        writeFileSync(join(sdkStub, "src", "lib.rs"), "");

        const goodDir = join(tmpRoot, "good");
        mkdirSync(join(goodDir, "src"), { recursive: true });
        writeFileSync(
            join(goodDir, "Cargo.toml"),
            [
                "[package]",
                'name = "good"',
                'version = "0.1.0"',
                'edition = "2021"',
                "",
                "[package.metadata.cdm]",
                'package = "@test/good"',
                "",
                "[[bin]]",
                'name = "good"',
                'path = "src/main.rs"',
                "",
                "[dependencies]",
                'pvm-contract-sdk = { path = "../pvm-contract-sdk-stub" }',
                "",
            ].join("\n"),
        );
        writeFileSync(join(goodDir, "src", "main.rs"), "fn main() {}\n");

        const harnessDir = join(tmpRoot, "harness");
        mkdirSync(join(harnessDir, "src"), { recursive: true });
        writeFileSync(
            join(harnessDir, "Cargo.toml"),
            [
                "[package]",
                'name = "harness"',
                'version = "0.1.0"',
                'edition = "2021"',
                "",
                "[[bin]]",
                'name = "harness"',
                'path = "src/main.rs"',
                "",
                "[dependencies]",
                'pvm-contract-sdk = { path = "../pvm-contract-sdk-stub" }',
                "",
            ].join("\n"),
        );
        writeFileSync(join(harnessDir, "src", "main.rs"), "fn main() {}\n");

        const contracts = detectContracts(tmpRoot);
        const names = contracts.map((c) => c.name).sort();
        expect(names).toEqual(["good"]);
        expect(contracts[0].cdmPackage).toBe("@test/good");
    });

    test("accepts legacy [package.metadata.cdm].name during migration", () => {
        tmpRoot = mkdtempSync(join(tmpdir(), "cdm-detection-legacy-name-"));

        writeFileSync(
            join(tmpRoot, "Cargo.toml"),
            ["[workspace]", 'resolver = "2"', 'members = ["legacy"]', ""].join("\n"),
        );

        const sdkStub = join(tmpRoot, "pvm-contract-sdk-stub");
        mkdirSync(join(sdkStub, "src"), { recursive: true });
        writeFileSync(
            join(sdkStub, "Cargo.toml"),
            [
                "[package]",
                'name = "pvm-contract-sdk"',
                'version = "0.0.1"',
                'edition = "2021"',
                "",
                "[lib]",
                'path = "src/lib.rs"',
                "",
            ].join("\n"),
        );
        writeFileSync(join(sdkStub, "src", "lib.rs"), "");

        const legacyDir = join(tmpRoot, "legacy");
        mkdirSync(join(legacyDir, "src"), { recursive: true });
        writeFileSync(
            join(legacyDir, "Cargo.toml"),
            [
                "[package]",
                'name = "legacy"',
                'version = "0.1.0"',
                'edition = "2021"',
                "",
                "[package.metadata.cdm]",
                'name = "@test/legacy"',
                "",
                "[[bin]]",
                'name = "legacy"',
                'path = "src/main.rs"',
                "",
                "[dependencies]",
                'pvm-contract-sdk = { path = "../pvm-contract-sdk-stub" }',
                "",
            ].join("\n"),
        );
        writeFileSync(join(legacyDir, "src", "main.rs"), "fn main() {}\n");

        const contracts = detectContracts(tmpRoot);
        expect(contracts.map((c) => c.name)).toEqual(["legacy"]);
        expect(contracts[0].cdmPackage).toBe("@test/legacy");
    });
});
