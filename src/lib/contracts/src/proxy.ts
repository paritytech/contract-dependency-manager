import { keccak_256 } from "@noble/hashes/sha3.js";

/**
 * TypeScript mirror of the CDM per-name proxy wire format defined in
 * `contract_registry_core::versioning` (src/contract/core/src/versioning.rs)
 * and served by `contract-proxy` (src/contract/proxy).
 *
 * A per-name proxy owns a contract name's stable address and storage; semver
 * versions are implementation contracts behind it. Its raw calldata splits
 * into three subspaces:
 *
 *   - plain calldata            → delegate to the latest implementation;
 *   - [MAGIC][key BE][inner]    → delegate to that exact version;
 *   - [MAGIC][0][selector][args]→ CDM meta queries / registry-only admin ops.
 *
 * Every constant here is pinned against the Rust side by the in-source tests
 * below — a drift in either direction is a wire-format break.
 */

/** `keccak256("cdm.proxy.call.v1")[..4]` — first 4 bytes of any CDM call. */
export const PROXY_MAGIC = "0xa2264d53" as const;

/** Version key 0 (`0.0.0`) is the meta namespace; never publishable. */
export const META_KEY = 0n;

/** `[MAGIC][u128 key]` — bytes before a versioned call's inner calldata. */
export const VERSIONED_HEADER_LEN = 4 + 16;

/** `[MAGIC][META_KEY][meta selector]` — bytes before meta ABI args. */
export const META_HEADER_LEN = VERSIONED_HEADER_LEN + 4;

/**
 * `keccak256("initialize(uint128,address)")[..4]` — the entry point of every
 * initialization contract; pinned against `contract_registry_core::versioning`.
 */
export const INITIALIZE_SELECTOR = "0x3a67c2f8" as const;

/** Signature behind {@link INITIALIZE_SELECTOR}, for derivation tests and docs. */
export const INITIALIZE_SIGNATURE = "initialize(uint128,address)";

/** Meta-call selectors (`keccak256(signature)[..4]`). */
export const PROXY_META = {
    /** admin (the registry) only */
    publish: "0xc3853395",
    /** admin (the registry) only — delegatecall against the proxy's storage,
     *  live even while frozen; the initializations primitive. */
    callCode: "0xd74c1f04",
    /** admin (the registry) only */
    setMinSupported: "0xe84411e5",
    /** admin (the registry) only */
    setAdmin: "0x704b6c02",
    /** admin (the registry) only */
    freeze: "0x62a5af3b",
    /** admin (the registry) only */
    unfreeze: "0x6a28f000",
    frozen: "0x054f7d9c",
    implOf: "0xdf379e50",
    latest: "0x52bfe789",
    minSupported: "0x900fc468",
    admin: "0xf851a440",
} as const;

/** Signatures behind each meta selector, for derivation tests and docs. */
export const PROXY_META_SIGNATURES: Record<keyof typeof PROXY_META, string> = {
    publish: "publish(uint128,address)",
    callCode: "callCode(address,bytes)",
    setMinSupported: "setMinSupported(uint128)",
    setAdmin: "setAdmin(address)",
    freeze: "freeze()",
    unfreeze: "unfreeze()",
    frozen: "frozen()",
    implOf: "implOf(uint128)",
    latest: "latest()",
    minSupported: "minSupported()",
    admin: "admin()",
};

/** Revert signatures the proxy can raise, keyed by selector hex. */
export const PROXY_ERROR_SIGNATURES = [
    "UnknownVersion()",
    "UnsupportedVersion(uint128,uint128)",
    "UnauthorizedAdmin()",
    "VersionNotMonotonic(uint128,uint128)",
    "InvalidVersionKey()",
    "InvalidImplementation()",
    "MalformedCall()",
    "UnknownMetaSelector()",
    "MinNotMonotonic(uint128,uint128)",
    "MinAboveLatest(uint128,uint128)",
    "NoVersions()",
    "ContractFrozen()",
] as const;

/**
 * Proxy-owned storage slots (`keccak256(label) - 1`, EIP-1967 scheme),
 * mirrored from `contract_registry_core::slots`. The implementation and
 * admin slots are the EIP-1967 standard ones, so explorers see the proxy's
 * latest implementation without knowing about CDM.
 */
export const PROXY_SLOTS = {
    implementation: "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc",
    admin: "0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103",
    minSupported: "0xfd72a9137a39672ad1c11d82c8f2377dc3795fa498e00ec272c1d6c9fedb4974",
    frozen: "0x10b1d4d74ddd28d4b6cf1edaae553682872a3b66c3a70e34907a42073c69e558",
    latestKey: "0x7d2e53e7260319608bac9e6f155af7a188ade8cda24ee2259128ceb1248eceb0",
    implOf: "0x95017cb99a656583260fc72407f66dd08850fc86ea2c1cd064a6c3c51785b8ee",
} as const;

const MAX_COMPONENT = 0xffff_ffffn;

/** Pack a semver triple into its ordered u128 key: `major<<64|minor<<32|patch`. */
export function packVersionKey(major: number, minor: number, patch: number): bigint {
    for (const [component, what] of [
        [major, "major"],
        [minor, "minor"],
        [patch, "patch"],
    ] as const) {
        if (!Number.isInteger(component) || component < 0 || BigInt(component) > MAX_COMPONENT) {
            throw new Error(`Invalid semver ${what} component: ${component}`);
        }
    }
    return (BigInt(major) << 64n) | (BigInt(minor) << 32n) | BigInt(patch);
}

/** Split a key back into its `{major, minor, patch}` triple. */
export function unpackVersionKey(key: bigint): { major: number; minor: number; patch: number } {
    if (key < 0n || key >> 96n !== 0n) {
        throw new Error(`Not a packed semver key: ${key}`);
    }
    return {
        major: Number((key >> 64n) & MAX_COMPONENT),
        minor: Number((key >> 32n) & MAX_COMPONENT),
        patch: Number(key & MAX_COMPONENT),
    };
}

/** `"1.2.3"` → packed key. Strict `X.Y.Z` — no ranges, no prerelease. */
export function semverToKey(version: string): bigint {
    const match = version.trim().match(/^v?(\d+)\.(\d+)\.(\d+)$/);
    if (!match) {
        throw new Error(`Not an exact semver version: "${version}"`);
    }
    return packVersionKey(Number(match[1]), Number(match[2]), Number(match[3]));
}

/** Packed key → `"1.2.3"`. */
export function keyToSemver(key: bigint): string {
    const { major, minor, patch } = unpackVersionKey(key);
    return `${major}.${minor}.${patch}`;
}

/** A key is publishable when non-zero with the top 32 bits clear. */
export function isPublishableKey(key: bigint): boolean {
    return key !== META_KEY && key >= 0n && key >> 96n === 0n;
}

// ─── Byte plumbing ─────────────────────────────────────────────────────────

type Hex = `0x${string}`;

function hexToBytes(hex: string, what: string): Uint8Array {
    const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
    if (clean.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(clean)) {
        throw new Error(`Invalid ${what}: ${hex}`);
    }
    const bytes = new Uint8Array(clean.length / 2);
    for (let i = 0; i < bytes.length; i++) {
        bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
    }
    return bytes;
}

function bytesToHex(bytes: Uint8Array): Hex {
    let out = "0x";
    for (const b of bytes) out += b.toString(16).padStart(2, "0");
    return out as Hex;
}

function concatBytes(...parts: Uint8Array[]): Uint8Array {
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let offset = 0;
    for (const part of parts) {
        out.set(part, offset);
        offset += part.length;
    }
    return out;
}

function u128Bytes(value: bigint, what: string): Uint8Array {
    if (value < 0n || value >> 128n !== 0n) {
        throw new Error(`${what} out of u128 range: ${value}`);
    }
    const bytes = new Uint8Array(16);
    let v = value;
    for (let i = 15; i >= 0; i--) {
        bytes[i] = Number(v & 0xffn);
        v >>= 8n;
    }
    return bytes;
}

/** A 32-byte ABI word with `value` right-aligned. */
function wordU128(value: bigint): Uint8Array {
    return concatBytes(new Uint8Array(16), u128Bytes(value, "version key"));
}

function wordAddress(address: string): Uint8Array {
    const bytes = hexToBytes(address, "address");
    if (bytes.length !== 20) {
        throw new Error(`Invalid address length: ${address}`);
    }
    return concatBytes(new Uint8Array(12), bytes);
}

function readWord(data: Uint8Array, index: number, what: string): Uint8Array {
    const start = index * 32;
    if (data.length < start + 32) {
        throw new Error(`Meta return too short for ${what}: ${data.length} bytes`);
    }
    return data.subarray(start, start + 32);
}

function wordToU128(word: Uint8Array, what: string): bigint {
    for (let i = 0; i < 16; i++) {
        if (word[i] !== 0) throw new Error(`Dirty high bytes decoding ${what}`);
    }
    let value = 0n;
    for (let i = 16; i < 32; i++) {
        value = (value << 8n) | BigInt(word[i]);
    }
    return value;
}

function wordToAddress(word: Uint8Array): Hex {
    return bytesToHex(word.subarray(12));
}

// ─── Calldata builders ─────────────────────────────────────────────────────

const MAGIC_BYTES = hexToBytes(PROXY_MAGIC, "magic");

/**
 * `[MAGIC][key][inner]` — route `inner` to the exact published version. An
 * unprefixed call routes to the latest version; that's just the plain ABI
 * calldata, no builder needed.
 */
export function encodeVersionedCall(key: bigint, inner: Hex | Uint8Array): Hex {
    if (!isPublishableKey(key)) {
        throw new Error(`Not a publishable version key: ${key}`);
    }
    const innerBytes = typeof inner === "string" ? hexToBytes(inner, "inner calldata") : inner;
    return bytesToHex(concatBytes(MAGIC_BYTES, u128Bytes(key, "version key"), innerBytes));
}

function encodeMetaCall(selector: string, ...args: Uint8Array[]): Hex {
    return bytesToHex(
        concatBytes(
            MAGIC_BYTES,
            u128Bytes(META_KEY, "meta key"),
            hexToBytes(selector, "meta selector"),
            ...args,
        ),
    );
}

/** Registry-only: register `(key, implementation)` with the proxy. */
export function encodeProxyPublish(key: bigint, implementation: string): Hex {
    return encodeMetaCall(PROXY_META.publish, wordU128(key), wordAddress(implementation));
}

/**
 * Registry-only: delegatecall `target` with `data` against the proxy's
 * storage, bubbling return/revert verbatim. Canonical ABI `bytes` framing:
 * target word, offset word (0x40), length word, payload zero-padded to a
 * 32-byte boundary. Live even while the proxy is frozen.
 */
export function encodeProxyCallCode(target: string, data: Hex | Uint8Array): Hex {
    const payload = typeof data === "string" ? hexToBytes(data, "callCode data") : data;
    const padded = new Uint8Array(Math.ceil(payload.length / 32) * 32);
    padded.set(payload);
    return encodeMetaCall(
        PROXY_META.callCode,
        wordAddress(target),
        wordU128(0x40n),
        wordU128(BigInt(payload.length)),
        padded,
    );
}

/**
 * `initialize(from, owner)` calldata — what the registry delivers through
 * `callCode` when a publish carries an initialization. `from` is the
 * previously-latest version key (0 on a first publish), `owner` the name's
 * registry owner.
 */
export function encodeInitialize(from: bigint, owner: string): Hex {
    return bytesToHex(
        concatBytes(
            hexToBytes(INITIALIZE_SELECTOR, "initialize selector"),
            wordU128(from),
            wordAddress(owner),
        ),
    );
}

/** Registry-only: ratchet the min-supported floor. */
export function encodeProxySetMinSupported(key: bigint): Hex {
    return encodeMetaCall(PROXY_META.setMinSupported, wordU128(key));
}

/** Registry-only: hand the proxy to a new admin. */
export function encodeProxySetAdmin(admin: string): Hex {
    return encodeMetaCall(PROXY_META.setAdmin, wordAddress(admin));
}

/** Registry-only: halt all delegation (the migration pause switch). */
export function encodeProxyFreeze(): Hex {
    return encodeMetaCall(PROXY_META.freeze);
}

/** Registry-only: resume delegation. */
export function encodeProxyUnfreeze(): Hex {
    return encodeMetaCall(PROXY_META.unfreeze);
}

export function encodeProxyFrozen(): Hex {
    return encodeMetaCall(PROXY_META.frozen);
}

export function encodeProxyImplOf(key: bigint): Hex {
    return encodeMetaCall(PROXY_META.implOf, wordU128(key));
}

export function encodeProxyLatest(): Hex {
    return encodeMetaCall(PROXY_META.latest);
}

export function encodeProxyMinSupported(): Hex {
    return encodeMetaCall(PROXY_META.minSupported);
}

export function encodeProxyAdmin(): Hex {
    return encodeMetaCall(PROXY_META.admin);
}

// ─── Meta return decoders ──────────────────────────────────────────────────

function toBytesInput(data: Hex | Uint8Array): Uint8Array {
    return typeof data === "string" ? hexToBytes(data, "meta return data") : data;
}

/** Decode a single u128 word (`minSupported`). */
export function decodeU128Word(data: Hex | Uint8Array): bigint {
    return wordToU128(readWord(toBytesInput(data), 0, "u128 word"), "u128 word");
}

/** Decode a single address word (`implOf`, `admin`). */
export function decodeAddressWord(data: Hex | Uint8Array): Hex {
    return wordToAddress(readWord(toBytesInput(data), 0, "address word"));
}

/** Decode a `(u128 key, address)` pair (`latest`). */
export function decodeVersionPair(data: Hex | Uint8Array): { key: bigint; target: Hex } {
    const bytes = toBytesInput(data);
    return {
        key: wordToU128(readWord(bytes, 0, "version key"), "version key"),
        target: wordToAddress(readWord(bytes, 1, "target")),
    };
}

// ─── In-source tests ───────────────────────────────────────────────────────

if (import.meta.vitest) {
    const { describe, expect, it } = import.meta.vitest;

    const keccakSelector = (signature: string) =>
        bytesToHex(keccak_256(new TextEncoder().encode(signature)).subarray(0, 4));

    describe("proxy wire-format constants", () => {
        it("magic derives from cdm.proxy.call.v1 (pinned in Rust core)", () => {
            expect(keccakSelector("cdm.proxy.call.v1")).toBe(PROXY_MAGIC);
        });

        it("meta selectors derive from their signatures (pinned in Rust core)", () => {
            for (const [name, selector] of Object.entries(PROXY_META)) {
                expect(keccakSelector(PROXY_META_SIGNATURES[name as keyof typeof PROXY_META])).toBe(
                    selector,
                );
            }
        });

        it("initialize selector derives from its signature (pinned in Rust core)", () => {
            expect(keccakSelector(INITIALIZE_SIGNATURE)).toBe(INITIALIZE_SELECTOR);
        });

        it("slots derive as keccak256(label) - 1 (pinned in Rust core)", () => {
            const slot = (label: string) => {
                const hash = keccak_256(new TextEncoder().encode(label));
                for (let i = 31; i >= 0; i--) {
                    if (hash[i] === 0) {
                        hash[i] = 0xff;
                    } else {
                        hash[i]--;
                        break;
                    }
                }
                return bytesToHex(hash);
            };
            expect(slot("eip1967.proxy.implementation")).toBe(PROXY_SLOTS.implementation);
            expect(slot("eip1967.proxy.admin")).toBe(PROXY_SLOTS.admin);
            expect(slot("cdm.proxy.min_supported")).toBe(PROXY_SLOTS.minSupported);
            expect(slot("cdm.proxy.frozen")).toBe(PROXY_SLOTS.frozen);
            expect(slot("cdm.proxy.latest_key")).toBe(PROXY_SLOTS.latestKey);
            expect(slot("cdm.proxy.impl_of")).toBe(PROXY_SLOTS.implOf);
        });
    });

    describe("version keys", () => {
        it("packs and unpacks semver triples in order", () => {
            expect(packVersionKey(2, 3, 14)).toBe((2n << 64n) | (3n << 32n) | 14n);
            expect(unpackVersionKey(packVersionKey(2, 3, 14))).toEqual({
                major: 2,
                minor: 3,
                patch: 14,
            });
            const ordered = [
                packVersionKey(0, 0, 1),
                packVersionKey(0, 0, 13),
                packVersionKey(0, 1, 0),
                packVersionKey(1, 0, 0),
                packVersionKey(2, 0, 0),
            ];
            for (let i = 1; i < ordered.length; i++) {
                expect(ordered[i - 1] < ordered[i]).toBe(true);
            }
        });

        it("round-trips semver strings", () => {
            expect(semverToKey("1.2.3")).toBe(packVersionKey(1, 2, 3));
            expect(semverToKey("v1.2.3")).toBe(packVersionKey(1, 2, 3));
            expect(keyToSemver(packVersionKey(1, 2, 3))).toBe("1.2.3");
            expect(() => semverToKey("1.2")).toThrow(/exact semver/);
            expect(() => semverToKey("^1.2.3")).toThrow(/exact semver/);
            expect(() => semverToKey("1.2.3-rc.1")).toThrow(/exact semver/);
        });

        it("rejects unpublishable keys", () => {
            expect(isPublishableKey(0n)).toBe(false);
            expect(isPublishableKey(1n << 96n)).toBe(false);
            expect(isPublishableKey(packVersionKey(0, 0, 1))).toBe(true);
        });
    });

    describe("calldata builders", () => {
        it("versioned calls carry magic, BE key, and inner calldata", () => {
            const key = packVersionKey(1, 2, 3);
            const calldata = encodeVersionedCall(key, "0xdeadbeef01");
            expect(calldata).toBe("0xa2264d53" + "00000000000000010000000200000003" + "deadbeef01");
            expect(hexToBytes(calldata, "calldata").length).toBe(VERSIONED_HEADER_LEN + 5);
        });

        it("meta publish matches the registry's Rust-side encoding", () => {
            // The exact bytes `contract-registry` sends its proxies, locked by
            // `first_publish_registers_name_and_creates_proxy` in main.rs.
            const key = packVersionKey(1, 0, 0);
            const impl = "0x1111111111111111111111111111111111111111";
            expect(encodeProxyPublish(key, impl)).toBe(
                "0xa2264d53" +
                    "00000000000000000000000000000000" + // meta key 0
                    "c3853395" + // publish(uint128,address)
                    "00000000000000000000000000000000" +
                    "00000000000000010000000000000000" + // key word
                    "000000000000000000000000" +
                    "1111111111111111111111111111111111111111", // impl word
            );
        });

        it("meta callCode + initialize match the registry's Rust-side encoding", () => {
            // The exact bytes `contract-registry` sends on a publish-with-
            // initialization, locked by `publish_with_init_first_publish_
            // sends_from_zero_and_owner` in src/contract/src/main.rs.
            const init = "0x1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b";
            const owner = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
            const inner = encodeInitialize(packVersionKey(1, 0, 0), owner);
            expect(inner).toBe(
                "0x3a67c2f8" + // initialize(uint128,address)
                    "00000000000000000000000000000000" +
                    "00000000000000010000000000000000" + // from = 1.0.0
                    "000000000000000000000000" +
                    "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", // owner word
            );
            expect(encodeProxyCallCode(init, inner)).toBe(
                "0xa2264d53" +
                    "00000000000000000000000000000000" + // meta key 0
                    "d74c1f04" + // callCode(address,bytes)
                    "000000000000000000000000" +
                    "1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b" + // target word
                    "0000000000000000000000000000000000000000000000000000000000000040" + // offset
                    "0000000000000000000000000000000000000000000000000000000000000044" + // len 68
                    inner.slice(2) +
                    "00000000000000000000000000000000000000000000000000000000", // pad to 96
            );
        });

        it("decodes meta returns", () => {
            const pair = new Uint8Array(64);
            pair.set(u128Bytes(packVersionKey(1, 1, 0), "key"), 16);
            pair.set(hexToBytes("0x2222222222222222222222222222222222222222", "addr"), 44);
            expect(decodeVersionPair(pair)).toEqual({
                key: packVersionKey(1, 1, 0),
                target: "0x2222222222222222222222222222222222222222",
            });
            expect(decodeU128Word(wordU128(42n))).toBe(42n);
            expect(decodeAddressWord(pair.subarray(32))).toBe(
                "0x2222222222222222222222222222222222222222",
            );
        });

        it("error selectors derive from their signatures", () => {
            // Spot-check the two consumers hit most; the derive rule covers all.
            expect(keccakSelector("UnknownVersion()")).toBe("0x8da6a6a4");
            expect(keccakSelector("UnsupportedVersion(uint128,uint128)")).toBe("0x4f95b5db");
        });
    });
}
