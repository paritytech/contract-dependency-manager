import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { readCdmLocalJson, resolveFeatures } from "../src/cdm-local-json";

describe("readCdmLocalJson", () => {
    let dir: string;

    beforeEach(() => {
        dir = mkdtempSync(resolve(tmpdir(), "cdm-local-json-"));
    });

    afterEach(() => {
        rmSync(dir, { recursive: true, force: true });
    });

    test("returns null when file does not exist", () => {
        expect(readCdmLocalJson(dir)).toBeNull();
    });

    test("parses valid file", () => {
        writeFileSync(
            resolve(dir, "cdm.local.json"),
            JSON.stringify({ features: ["dev", "extra"] }),
        );
        const result = readCdmLocalJson(dir);
        expect(result).not.toBeNull();
        expect(result!.cdmLocalJson).toEqual({ features: ["dev", "extra"] });
        expect(result!.cdmLocalJsonPath).toBe(resolve(dir, "cdm.local.json"));
    });

    test("throws on malformed JSON with path in message", () => {
        writeFileSync(resolve(dir, "cdm.local.json"), "{not valid json");
        expect(() => readCdmLocalJson(dir)).toThrow(/Invalid JSON.*cdm\.local\.json/s);
    });

    test("throws when top-level value is not an object", () => {
        writeFileSync(resolve(dir, "cdm.local.json"), JSON.stringify(["dev"]));
        expect(() => readCdmLocalJson(dir)).toThrow(/expected an object/);
    });

    test("throws when features is not an array", () => {
        writeFileSync(resolve(dir, "cdm.local.json"), JSON.stringify({ features: "dev" }));
        expect(() => readCdmLocalJson(dir)).toThrow(/"features" must be an array of strings/);
    });

    test("throws when features contains non-string", () => {
        writeFileSync(resolve(dir, "cdm.local.json"), JSON.stringify({ features: ["dev", 42] }));
        expect(() => readCdmLocalJson(dir)).toThrow(/"features" must be an array of strings/);
    });

    test("ignores unknown fields", () => {
        writeFileSync(
            resolve(dir, "cdm.local.json"),
            JSON.stringify({ features: ["dev"], unknown: "ok" }),
        );
        expect(readCdmLocalJson(dir)!.cdmLocalJson).toEqual({ features: ["dev"] });
    });
});

describe("resolveFeatures", () => {
    let dir: string;

    beforeEach(() => {
        dir = mkdtempSync(resolve(tmpdir(), "cdm-local-json-"));
    });

    afterEach(() => {
        rmSync(dir, { recursive: true, force: true });
    });

    test("CLI flag fully replaces file", () => {
        writeFileSync(resolve(dir, "cdm.local.json"), JSON.stringify({ features: ["dev"] }));
        expect(resolveFeatures("prod", dir)).toBe("prod");
    });

    test("falls back to file when CLI undefined", () => {
        writeFileSync(
            resolve(dir, "cdm.local.json"),
            JSON.stringify({ features: ["dev", "extra"] }),
        );
        expect(resolveFeatures(undefined, dir)).toBe("dev,extra");
    });

    test("returns undefined when neither source provides features", () => {
        expect(resolveFeatures(undefined, dir)).toBeUndefined();
    });

    test("returns undefined when file has empty features array", () => {
        writeFileSync(resolve(dir, "cdm.local.json"), JSON.stringify({ features: [] }));
        expect(resolveFeatures(undefined, dir)).toBeUndefined();
    });

    test("returns CLI value even when file missing", () => {
        expect(resolveFeatures("dev", dir)).toBe("dev");
    });
});
