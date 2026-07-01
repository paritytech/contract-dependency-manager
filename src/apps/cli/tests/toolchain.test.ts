import { describe, expect, test } from "vitest";
import {
    createToolSteps,
    releaseAssetName,
    runToolchainSetup,
    type ToolStepEvent,
} from "../src/lib/toolchain";
import { normalizeReleaseTag, selectReleaseTag } from "../src/lib/releases";

describe("toolchain setup", () => {
    test("check mode fails missing steps without installing", async () => {
        let installed = false;
        const events: ToolStepEvent[] = [];

        await expect(
            runToolchainSetup({
                install: false,
                steps: [
                    {
                        name: "missing",
                        check: async () => false,
                        install: async () => {
                            installed = true;
                        },
                    },
                ],
                onEvent: (event) => events.push(event),
            }),
        ).rejects.toThrow("Missing dependency: missing");

        expect(installed).toBe(false);
        expect(events.map((event) => event.status)).toEqual(["checking", "failed"]);
    });

    test("installs missing steps and emits status events", async () => {
        const events: ToolStepEvent[] = [];
        let installed = false;

        await runToolchainSetup({
            steps: [
                {
                    name: "ready",
                    check: async () => true,
                    install: async () => {
                        throw new Error("should not install ready step");
                    },
                },
                {
                    name: "missing",
                    check: async () => installed,
                    install: async () => {
                        installed = true;
                    },
                },
            ],
            onEvent: (event) => events.push(event),
        });

        expect(installed).toBe(true);
        expect(events.map((event) => `${event.step.name}:${event.status}`)).toEqual([
            "ready:checking",
            "ready:ok",
            "missing:checking",
            "missing:installing",
            "missing:ok",
        ]);
    });

    test("release assets match installer naming", () => {
        expect(releaseAssetName("darwin", "arm64")).toBe("cdm-darwin-arm64");
        expect(releaseAssetName("linux", "x64")).toBe("cdm-linux-x64");
    });

    test("release tag normalization matches installer behavior", () => {
        expect(normalizeReleaseTag("0.8.25")).toBe("v0.8.25");
        expect(normalizeReleaseTag("v0.8.25")).toBe("v0.8.25");
        expect(normalizeReleaseTag("cdm-cli-dev-pr-58")).toBe("cdm-cli-dev-pr-58");
        expect(normalizeReleaseTag("branch/name")).toBe("branch/name");
        expect(selectReleaseTag("", "  ", "dev")).toBe("dev");
    });

    test("cargo-pvm-contract step accepts a custom ref", () => {
        const step = createToolSteps({ ref: "charles/cdm-integration" }).find(
            (entry) => entry.name === "cargo-pvm-contract",
        );

        expect(step?.manualHint).toContain("charles/cdm-integration");
    });
});
