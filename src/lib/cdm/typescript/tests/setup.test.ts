import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import type { CdmJson } from "@parity/cdm-builder";
import { makeCdm } from "../src/test/setup";
import { Alice } from "../src/test/accounts";

describe("makeCdm", () => {
    let dir: string;
    beforeEach(() => {
        dir = mkdtempSync(resolve(tmpdir(), "cdm-test-"));
    });
    afterEach(() => {
        rmSync(dir, { recursive: true, force: true });
    });

    test("reads cdm.json from rootDir and constructs a Cdm", () => {
        const cdmJson: CdmJson = {
            dependencies: {},
            contracts: {},
            registry: "0x0000000000000000000000000000000000000000",
        };
        writeFileSync(resolve(dir, "cdm.json"), JSON.stringify(cdmJson));

        const cdm = makeCdm({ rootDir: dir, signer: Alice.signer, origin: Alice.ss58 });
        expect(cdm).toBeDefined();
    });

    test("throws with a helpful message when cdm.json is missing", () => {
        expect(() => makeCdm({ rootDir: dir, signer: Alice.signer, origin: Alice.ss58 })).toThrow(
            /cdm\.json not found/,
        );
    });
});
