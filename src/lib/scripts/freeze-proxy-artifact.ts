#!/usr/bin/env bun
/**
 * Rebuild and re-freeze the per-name contract proxy artifact
 * (src/contract/proxy/artifacts/): builds `contract-proxy` with the mainline
 * cargo-pvm-contract, copies the blob next to a regenerated manifest.json,
 * and prints the new code hash.
 *
 * The frozen blob's code hash feeds every per-name proxy CREATE2 address the
 * registry derives from then on — re-freezing is a DELIBERATE act, not part
 * of any routine build. After regenerating, update CONTRACT_PROXY_CODE_HASH
 * in src/lib/contracts/src/proxy-artifacts.ts to match and run
 * `setProxyCodeHash` on live registries (existing per-name proxies keep
 * their old code and addresses).
 *
 * Run: bun run src/lib/scripts/freeze-proxy-artifact.ts
 * Output: src/contract/proxy/artifacts/{contract-proxy.polkavm,manifest.json}
 */
import { spawnSync } from "child_process";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join, resolve } from "path";
import { keccakCodeHash } from "@parity/cdm-builder";

const ROOT = resolve(import.meta.dir, "../../..");
const BLOB = join(ROOT, "target/release/contract-proxy.polkavm");
const ARTIFACTS_DIR = join(ROOT, "src/contract/proxy/artifacts");

console.log("Building contract-proxy with cargo pvm-contract...");
const build = spawnSync(
    "cargo",
    ["pvm-contract", "build", "--manifest-path", join(ROOT, "Cargo.toml"), "-p", "contract-proxy"],
    { stdio: "inherit" },
);
if (build.status !== 0) {
    console.error("cargo pvm-contract build failed");
    process.exit(build.status ?? 1);
}

const bytes = new Uint8Array(readFileSync(BLOB));
const codeHash = keccakCodeHash(bytes);

mkdirSync(ARTIFACTS_DIR, { recursive: true });
copyFileSync(BLOB, join(ARTIFACTS_DIR, "contract-proxy.polkavm"));
writeFileSync(
    join(ARTIFACTS_DIR, "manifest.json"),
    `${JSON.stringify(
        {
            comment:
                "FROZEN per-name proxy artifact. The registry CREATE2-instantiates one proxy per contract name from this blob's code hash (salt = keccak256(name), empty constructor input, deployer = the registry proxy), so these exact bytes are part of every FUTURE per-name address. Never rebuild or replace casually — regenerate deliberately with src/lib/scripts/freeze-proxy-artifact.ts and see src/contract/proxy/src/main.rs.",
            "contract-proxy.polkavm": { codeHash, bytes: bytes.length },
        },
        null,
        4,
    )}\n`,
);

console.log(`Froze ${bytes.length} bytes at ${join(ARTIFACTS_DIR, "contract-proxy.polkavm")}`);
console.log(`CONTRACT_PROXY_CODE_HASH=${codeHash}`);
console.log(
    "If the hash changed, update CONTRACT_PROXY_CODE_HASH in " +
        "src/lib/contracts/src/proxy-artifacts.ts and run setProxyCodeHash on live registries.",
);
