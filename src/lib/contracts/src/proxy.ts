import { keccak_256 } from "@noble/hashes/sha3.js";

/**
 * Mirror of the per-name wire format in `contract_registry_core::versioning`
 * (src/contract/core/src/versioning.rs):
 *
 *   - plain calldata             → latest implementation;
 *   - [MAGIC][key BE][inner]     → that exact version;
 *   - [MAGIC][0][selector][args] → the CDM meta plane: the shim answers the
 *     `SHIM_META` selectors itself, the resolver serves the `PROXY_META`
 *     queries plus the registry-only `callCode`.
 *
 * A shim that holds the latest version in its fast-path slot serves plain
 * calls, calls pinned to that version and the `latest` query from it; every
 * other call it does not answer itself goes to the resolver, or reverts once
 * the shim is sealed.
 *
 * Every constant is pinned against the Rust side by the in-source tests.
 */

/** `keccak256("cdm.proxy.call.v1")[..4]`. */
export const PROXY_MAGIC = "0xa2264d53" as const;

/** Version key 0 (`0.0.0`) is the meta namespace; never publishable. */
export const META_KEY = 0n;

/** `[MAGIC][u128 key]`. */
export const VERSIONED_HEADER_LEN = 4 + 16;

/** `[MAGIC][META_KEY][meta selector]`. */
export const META_HEADER_LEN = VERSIONED_HEADER_LEN + 4;

/** `keccak256("initialize(uint128,address)")[..4]`. */
export const INITIALIZE_SELECTOR = "0x3a67c2f8" as const;

/**
 * Meta-call selectors the resolver serves (`keccak256(signature)[..4]`);
 * `callCode` is honored for the registry only. A shim that holds the latest
 * version answers `latest` itself; a sealed shim reverts `Sealed()` on all
 * the others.
 */
export const PROXY_META = {
    callCode: "0xd74c1f04",
    frozen: "0x054f7d9c",
    implOf: "0xdf379e50",
    latest: "0x52bfe789",
    minSupported: "0x900fc468",
    admin: "0xf851a440",
} as const;

/**
 * Meta-call selectors the shim answers itself, sealed or not: two getters,
 * plus `setFastPath` and `seal`, which it accepts from the resolver only.
 */
export const SHIM_META = {
    sealed: "0xe4b203ef",
    resolver: "0x04f3bcec",
    setFastPath: "0x8682471f",
    seal: "0xe2e33028",
} as const;

/** The shim's own storage slots (`keccak256(label) - 1`); every other slot belongs to the name's implementations. */
export const SHIM_SLOTS = {
    /** `cdm.shim.fast`: the latest version as one `packFastPath` word; all zero when the shim has no shortcut. */
    fast: "0xf0a018d1f0a0c89702867d3b938e95b2525db0fc04b1c93fdac5127d62eef3a2",
    /** `cdm.shim.sealed`: non-zero once the shim is sealed. */
    sealed: "0x7ae89d045ec485b4c2afaca0f585635101dbf8f05b43a137d6f198bfa339400d",
} as const;

/** `resolve(address,uint256,bytes)`: the one request every shim makes to the resolver. */
export const RESOLVE_SELECTOR = "0x6a418533" as const;

/** `Resolution.kind`: return the payload, or delegate-call the target. */
export const RESOLUTION_KIND = { return: 0, delegate: 1 } as const;

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

/** `[MAGIC][key][inner]` — route `inner` to the exact published version. */
export function encodeVersionedCall(key: bigint, inner: Hex | Uint8Array): Hex {
    if (!isPublishableKey(key)) {
        throw new Error(`Not a publishable version key: ${key}`);
    }
    const innerBytes = typeof inner === "string" ? hexToBytes(inner, "inner calldata") : inner;
    return bytesToHex(concatBytes(MAGIC_BYTES, u128Bytes(key, "version key"), innerBytes));
}

/** `[MAGIC][0][selector][args]` — a CDM meta call. */
export function encodeProxyMetaCall(selector: string, ...args: Uint8Array[]): Hex {
    return bytesToHex(
        concatBytes(
            MAGIC_BYTES,
            u128Bytes(META_KEY, "meta key"),
            hexToBytes(selector, "meta selector"),
            ...args,
        ),
    );
}

/**
 * Registry-only: delegatecall `target` with `data` against the shim's
 * storage. `data` follows the target word unframed; the resolver strips
 * everything before it.
 */
export function encodeProxyCallCode(target: string, data: Hex | Uint8Array): Hex {
    const payload = typeof data === "string" ? hexToBytes(data, "callCode data") : data;
    return encodeProxyMetaCall(PROXY_META.callCode, wordAddress(target), payload);
}

/**
 * `initialize(from, owner)` calldata: `from` is the previously-latest key (0
 * on a first publish), `owner` the name's registry owner.
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

export function encodeProxyFrozen(): Hex {
    return encodeProxyMetaCall(PROXY_META.frozen);
}

export function encodeProxyImplOf(key: bigint): Hex {
    return encodeProxyMetaCall(PROXY_META.implOf, wordU128(key));
}

export function encodeProxyLatest(): Hex {
    return encodeProxyMetaCall(PROXY_META.latest);
}

export function encodeProxyMinSupported(): Hex {
    return encodeProxyMetaCall(PROXY_META.minSupported);
}

export function encodeProxyAdmin(): Hex {
    return encodeProxyMetaCall(PROXY_META.admin);
}

export function encodeProxySealed(): Hex {
    return encodeProxyMetaCall(SHIM_META.sealed);
}

export function encodeProxyResolver(): Hex {
    return encodeProxyMetaCall(SHIM_META.resolver);
}

// ─── Meta return decoders ──────────────────────────────────────────────────

function toBytesInput(data: Hex | Uint8Array): Uint8Array {
    return typeof data === "string" ? hexToBytes(data, "meta return data") : data;
}

/** Decode a single u128 word (`minSupported`). */
export function decodeU128Word(data: Hex | Uint8Array): bigint {
    return wordToU128(readWord(toBytesInput(data), 0, "u128 word"), "u128 word");
}

/** Decode a single address word (`implOf`, `admin`, `resolver`). */
export function decodeAddressWord(data: Hex | Uint8Array): Hex {
    return wordToAddress(readWord(toBytesInput(data), 0, "address word"));
}

/** Decode a single bool word (`frozen`, `sealed`). */
export function decodeBoolWord(data: Hex | Uint8Array): boolean {
    return wordToU128(readWord(toBytesInput(data), 0, "bool word"), "bool word") !== 0n;
}

/** Decode a `(u128 key, address)` pair (`latest`). */
export function decodeVersionPair(data: Hex | Uint8Array): { key: bigint; target: Hex } {
    const bytes = toBytesInput(data);
    return {
        key: wordToU128(readWord(bytes, 0, "version key"), "version key"),
        target: wordToAddress(readWord(bytes, 1, "target")),
    };
}

// ─── Shim fast-path word ───────────────────────────────────────────────────

/**
 * The word at `SHIM_SLOTS.fast`: `[version key: 12 bytes BE][implementation:
 * 20 bytes]`. A publishable key has its top 32 bits clear, so 12 bytes hold
 * all of it.
 */
export function packFastPath(key: bigint, implementation: string): Hex {
    if (key < 0n || key >> 96n !== 0n) {
        throw new Error(`Version key does not fit the fast-path word: ${key}`);
    }
    return bytesToHex(
        concatBytes(
            u128Bytes(key, "version key").subarray(4),
            wordAddress(implementation).subarray(12),
        ),
    );
}

/** Split a fast-path word into its version key and implementation. */
export function unpackFastPath(word: Hex | Uint8Array): { key: bigint; implementation: Hex } {
    const bytes = typeof word === "string" ? hexToBytes(word, "fast-path word") : word;
    if (bytes.length !== 32) {
        throw new Error(`Fast-path word must be 32 bytes, got ${bytes.length}`);
    }
    let key = 0n;
    for (let i = 0; i < 12; i++) {
        key = (key << 8n) | BigInt(bytes[i]);
    }
    return { key, implementation: bytesToHex(bytes.subarray(12)) };
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
            const signatures: Record<keyof typeof PROXY_META, string> = {
                callCode: "callCode(address,bytes)",
                frozen: "frozen()",
                implOf: "implOf(uint128)",
                latest: "latest()",
                minSupported: "minSupported()",
                admin: "admin()",
            };
            for (const [name, selector] of Object.entries(PROXY_META)) {
                expect(keccakSelector(signatures[name as keyof typeof PROXY_META])).toBe(selector);
            }
        });

        it("shim meta selectors derive from their signatures (pinned in Rust core)", () => {
            const signatures: Record<keyof typeof SHIM_META, string> = {
                sealed: "sealed()",
                resolver: "resolver()",
                setFastPath: "setFastPath(uint128,address)",
                seal: "seal(uint128,address)",
            };
            for (const [name, selector] of Object.entries(SHIM_META)) {
                expect(keccakSelector(signatures[name as keyof typeof SHIM_META])).toBe(selector);
            }
        });

        it("shim slots are keccak256(label) - 1 (pinned in Rust core)", () => {
            const slot = (label: string) => {
                const hash = BigInt(bytesToHex(keccak_256(new TextEncoder().encode(label))));
                return `0x${(hash - 1n).toString(16).padStart(64, "0")}`;
            };
            expect(slot("cdm.shim.fast")).toBe(SHIM_SLOTS.fast);
            expect(slot("cdm.shim.sealed")).toBe(SHIM_SLOTS.sealed);
        });

        it("initialize and resolve selectors derive from their signatures (pinned in Rust core)", () => {
            expect(keccakSelector("initialize(uint128,address)")).toBe(INITIALIZE_SELECTOR);
            expect(keccakSelector("resolve(address,uint256,bytes)")).toBe(RESOLVE_SELECTOR);
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

        it("meta callCode + initialize match the registry's Rust-side encoding", () => {
            // Locked by `publish_with_init_first_publish_sends_from_zero_and_owner`
            // in src/contract/src/main.rs.
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
                    inner.slice(2),
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
            expect(decodeBoolWord(wordU128(1n))).toBe(true);
            expect(decodeBoolWord(wordU128(0n))).toBe(false);
        });

        it("error selectors derive from their signatures", () => {
            expect(keccakSelector("UnknownVersion()")).toBe("0x8da6a6a4");
            expect(keccakSelector("UnsupportedVersion(uint128,uint128)")).toBe("0x4f95b5db");
            expect(keccakSelector("MalformedResolution()")).toBe("0xa0977a0b");
            expect(keccakSelector("NotResolver()")).toBe("0xba2a9fc2");
            expect(keccakSelector("Sealed()")).toBe("0x1b2d71eb");
            expect(keccakSelector("NameSealed()")).toBe("0x60e456c9");
        });
    });

    describe("shim fast-path word", () => {
        it("is the key then the implementation (pinned in Rust core)", () => {
            const key = packVersionKey(1, 2, 3);
            const implementation = `0x${"ab".repeat(20)}`;
            const word = packFastPath(key, implementation);
            // Major, minor, patch as big-endian u32s, then the address.
            expect(word).toBe(`0x000000010000000200000003${"ab".repeat(20)}`);
            expect(unpackFastPath(word)).toEqual({ key, implementation });
        });

        it("holds the largest publishable key", () => {
            const max = packVersionKey(0xffff_ffff, 0xffff_ffff, 0xffff_ffff);
            const implementation = `0x${"01".repeat(20)}`;
            expect(unpackFastPath(packFastPath(max, implementation))).toEqual({
                key: max,
                implementation,
            });
        });
    });
}
