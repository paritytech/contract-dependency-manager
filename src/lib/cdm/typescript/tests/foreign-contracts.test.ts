import { describe, expect, test } from "vitest";
import { cachePathFor, parsePackageSpec } from "../src/test/foreign-contracts";

describe("parsePackageSpec", () => {
    test("parses numeric version", () => {
        expect(parsePackageSpec("@polkadot/contexts:3")).toEqual({
            name: "@polkadot/contexts",
            version: 3,
        });
    });

    test("parses :latest", () => {
        expect(parsePackageSpec("@polkadot/contexts:latest")).toEqual({
            name: "@polkadot/contexts",
            version: "latest",
        });
    });

    test("no colon implies latest", () => {
        expect(parsePackageSpec("@polkadot/contexts")).toEqual({
            name: "@polkadot/contexts",
            version: "latest",
        });
    });

    test("handles unscoped names", () => {
        expect(parsePackageSpec("foo:7")).toEqual({ name: "foo", version: 7 });
    });

    test("rejects non-numeric, non-latest version → treats whole string as name", () => {
        expect(parsePackageSpec("@polkadot/contexts:beta")).toEqual({
            name: "@polkadot/contexts:beta",
            version: "latest",
        });
    });

    test("rejects negative versions", () => {
        expect(parsePackageSpec("@polkadot/contexts:-1")).toEqual({
            name: "@polkadot/contexts:-1",
            version: "latest",
        });
    });

    test("rejects floats", () => {
        expect(parsePackageSpec("@polkadot/contexts:3.5")).toEqual({
            name: "@polkadot/contexts:3.5",
            version: "latest",
        });
    });

    test("treats leading-colon strings as name-only (no implicit version)", () => {
        expect(parsePackageSpec(":3")).toEqual({ name: ":3", version: "latest" });
    });
});

describe("cachePathFor", () => {
    test("structures path as cacheDir/<pkg-slug>/v<N>@<chain>.polkavm", () => {
        const path = cachePathFor("@polkadot/contexts", 3, "paseo", "/tmp/cache");
        expect(path).toBe("/tmp/cache/polkadot/contexts/v3@paseo.polkavm");
    });

    test("strips leading @ in slug", () => {
        expect(cachePathFor("@org/pkg", 1, "paseo", "/c")).toMatch(/\/org\/pkg\//);
    });

    test("preserves slash for nested package names", () => {
        expect(cachePathFor("@org/sub/pkg", 1, "paseo", "/c")).toBe(
            "/c/org/sub/pkg/v1@paseo.polkavm",
        );
    });

    test("sanitizes unsafe characters in package name", () => {
        // Hypothetical malformed name — should not produce a path with shell metachars
        const path = cachePathFor("foo;rm -rf /", 1, "paseo", "/c");
        expect(path).not.toMatch(/[;\s]/);
        expect(path).toMatch(/^\/c\//);
    });

    test("includes resolved version and source chain in filename", () => {
        const path = cachePathFor("@polkadot/contexts", 42, "preview-net", "/c");
        expect(path).toBe("/c/polkadot/contexts/v42@preview-net.polkavm");
    });
});
