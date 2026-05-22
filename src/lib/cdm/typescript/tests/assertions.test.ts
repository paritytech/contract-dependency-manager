import { describe, expect, test } from "vitest";
import { expectOk, expectRevert } from "../src/test/assertions";

describe("expectOk", () => {
    test("resolves silently on ok=true", async () => {
        await expectOk(Promise.resolve({ ok: true }));
    });

    test("throws on ok=false", async () => {
        await expect(expectOk(Promise.resolve({ ok: false }))).rejects.toThrow(
            "tx returned ok=false",
        );
    });

    test("throws with label prefix when provided", async () => {
        await expect(expectOk(Promise.resolve({ ok: false }), "my call")).rejects.toThrow(
            "my call: tx returned ok=false",
        );
    });

    test("propagates underlying rejection", async () => {
        await expect(expectOk(Promise.reject(new Error("boom")))).rejects.toThrow("boom");
    });
});

describe("expectRevert", () => {
    test("resolves on ok=false", async () => {
        await expectRevert(Promise.resolve({ ok: false }));
    });

    test("resolves when the promise throws (dry-run revert)", async () => {
        await expectRevert(Promise.reject(new Error("dry-run failure")));
    });

    test("throws on ok=true", async () => {
        await expect(expectRevert(Promise.resolve({ ok: true }))).rejects.toThrow(
            "expected revert, got ok=true",
        );
    });

    test("throws with label prefix when provided", async () => {
        await expect(
            expectRevert(Promise.resolve({ ok: true }), "unauthorized call"),
        ).rejects.toThrow("unauthorized call: expected revert, got ok=true");
    });
});
