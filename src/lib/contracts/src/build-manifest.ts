import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, resolve } from "path";
import type { ContractToolchain } from "./detection";

export const BUILD_MANIFEST_VERSION = 1;
export const BUILD_MANIFEST_RELATIVE_PATH = "target/cdm/build-manifest.json";

export interface CdmBuildManifestContract {
    name: string;
    displayName?: string;
    toolchain: ContractToolchain;
    cdmPackage: string | null;
    bytecodePath: string;
    abiPath?: string;
    artifactPath?: string;
    sourcePath?: string;
    contractName?: string;
    bytecodeSize?: number;
}

export interface CdmBuildManifest {
    version: typeof BUILD_MANIFEST_VERSION;
    generatedAt: string;
    contracts: CdmBuildManifestContract[];
}

export function buildManifestPath(rootDir: string): string {
    return resolve(rootDir, BUILD_MANIFEST_RELATIVE_PATH);
}

export function writeBuildManifest(rootDir: string, contracts: CdmBuildManifestContract[]): string {
    const path = buildManifestPath(rootDir);
    const manifest: CdmBuildManifest = {
        version: BUILD_MANIFEST_VERSION,
        generatedAt: new Date().toISOString(),
        contracts,
    };
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`);
    return path;
}

export function readBuildManifest(rootDir: string): CdmBuildManifest | null {
    const path = buildManifestPath(rootDir);
    if (!existsSync(path)) return null;
    const manifest = JSON.parse(readFileSync(path, "utf-8")) as CdmBuildManifest;
    if (manifest.version !== BUILD_MANIFEST_VERSION) {
        throw new Error(`Unsupported CDM build manifest version: ${manifest.version}`);
    }
    return manifest;
}

if (import.meta.vitest) {
    const { afterEach, describe, expect, test } = import.meta.vitest;
    const { mkdtempSync, rmSync } = await import("fs");
    const { tmpdir } = await import("os");
    const { join } = await import("path");

    let tmpRoot: string | null = null;

    function makeProject(): string {
        tmpRoot = mkdtempSync(join(tmpdir(), "cdm-build-manifest-test-"));
        return tmpRoot;
    }

    afterEach(() => {
        if (tmpRoot) rmSync(tmpRoot, { recursive: true, force: true });
        tmpRoot = null;
    });

    describe("build manifest", () => {
        test("round-trips normalized contract records", () => {
            const root = makeProject();

            const path = writeBuildManifest(root, [
                {
                    name: "@example/counter",
                    displayName: "@example/counter",
                    toolchain: "foundry",
                    cdmPackage: "@example/counter",
                    bytecodePath: join(root, "target/cdm/foundry/Counter.polkavm"),
                    abiPath: join(root, "out/Counter.sol/Counter.json"),
                    artifactPath: join(root, "out/Counter.sol/Counter.json"),
                    sourcePath: join(root, "contracts/Counter.sol"),
                    contractName: "Counter",
                    bytecodeSize: 4,
                },
            ]);

            expect(path).toBe(buildManifestPath(root));
            expect(readBuildManifest(root)?.contracts).toEqual([
                {
                    name: "@example/counter",
                    displayName: "@example/counter",
                    toolchain: "foundry",
                    cdmPackage: "@example/counter",
                    bytecodePath: join(root, "target/cdm/foundry/Counter.polkavm"),
                    abiPath: join(root, "out/Counter.sol/Counter.json"),
                    artifactPath: join(root, "out/Counter.sol/Counter.json"),
                    sourcePath: join(root, "contracts/Counter.sol"),
                    contractName: "Counter",
                    bytecodeSize: 4,
                },
            ]);
        });
    });
}
