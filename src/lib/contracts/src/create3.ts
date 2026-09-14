import { keccak_256 } from "@noble/hashes/sha3.js";
import { existsSync, readFileSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

/**
 * Offline mirror of the CREATE3 address scheme implemented by the frozen
 * factory/child contract pair under `src/contract/create3/`:
 *
 *   child  = create2(factory, childCodeHash, salt)
 *   target = create1(child, 1)
 *
 * so a target address is a pure function of `(factory address, salt)` —
 * independent of the target's bytecode AND its constructor input. This is
 * what makes the registry proxy address survive bytecode changes: under
 * pallet-revive, plain CREATE2 commits to both.
 *
 * The derivations mirror pallet-revive's `address.rs` (`create1`/`create2`)
 * and the factory's own in-contract math; the in-source tests pin them to
 * pallet-revive's `create1_works` vector and the EIP-1014 example.
 */

/** Repo-relative directory holding the frozen CREATE3 artifacts. */
export const CREATE3_ARTIFACTS_DIR = "src/contract/create3/artifacts";

/**
 * keccak-256 of the committed `create3-child.polkavm` blob. Every CREATE3
 * address commits to it (it feeds the create2 step), so it is embedded here
 * as a constant rather than read from disk — `predictCreate3Address` must
 * work without a repo checkout. The in-source tests assert it agrees with
 * `artifacts/manifest.json` and with the blob bytes themselves.
 */
export const CREATE3_CHILD_CODE_HASH =
    "0xaad31d44ab9f4d37f4b1ea94f87a8cbcd332fb1ae94bced7cbdde7e87857e94a";

/** keccak-256 of the committed `create3-factory.polkavm` blob. */
export const CREATE3_FACTORY_CODE_HASH =
    "0x325b451797bd0c8b5c174778ffe7fb711e23396908c592b5e475b860c53e0330";

function toBytes(hex: string, expectedLength: number, what: string): Uint8Array {
    const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
    if (!new RegExp(`^[0-9a-fA-F]{${expectedLength * 2}}$`).test(clean)) {
        throw new Error(`Invalid ${what}: expected ${expectedLength} bytes of hex, got ${hex}`);
    }
    const bytes = new Uint8Array(expectedLength);
    for (let i = 0; i < expectedLength; i++) {
        bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
    }
    return bytes;
}

function toHex(bytes: Uint8Array): `0x${string}` {
    let out = "0x";
    for (const b of bytes) out += b.toString(16).padStart(2, "0");
    return out as `0x${string}`;
}

/** keccak-256 of a code blob — pallet-revive's code hash. */
export function keccakCodeHash(code: Uint8Array): `0x${string}` {
    return toHex(keccak_256(code));
}

/**
 * Ethereum CREATE1 address at nonce 1: `keccak256(rlp([deployer, 1]))[12..]`.
 * RLP of a 20-byte string and the integer 1 is fixed-shape:
 * `0xd6 0x94 <20 bytes> 0x01`. Nonce 1 is the only case CREATE3 needs —
 * revive initializes contract nonces to 1 at birth, so the child's single
 * instantiate always happens at nonce 1.
 */
export function create1AddressAtNonce1(deployer: Uint8Array): Uint8Array {
    if (deployer.length !== 20) {
        throw new Error(`create1: deployer must be 20 bytes, got ${deployer.length}`);
    }
    const preimage = new Uint8Array(23);
    preimage[0] = 0xd6; // RLP list, payload length 22
    preimage[1] = 0x94; // RLP string, length 20
    preimage.set(deployer, 2);
    preimage[22] = 0x01; // nonce 1
    return keccak_256(preimage).slice(12);
}

/**
 * EIP-1014 CREATE2 address:
 * `keccak256(0xff ++ deployer ++ salt ++ initCodeHash)[12..]`.
 */
export function create2Address(
    deployer: Uint8Array,
    salt: Uint8Array,
    initCodeHash: Uint8Array,
): Uint8Array {
    if (deployer.length !== 20) {
        throw new Error(`create2: deployer must be 20 bytes, got ${deployer.length}`);
    }
    if (salt.length !== 32) {
        throw new Error(`create2: salt must be 32 bytes, got ${salt.length}`);
    }
    if (initCodeHash.length !== 32) {
        throw new Error(`create2: initCodeHash must be 32 bytes, got ${initCodeHash.length}`);
    }
    const preimage = new Uint8Array(85);
    preimage[0] = 0xff;
    preimage.set(deployer, 1);
    preimage.set(salt, 21);
    preimage.set(initCodeHash, 53);
    return keccak_256(preimage).slice(12);
}

/**
 * The address `factory.deploy(salt, ..)` will (or did) produce — a pure
 * function of the factory address and the salt. Matches the factory's
 * on-chain `predict(salt)`.
 *
 * `salt` is 32 bytes, raw or 0x-hex. `childCodeHash` defaults to the
 * committed child blob's hash and only needs overriding for a factory
 * constructed with a different child (never ours).
 */
export function predictCreate3Address(
    factory: string,
    salt: Uint8Array | string,
    childCodeHash: Uint8Array = toBytes(CREATE3_CHILD_CODE_HASH, 32, "child code hash"),
): string {
    const factoryBytes = toBytes(factory, 20, "factory address");
    const saltBytes = typeof salt === "string" ? toBytes(salt, 32, "salt") : salt;
    const child = create2Address(factoryBytes, saltBytes, childCodeHash);
    return toHex(create1AddressAtNonce1(child));
}

/**
 * pallet-revive CREATE2 for a plain `instantiate_with_code` deploy: unlike
 * EVM CREATE2, revive's init-code hash commits to the constructor input too
 * (`keccak256(code ++ inputData)` — see polkadot-sdk
 * `substrate/frame/revive/src/address.rs`). This predicts where the CREATE3
 * factory itself (and the registry implementation blob) land.
 */
export function predictReviveCreate2Address(
    deployer: string,
    code: Uint8Array,
    inputData: Uint8Array,
    salt: Uint8Array,
): string {
    const initCode = new Uint8Array(code.length + inputData.length);
    initCode.set(code, 0);
    initCode.set(inputData, code.length);
    return toHex(
        create2Address(toBytes(deployer, 20, "deployer address"), salt, keccak_256(initCode)),
    );
}

/**
 * The H160 pallet-revive assigns to a signer's AccountId32 — mirror of
 * `AccountId32Mapper::to_address`: eth-derived accounts (last 12 bytes all
 * `0xEE`) are truncated to their original 20 bytes; genuine sr25519/ed25519
 * keys are keccak-hashed first to avoid truncating the public key.
 */
export function eoaH160FromPublicKey(publicKey: Uint8Array): string {
    if (publicKey.length !== 32) {
        throw new Error(`Expected a 32-byte AccountId public key, got ${publicKey.length} bytes`);
    }
    const isEthDerived = publicKey.slice(20).every((b) => b === 0xee);
    return toHex(isEthDerived ? publicKey.slice(0, 20) : keccak_256(publicKey).slice(12));
}

/** A frozen CREATE3 blob loaded from the repo, hash-verified. */
export interface FrozenCreate3Artifact {
    bytes: Uint8Array;
    /** keccak-256 of `bytes` — the pallet-revive code hash, 0x-prefixed. */
    codeHash: `0x${string}`;
}

type Create3ManifestEntry = { codeHash?: unknown };

function loadFrozenArtifact(
    rootDir: string,
    fileName: "create3-factory.polkavm" | "create3-child.polkavm",
): FrozenCreate3Artifact {
    const dir = resolve(rootDir, CREATE3_ARTIFACTS_DIR);
    const manifestPath = resolve(dir, "manifest.json");
    const blobPath = resolve(dir, fileName);
    if (!existsSync(manifestPath) || !existsSync(blobPath)) {
        throw new Error(
            `Frozen CREATE3 artifact ${fileName} not found under ${dir}. ` +
                "The committed artifacts ship with the contract-dependency-manager repo — " +
                "run the registry deploy from a repo checkout.",
        );
    }
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Record<
        string,
        Create3ManifestEntry | string
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
            `Frozen CREATE3 artifact ${fileName} does not match its manifest hash ` +
                `(manifest ${expected}, blob ${actual}). The frozen blobs are part of every ` +
                "CREATE3-derived address and must never be rebuilt — restore the committed bytes.",
        );
    }
    return { bytes, codeHash: actual };
}

/** Load + hash-verify the committed factory blob (`create3-factory.polkavm`). */
export function loadCreate3FactoryArtifact(rootDir: string): FrozenCreate3Artifact {
    return loadFrozenArtifact(rootDir, "create3-factory.polkavm");
}

/** Load + hash-verify the committed child blob (`create3-child.polkavm`). */
export function loadCreate3ChildArtifact(rootDir: string): FrozenCreate3Artifact {
    return loadFrozenArtifact(rootDir, "create3-child.polkavm");
}

if (import.meta.vitest) {
    const { describe, test, expect } = import.meta.vitest;

    // src/lib/contracts/src -> repo root is 4 levels up.
    const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");

    describe("create1AddressAtNonce1", () => {
        test("matches pallet-revive's create1_works vector", () => {
            // polkadot-sdk substrate/frame/revive/src/address.rs:
            // create1([0x01; 20], 1) == c851da37e4e8d3a20d8d56be2963934b4ad71c3b
            expect(toHex(create1AddressAtNonce1(new Uint8Array(20).fill(0x01)))).toBe(
                "0xc851da37e4e8d3a20d8d56be2963934b4ad71c3b",
            );
        });

        test("rejects non-20-byte deployers", () => {
            expect(() => create1AddressAtNonce1(new Uint8Array(32))).toThrow();
        });
    });

    describe("create2Address", () => {
        test("matches the EIP-1014 example", () => {
            // deployer 0x00000000000000000000000000000000deadbeef,
            // salt 0x…cafebabe, init_code 0xdeadbeef
            // -> 0x60f3f640a8508fC6a86d45DF051962668E1e8AC7
            const deployer = toBytes("0x00000000000000000000000000000000deadbeef", 20, "deployer");
            const salt = new Uint8Array(32);
            salt.set([0xca, 0xfe, 0xba, 0xbe], 28);
            const initCodeHash = keccak_256(new Uint8Array([0xde, 0xad, 0xbe, 0xef]));
            expect(toHex(create2Address(deployer, salt, initCodeHash))).toBe(
                "0x60f3f640a8508fc6a86d45df051962668e1e8ac7",
            );
        });
    });

    describe("predictCreate3Address", () => {
        test("composes create2 then create1(nonce 1)", () => {
            const factory = "0xfafafafafafafafafafafafafafafafafafafafa";
            const salt = new Uint8Array(32).fill(0x5a);
            const child = create2Address(
                toBytes(factory, 20, "factory"),
                salt,
                toBytes(CREATE3_CHILD_CODE_HASH, 32, "child code hash"),
            );
            expect(predictCreate3Address(factory, salt)).toBe(toHex(create1AddressAtNonce1(child)));
        });

        test("is independent of the child code hash only via the default", () => {
            const factory = "0xfafafafafafafafafafafafafafafafafafafafa";
            const salt = new Uint8Array(32).fill(0x5a);
            const otherChild = new Uint8Array(32).fill(0x01);
            expect(predictCreate3Address(factory, salt, otherChild)).not.toBe(
                predictCreate3Address(factory, salt),
            );
        });
    });

    describe("predictReviveCreate2Address", () => {
        test("commits to constructor input data (unlike EVM CREATE2)", () => {
            const deployer = "0x1111111111111111111111111111111111111111";
            const code = new Uint8Array([1, 2, 3]);
            const salt = new Uint8Array(32);
            expect(predictReviveCreate2Address(deployer, code, new Uint8Array(0), salt)).not.toBe(
                predictReviveCreate2Address(deployer, code, new Uint8Array([4]), salt),
            );
        });

        test("init-code hash is keccak(code ++ input)", () => {
            const deployer = "0x1111111111111111111111111111111111111111";
            const code = new Uint8Array([1, 2, 3]);
            const input = new Uint8Array([4, 5]);
            const salt = new Uint8Array(32).fill(7);
            const expected = toHex(
                create2Address(
                    toBytes(deployer, 20, "deployer"),
                    salt,
                    keccak_256(new Uint8Array([1, 2, 3, 4, 5])),
                ),
            );
            expect(predictReviveCreate2Address(deployer, code, input, salt)).toBe(expected);
        });
    });

    describe("eoaH160FromPublicKey", () => {
        test("keccak-hashes genuine 32-byte substrate keys", () => {
            const pubkey = new Uint8Array(32).fill(0xab);
            expect(eoaH160FromPublicKey(pubkey)).toBe(toHex(keccak_256(pubkey).slice(12)));
        });

        test("strips the 0xEE suffix from eth-derived accounts", () => {
            const pubkey = new Uint8Array(32).fill(0xee);
            pubkey.set(new Uint8Array(20).fill(0x42), 0);
            expect(eoaH160FromPublicKey(pubkey)).toBe("0x" + "42".repeat(20));
        });
    });

    describe("frozen artifacts", () => {
        test("factory blob hashes to its manifest entry and embedded constant", () => {
            const { bytes, codeHash } = loadCreate3FactoryArtifact(repoRoot);
            expect(bytes.length).toBeGreaterThan(0);
            expect(codeHash).toBe(CREATE3_FACTORY_CODE_HASH);
        });

        test("child blob hashes to its manifest entry and embedded constant", () => {
            const { bytes, codeHash } = loadCreate3ChildArtifact(repoRoot);
            expect(bytes.length).toBeGreaterThan(0);
            expect(codeHash).toBe(CREATE3_CHILD_CODE_HASH);
        });
    });
}
