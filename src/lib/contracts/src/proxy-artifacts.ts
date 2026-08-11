import { existsSync, readFileSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { keccakCodeHash } from "./create3";

/**
 * Frozen artifact for the per-name CDM proxy (`contract-proxy`, see
 * src/contract/proxy/). The registry CREATE2-instantiates one proxy per
 * contract name from this blob at first publish — under pallet-revive,
 * `address = create2(registry, keccak(blob), keccak(name))` — so the blob
 * bytes are part of every FUTURE per-name address. Like the CREATE3
 * artifacts, the blob is committed and hash-pinned: rebuilding it moves every
 * address the registry would derive from then on (existing proxies keep
 * their code and address forever).
 *
 * Regenerate deliberately with `bun run src/lib/scripts/freeze-proxy-artifact.ts`.
 */

/** Repo-relative directory holding the frozen per-name proxy artifact. */
export const CONTRACT_PROXY_ARTIFACTS_DIR = "src/contract/proxy/artifacts";

/**
 * keccak-256 of the committed `contract-proxy.polkavm` blob — the code hash
 * the registry's `setProxyCodeHash` is fed and every per-name CREATE2 address
 * commits to. Embedded as a constant so address predictions work without a
 * repo checkout; the in-source tests assert it agrees with
 * `artifacts/manifest.json` and with the blob bytes themselves.
 */
export const CONTRACT_PROXY_CODE_HASH =
    "0x45ee39059fc2d80e7f85079c300a2099b801747577c0a46fd3fd962fb843416e";

/** The frozen per-name proxy blob loaded from the repo, hash-verified. */
export interface FrozenContractProxyArtifact {
    bytes: Uint8Array;
    /** keccak-256 of `bytes` — the pallet-revive code hash, 0x-prefixed. */
    codeHash: `0x${string}`;
}

type ProxyManifestEntry = { codeHash?: unknown };

/** Load + hash-verify the committed per-name proxy blob (`contract-proxy.polkavm`). */
export function loadContractProxyArtifact(rootDir: string): FrozenContractProxyArtifact {
    const fileName = "contract-proxy.polkavm";
    const dir = resolve(rootDir, CONTRACT_PROXY_ARTIFACTS_DIR);
    const manifestPath = resolve(dir, "manifest.json");
    const blobPath = resolve(dir, fileName);
    if (!existsSync(manifestPath) || !existsSync(blobPath)) {
        throw new Error(
            `Frozen per-name proxy artifact ${fileName} not found under ${dir}. ` +
                "The committed artifacts ship with the contract-dependency-manager repo — " +
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
                `(manifest ${expected}, blob ${actual}). The frozen blob is part of every ` +
                "future per-name proxy address and must never be rebuilt casually — " +
                "restore the committed bytes.",
        );
    }
    return { bytes, codeHash: actual };
}

if (import.meta.vitest) {
    const { describe, test, expect } = import.meta.vitest;

    // src/lib/contracts/src -> repo root is 4 levels up.
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
