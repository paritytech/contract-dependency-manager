import { existsSync, readFileSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { keccakCodeHash } from "./create3";

/**
 * Frozen per-name proxy blob (`contract-proxy`). Every future per-name
 * address is `create2(registry, keccak(blob), keccak(name))`, so rebuilding
 * the blob moves every address the registry derives from then on. Regenerate
 * only with `bun run src/lib/scripts/freeze-proxy-artifact.ts`.
 */

export const CONTRACT_PROXY_ARTIFACTS_DIR = "src/contract/proxy/artifacts";

/** keccak-256 of the committed blob; the tests pin it to the manifest and the bytes. */
export const CONTRACT_PROXY_CODE_HASH =
    "0x9c918a8b6fb50007becfcf66fdbc2ceed18060b3a75f6721669601083a542e86";

export interface FrozenContractProxyArtifact {
    bytes: Uint8Array;
    /** keccak-256 of `bytes`, 0x-prefixed. */
    codeHash: `0x${string}`;
}

type ProxyManifestEntry = { codeHash?: unknown };

/** Load and hash-verify the committed per-name proxy blob. */
export function loadContractProxyArtifact(rootDir: string): FrozenContractProxyArtifact {
    const fileName = "contract-proxy.polkavm";
    const dir = resolve(rootDir, CONTRACT_PROXY_ARTIFACTS_DIR);
    const manifestPath = resolve(dir, "manifest.json");
    const blobPath = resolve(dir, fileName);
    if (!existsSync(manifestPath) || !existsSync(blobPath)) {
        throw new Error(
            `Frozen per-name proxy artifact ${fileName} not found under ${dir} — ` +
                "run the registry deploy from a repo checkout.",
        );
    }
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Record<
        string,
        ProxyManifestEntry | string
    >;
    const entry = manifest[fileName];
    if (!entry || typeof entry === "string" || typeof entry.codeHash !== "string") {
        throw new Error(`No codeHash for ${fileName} in ${manifestPath}`);
    }
    const expected = entry.codeHash.toLowerCase();
    const bytes = new Uint8Array(readFileSync(blobPath));
    const actual = keccakCodeHash(bytes);
    if (actual !== expected) {
        throw new Error(
            `Frozen per-name proxy artifact ${fileName} does not match its manifest hash ` +
                `(manifest ${expected}, blob ${actual}) — restore the committed bytes.`,
        );
    }
    return { bytes, codeHash: actual };
}

if (import.meta.vitest) {
    const { describe, test, expect } = import.meta.vitest;

    const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");

    describe("frozen contract-proxy artifact", () => {
        test("blob hashes to its manifest entry and embedded constant", () => {
            const { bytes, codeHash } = loadContractProxyArtifact(repoRoot);
            expect(bytes.length).toBeGreaterThan(0);
            expect(codeHash).toBe(CONTRACT_PROXY_CODE_HASH);
        });

        test("manifest byte count matches the committed blob", () => {
            const manifest = JSON.parse(
                readFileSync(
                    resolve(repoRoot, CONTRACT_PROXY_ARTIFACTS_DIR, "manifest.json"),
                    "utf8",
                ),
            ) as Record<string, { codeHash: string; bytes: number }>;
            const entry = manifest["contract-proxy.polkavm"];
            expect(entry.codeHash).toBe(CONTRACT_PROXY_CODE_HASH);
            expect(entry.bytes).toBe(loadContractProxyArtifact(repoRoot).bytes.length);
        });
    });
}
