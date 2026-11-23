#!/usr/bin/env bun
/**
 * Rebuild and re-freeze src/contract/create3/artifacts/ (both blobs +
 * manifest.json). The child blob's hash feeds every CREATE3 address and the
 * factory blob pins the factory's own address, so this is a deliberate act
 * that moves every address derived from then on: afterwards update
 * CREATE3_CHILD_CODE_HASH and CREATE3_FACTORY_CODE_HASH in
 * src/lib/contracts/src/create3.ts.
 *
 * Run: bun run src/lib/scripts/freeze-create3-artifacts.ts
 */
import { spawnSync } from "child_process";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join, resolve } from "path";
import { keccakCodeHash } from "@parity/cdm-builder";

const ROOT = resolve(import.meta.dir, "../../..");
const ARTIFACTS_DIR = join(ROOT, "src/contract/create3/artifacts");
const BLOBS = ["create3-factory", "create3-child"];

mkdirSync(ARTIFACTS_DIR, { recursive: true });
const manifest: Record<string, string | { codeHash: string; bytes: number }> = {
    comment:
        "FROZEN CREATE3 artifacts. These exact bytes are part of every CREATE3-derived address: the child code hash feeds create2, and the factory blob pins the factory address. Never rebuild or replace them casually — regenerate deliberately with src/lib/scripts/freeze-create3-artifacts.ts and see src/contract/create3/README.md.",
};

for (const blob of BLOBS) {
    console.log(`Building ${blob} with cargo pvm-contract...`);
    const build = spawnSync(
        "cargo",
        ["pvm-contract", "build", "--manifest-path", join(ROOT, "Cargo.toml"), "-p", blob],
        { stdio: "inherit" },
    );
    if (build.status !== 0) {
        console.error("cargo pvm-contract build failed");
        process.exit(build.status ?? 1);
    }
    const built = join(ROOT, `target/release/${blob}.polkavm`);
    const bytes = new Uint8Array(readFileSync(built));
    copyFileSync(built, join(ARTIFACTS_DIR, `${blob}.polkavm`));
    manifest[`${blob}.polkavm`] = { codeHash: keccakCodeHash(bytes), bytes: bytes.length };
    console.log(`Froze ${blob}: ${bytes.length} bytes, code hash ${keccakCodeHash(bytes)}`);
}

writeFileSync(join(ARTIFACTS_DIR, "manifest.json"), `${JSON.stringify(manifest, null, 4)}\n`);
console.log(
    "If a hash changed, update CREATE3_CHILD_CODE_HASH and CREATE3_FACTORY_CODE_HASH in " +
        "src/lib/contracts/src/create3.ts.",
);
