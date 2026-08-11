import type { Contract, ContractDef } from "@parity/product-sdk-contracts";
import { mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { maxSatisfying, validRange } from "semver";
import { stringifyBigInt } from "@parity/cdm-utils";
import { decodedErrorSignature, type AbiEntry } from "./deployer";
import { keyToSemver, packVersionKey, semverToKey } from "./proxy";
import { saveContract } from "./store";

/**
 * What a `cdm.json` dependency entry (or CLI argument) may request:
 * - `"latest"` — the newest published version;
 * - an exact semver (`"1.2.3"`) — matched against on-chain version keys;
 * - an npm-style semver range (`"^1.2.3"`) — resolved to the greatest
 *   satisfying published version;
 * - a number — a LEGACY registry version INDEX from v1-era manifests,
 *   resolved positionally through the v1 query surface.
 */
export type InstallRequestedVersion = string | number;

export interface InstallLibraryRequest {
    library: string;
    requestedVersion: InstallRequestedVersion;
}

export interface InstallResult {
    library: string;
    /**
     * The value to record in `cdm.json` and use as the artifact directory:
     * the resolved semver string, or the raw index for legacy numeric
     * requests.
     */
    version: string | number;
    /**
     * The resolved version's semver. Equal to `version` for semver-era
     * requests; derived as `0.0.(index + 1)` — the registry's own rule for
     * v1 rows — for legacy numeric requests.
     */
    semver: string;
    /**
     * The address to call: the name's STABLE address (`registry.getAddress`
     * — the per-name proxy for proxied names) for semver-era requests, or the
     * pinned version's standalone contract for legacy numeric requests.
     */
    address: string;
    abi: AbiEntry[];
    savedPath: string;
    metadataCid: string;
}

export interface InstallSummary {
    results: InstallResult[];
    errors: { library: string; error: string }[];
    success: boolean;
    totalDurationMs: number;
}

export type InstallEvent =
    | { type: "install-start"; library: string; requestedVersion: InstallRequestedVersion }
    | { type: "query-start"; library: string }
    | {
          type: "query-done";
          library: string;
          version: string | number;
          address: string;
          metadataCid: string;
      }
    | { type: "fetch-start"; library: string; metadataCid: string }
    | { type: "install-done"; library: string; result: InstallResult }
    | { type: "install-error"; library: string; error: string }
    | { type: "pipeline-done"; summary: InstallSummary }
    | { type: "pipeline-error"; error: string };

export type RegistryContract = Contract<ContractDef>;

export interface InstallMetadataResponse {
    json(): Promise<unknown>;
}

export interface InstallIpfsGateway {
    fetch(cid: string): Promise<InstallMetadataResponse>;
}

export interface InstallContractsOptions {
    libraries: InstallLibraryRequest[];
    registry: RegistryContract;
    ipfs: InstallIpfsGateway;
    /** Registry address, used only to make decode-failure messages actionable. */
    registryAddress?: string;
    artifactsDir?: string;
    onEvent?: (event: InstallEvent) => void;
}

/** Name + message of an error and its whole `cause` chain, for classification. */
function errorText(err: unknown): string {
    const parts: string[] = [];
    let current: unknown = err;
    while (current) {
        if (current instanceof Error) {
            parts.push(current.name, current.message);
            current = current.cause;
        } else {
            parts.push(String(current));
            break;
        }
    }
    return parts.join(" ");
}

/**
 * Detects viem's `AbiDecodingZeroDataError` ('Cannot decode zero data ("0x")…'),
 * which is what querying a nonexistent contract entry surfaces as. Deliberately
 * narrow — matching on a bare "0x" would misreport almost any RPC error
 * (hex hashes/addresses in the message) as "contract not found".
 */
function isRegistryQueryError(err: unknown): boolean {
    const msg = errorText(err);
    return msg.includes("zero data") || msg.includes("AbiDecodingZeroData");
}

/**
 * Detects viem decode-shape failures — non-empty return data that does not fit
 * the expected ABI layout (`InvalidBytesBooleanError`, `PositionOutOfBounds`,
 * other `AbiDecoding*` errors). This is what talking to a registry of a
 * different ABI generation looks like, so it deserves a clearer message than
 * the raw viem error.
 */
function isRegistryDecodeShapeError(err: unknown): boolean {
    const msg = errorText(err);
    return (
        msg.includes("AbiDecoding") ||
        msg.includes("InvalidBytesBoolean") ||
        msg.includes("not a valid boolean") ||
        msg.includes("PositionOutOfBounds") ||
        msg.includes("out of bounds")
    );
}

function generationMismatchError(registryAddress?: string, cause?: unknown): Error {
    const where = registryAddress ? `the registry at ${registryAddress}` : "the registry";
    return new Error(
        `failed to decode registry response — ${where} may be a different generation than this CLI supports`,
        cause === undefined ? undefined : { cause },
    );
}

/**
 * Rethrows a registry query error with a friendlier message: zero-data decode
 * errors become `notFoundMessage`, decode-shape errors become a
 * generation-mismatch hint, and everything else passes through unchanged.
 */
function rethrowRegistryQueryError(
    err: unknown,
    notFoundMessage: string,
    registryAddress?: string,
): never {
    if (isRegistryQueryError(err)) {
        throw new Error(notFoundMessage, { cause: err });
    }
    if (isRegistryDecodeShapeError(err)) {
        throw generationMismatchError(registryAddress, err);
    }
    throw err;
}

function unwrapOption<T>(val: unknown): T | undefined {
    if (val && typeof val === "object" && "isSome" in val) {
        const opt = val as { isSome: boolean; value: T };
        return opt.isSome ? opt.value : undefined;
    }
    return val as T | undefined;
}

function metadataObject(value: unknown, library: string): Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new Error(`Invalid metadata for "${library}"`);
    }
    return value as Record<string, unknown>;
}

function queryFailure(action: string, library: string, value: unknown): Error {
    // Registry rejections are typed SolErrors surfaced as revert info with a
    // decoded errorName (`Unauthorized()`, `ContractFrozen()`, …) — print the
    // signature instead of the raw revert-info JSON blob when present.
    const detail = decodedErrorSignature(value) ?? stringifyBigInt(value);
    return new Error(`${action} for "${library}": ${detail}`);
}

/**
 * The resolved target of an install request — everything needed before the
 * metadata fetch. `version`/`semver`/`address` semantics match
 * {@link InstallResult}.
 */
interface ResolvedInstallVersion {
    version: string | number;
    semver: string;
    metadataCid: string;
    contractAddress: string;
}

/** One `getVersionAt` row: `(version key, implementation target, metadata URI)`. */
interface RegistryVersionRow {
    key: bigint;
    target: string;
    metadataUri: string;
}

async function queryVersionCount(
    library: string,
    registry: RegistryContract,
    registryAddress?: string,
): Promise<number> {
    let versionResult;
    try {
        versionResult = await registry.getVersionCount.query(library);
    } catch (err) {
        rethrowRegistryQueryError(
            err,
            `Contract "${library}" not found in registry`,
            registryAddress,
        );
    }
    if (!versionResult.success) {
        throw queryFailure("Failed to query registry version count", library, versionResult.value);
    }
    if (typeof versionResult.value !== "number" || versionResult.value === 0) {
        throw new Error(`Contract "${library}" not found in registry`);
    }
    return versionResult.value;
}

/**
 * One version row by index. `getVersionAt` serves BOTH eras — the registry
 * derives v1 rows' keys as `0.0.(index + 1)` itself — so the returned key is
 * always a packed semver.
 */
async function queryVersionRow(
    library: string,
    index: number,
    registry: RegistryContract,
    registryAddress?: string,
): Promise<RegistryVersionRow> {
    let rowResult;
    try {
        rowResult = await registry.getVersionAt.query(library, index);
    } catch (err) {
        rethrowRegistryQueryError(
            err,
            `Version index ${index} of "${library}" not found in registry`,
            registryAddress,
        );
    }
    if (!rowResult.success) {
        throw queryFailure(`Failed to query version row ${index}`, library, rowResult.value);
    }
    const row = rowResult.value as
        | { isSome?: boolean; version_key?: bigint; target?: string; metadata_uri?: string }
        | null
        | undefined;
    if (!row || typeof row !== "object" || !row.isSome) {
        throw new Error(`Version index ${index} of "${library}" not found in registry`);
    }
    if (
        typeof row.version_key !== "bigint" ||
        typeof row.target !== "string" ||
        typeof row.metadata_uri !== "string"
    ) {
        throw generationMismatchError(registryAddress);
    }
    return { key: row.version_key, target: row.target, metadataUri: row.metadata_uri };
}

/** Every published row, in index (= publish) order. */
async function queryAllVersionRows(
    library: string,
    registry: RegistryContract,
    registryAddress?: string,
): Promise<RegistryVersionRow[]> {
    const count = await queryVersionCount(library, registry, registryAddress);
    const rows: RegistryVersionRow[] = [];
    for (let index = 0; index < count; index++) {
        rows.push(await queryVersionRow(library, index, registry, registryAddress));
    }
    return rows;
}

/**
 * The name's STABLE address from `getAddress` — the per-name proxy for
 * proxied names, the latest standalone contract for legacy names. This is
 * what goes into `cdm.json` for semver-era requests: the proxy serves every
 * published version, so it stays correct across upgrades.
 */
async function queryStableAddress(
    library: string,
    registry: RegistryContract,
    registryAddress?: string,
): Promise<string> {
    let addrResult;
    try {
        addrResult = await registry.getAddress.query(library);
    } catch (err) {
        rethrowRegistryQueryError(
            err,
            `Failed to fetch address for "${library}" from registry`,
            registryAddress,
        );
    }
    if (!addrResult.success) {
        throw queryFailure("Failed to query address", library, addrResult.value);
    }
    return unwrapOption<string>(addrResult.value) ?? "";
}

async function finishRowResolution(
    library: string,
    row: RegistryVersionRow,
    registry: RegistryContract,
    registryAddress?: string,
): Promise<ResolvedInstallVersion> {
    const semver = keyToSemver(row.key);
    if (!row.metadataUri) {
        throw new Error(`No metadata URI found for "${library}"`);
    }
    const contractAddress = await queryStableAddress(library, registry, registryAddress);
    return { version: semver, semver, metadataCid: row.metadataUri, contractAddress };
}

async function resolveLatest(
    library: string,
    registry: RegistryContract,
    registryAddress?: string,
): Promise<ResolvedInstallVersion> {
    const count = await queryVersionCount(library, registry, registryAddress);
    const row = await queryVersionRow(library, count - 1, registry, registryAddress);
    return finishRowResolution(library, row, registry, registryAddress);
}

async function resolveExact(
    library: string,
    requested: string,
    key: bigint,
    registry: RegistryContract,
    registryAddress?: string,
): Promise<ResolvedInstallVersion> {
    const rows = await queryAllVersionRows(library, registry, registryAddress);
    const row = rows.find((candidate) => candidate.key === key);
    if (!row) {
        throw new Error(`Version "${requested}" of "${library}" not found in registry`);
    }
    return finishRowResolution(library, row, registry, registryAddress);
}

async function resolveRange(
    library: string,
    range: string,
    registry: RegistryContract,
    registryAddress?: string,
): Promise<ResolvedInstallVersion> {
    const rows = await queryAllVersionRows(library, registry, registryAddress);
    const rowBySemver = new Map(rows.map((row) => [keyToSemver(row.key), row]));
    const published = [...rowBySemver.keys()];
    const best = maxSatisfying(published, range);
    if (!best) {
        throw new Error(
            `No version of "${library}" satisfies "${range}" (published: ${published.join(", ")})`,
        );
    }
    return finishRowResolution(library, rowBySemver.get(best)!, registry, registryAddress);
}

/**
 * Legacy numeric pins resolve through the v1 query surface — the only one
 * v1-era registries expose — so old manifests keep working against every
 * registry generation. The pinned version's own standalone address is
 * returned (v1 semantics: each version is a separate contract) and the
 * semver derives locally by the registry's v1 rule, `0.0.(index + 1)`.
 */
async function resolveLegacyIndex(
    library: string,
    requestedVersion: number,
    registry: RegistryContract,
    registryAddress?: string,
): Promise<ResolvedInstallVersion> {
    if (!Number.isInteger(requestedVersion) || requestedVersion < 0) {
        throw new Error(`Invalid version index ${requestedVersion} for "${library}"`);
    }

    let metaResult;
    try {
        metaResult = await registry.getMetadataUriAtVersion.query(library, requestedVersion);
    } catch (err) {
        rethrowRegistryQueryError(
            err,
            `Version ${requestedVersion} of "${library}" not found in registry`,
            registryAddress,
        );
    }
    if (!metaResult.success) {
        throw queryFailure(
            `Failed to query metadata URI for version ${requestedVersion}`,
            library,
            metaResult.value,
        );
    }
    const metadataCid = unwrapOption<string>(metaResult.value) ?? "";
    if (!metadataCid) {
        throw new Error(`Version ${requestedVersion} of "${library}" not found in registry`);
    }

    let addrResult;
    try {
        addrResult = await registry.getAddressAtVersion.query(library, requestedVersion);
    } catch (err) {
        rethrowRegistryQueryError(
            err,
            `Failed to fetch address for "${library}" version ${requestedVersion} from registry`,
            registryAddress,
        );
    }
    if (!addrResult.success) {
        throw queryFailure(
            `Failed to query address for version ${requestedVersion}`,
            library,
            addrResult.value,
        );
    }
    const contractAddress = unwrapOption<string>(addrResult.value) ?? "";

    return {
        version: requestedVersion,
        semver: keyToSemver(packVersionKey(0, 0, requestedVersion + 1)),
        metadataCid,
        contractAddress,
    };
}

function resolveRequestedVersion(
    request: InstallLibraryRequest,
    opts: InstallContractsOptions,
): Promise<ResolvedInstallVersion> {
    const { library, requestedVersion } = request;
    if (typeof requestedVersion === "number") {
        return resolveLegacyIndex(library, requestedVersion, opts.registry, opts.registryAddress);
    }
    if (requestedVersion === "latest") {
        return resolveLatest(library, opts.registry, opts.registryAddress);
    }
    let exactKey: bigint | undefined;
    try {
        exactKey = semverToKey(requestedVersion);
    } catch {
        // not an exact version — try it as a range below
    }
    if (exactKey !== undefined) {
        return resolveExact(
            library,
            requestedVersion,
            exactKey,
            opts.registry,
            opts.registryAddress,
        );
    }
    if (validRange(requestedVersion)) {
        return resolveRange(library, requestedVersion, opts.registry, opts.registryAddress);
    }
    throw new Error(
        `Invalid version request "${requestedVersion}" for "${library}" — use "latest", ` +
            `an exact "X.Y.Z", a semver range, or a legacy numeric index`,
    );
}

async function installOne(
    request: InstallLibraryRequest,
    opts: InstallContractsOptions,
): Promise<InstallResult> {
    const emit = opts.onEvent;
    const { library, requestedVersion } = request;

    emit?.({ type: "install-start", library, requestedVersion });
    emit?.({ type: "query-start", library });

    const { version, semver, metadataCid, contractAddress } = await resolveRequestedVersion(
        request,
        opts,
    );

    emit?.({ type: "query-done", library, version, address: contractAddress, metadataCid });
    emit?.({ type: "fetch-start", library, metadataCid });

    const metadata = metadataObject(await (await opts.ipfs.fetch(metadataCid)).json(), library);
    const abi = metadata.abi;
    if (!abi || !Array.isArray(abi) || abi.length === 0) {
        throw new Error(`No ABI found in metadata for "${library}"`);
    }

    const savedPath = saveContract({
        artifactsDir: opts.artifactsDir,
        library,
        version,
        abi,
        metadata,
        address: contractAddress,
        metadataCid,
    });

    const result = {
        library,
        version,
        semver,
        address: contractAddress,
        abi: abi as AbiEntry[],
        savedPath,
        metadataCid,
    };
    emit?.({ type: "install-done", library, result });
    return result;
}

export async function installContracts(opts: InstallContractsOptions): Promise<InstallSummary> {
    const started = Date.now();

    try {
        const settled = await Promise.allSettled(
            opts.libraries.map((request) =>
                installOne(request, opts).catch((err) => {
                    const error = err instanceof Error ? err.message : String(err);
                    opts.onEvent?.({ type: "install-error", library: request.library, error });
                    throw err;
                }),
            ),
        );

        const results: InstallResult[] = [];
        const errors: { library: string; error: string }[] = [];

        for (let i = 0; i < settled.length; i++) {
            const result = settled[i];
            if (result.status === "fulfilled") {
                results.push(result.value);
            } else {
                errors.push({
                    library: opts.libraries[i].library,
                    error:
                        result.reason instanceof Error
                            ? result.reason.message
                            : String(result.reason),
                });
            }
        }

        const summary = {
            results,
            errors,
            success: errors.length === 0,
            totalDurationMs: Date.now() - started,
        };
        opts.onEvent?.({ type: "pipeline-done", summary });
        return summary;
    } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        opts.onEvent?.({ type: "pipeline-error", error });
        throw err;
    }
}

if (import.meta.vitest) {
    const { afterEach, describe, expect, test } = import.meta.vitest;
    const originalCdmRoot = process.env.CDM_ROOT;

    function option<T>(value: T) {
        return { isSome: true, value };
    }

    function queryResult(value: unknown) {
        return { success: true, value };
    }

    function versionRow(key: bigint, target: string, metadataUri: string) {
        return { isSome: true, version_key: key, target, metadata_uri: metadataUri };
    }

    /**
     * Two published rows: 1.0.0 at index 0 and 1.1.0 at index 1, fronted by
     * a stable (proxy) address. The v1 surface answers index queries so
     * legacy numeric pins can be exercised against the same fake.
     */
    function fakeRegistry() {
        const rows = [
            versionRow(semverToKey("1.0.0"), "0xv0impl", "bafy-v0"),
            versionRow(semverToKey("1.1.0"), "0xv1impl", "bafy-latest"),
        ];
        return {
            getVersionCount: { query: async () => queryResult(rows.length) },
            getVersionAt: {
                query: async (_library: string, index: number) =>
                    queryResult(
                        rows[index] ?? {
                            isSome: false,
                            version_key: 0n,
                            target: "0x",
                            metadata_uri: "",
                        },
                    ),
            },
            getAddress: { query: async () => queryResult(option("0xstable")) },
            getMetadataUriAtVersion: { query: async () => queryResult(option("bafy-v0")) },
            getAddressAtVersion: { query: async () => queryResult(option("0xv0")) },
        } as unknown as RegistryContract;
    }

    function fakeIpfs() {
        return {
            fetch: async () => ({
                json: async () => ({
                    abi: [{ type: "function", name: "ping", inputs: [] }],
                    description: "test",
                }),
            }),
        };
    }

    function installOpts(
        requestedVersion: InstallRequestedVersion,
        overrides: Partial<InstallContractsOptions> = {},
    ): InstallContractsOptions {
        return {
            libraries: [{ library: "@example/counter", requestedVersion }],
            registry: fakeRegistry(),
            ipfs: fakeIpfs(),
            ...overrides,
        };
    }

    afterEach(() => {
        if (originalCdmRoot === undefined) {
            delete process.env.CDM_ROOT;
        } else {
            process.env.CDM_ROOT = originalCdmRoot;
        }
    });

    describe("installContracts", () => {
        test("installs the latest version with the stable address and emits events", async () => {
            const root = mkdtempSync(join(tmpdir(), "cdm-install-"));
            process.env.CDM_ROOT = root;
            const events: InstallEvent[] = [];

            try {
                const summary = await installContracts(
                    installOpts("latest", { onEvent: (event) => events.push(event) }),
                );

                expect(summary.success).toBe(true);
                expect(summary.results[0]).toMatchObject({
                    library: "@example/counter",
                    version: "1.1.0",
                    semver: "1.1.0",
                    address: "0xstable",
                    metadataCid: "bafy-latest",
                });
                expect(events.map((event) => event.type)).toEqual([
                    "install-start",
                    "query-start",
                    "query-done",
                    "fetch-start",
                    "install-done",
                    "pipeline-done",
                ]);
                const infoPath = join(root, "contracts", "@example/counter", "1.1.0", "info.json");
                expect(JSON.parse(readFileSync(infoPath, "utf8"))).toMatchObject({
                    name: "@example/counter",
                    version: "1.1.0",
                    address: "0xstable",
                });
            } finally {
                rmSync(root, { recursive: true, force: true });
            }
        });

        test("resolves an exact semver to its row's metadata and the stable address", async () => {
            const root = mkdtempSync(join(tmpdir(), "cdm-install-"));
            process.env.CDM_ROOT = root;

            try {
                const summary = await installContracts(installOpts("1.0.0"));

                expect(summary.success).toBe(true);
                expect(summary.results[0]).toMatchObject({
                    version: "1.0.0",
                    semver: "1.0.0",
                    address: "0xstable",
                    metadataCid: "bafy-v0",
                });
            } finally {
                rmSync(root, { recursive: true, force: true });
            }
        });

        test("reports missing exact versions as not found", async () => {
            const summary = await installContracts(installOpts("2.0.0"));

            expect(summary.success).toBe(false);
            expect(summary.errors[0].error).toBe(
                'Version "2.0.0" of "@example/counter" not found in registry',
            );
        });

        test("resolves a semver range to the greatest satisfying version", async () => {
            const root = mkdtempSync(join(tmpdir(), "cdm-install-"));
            process.env.CDM_ROOT = root;

            try {
                const summary = await installContracts(installOpts("^1.0.0"));

                expect(summary.success).toBe(true);
                expect(summary.results[0]).toMatchObject({
                    version: "1.1.0",
                    metadataCid: "bafy-latest",
                });
            } finally {
                rmSync(root, { recursive: true, force: true });
            }
        });

        test("reports unsatisfiable ranges with the published versions", async () => {
            const summary = await installContracts(installOpts("^2.0.0"));

            expect(summary.success).toBe(false);
            expect(summary.errors[0].error).toBe(
                'No version of "@example/counter" satisfies "^2.0.0" (published: 1.0.0, 1.1.0)',
            );
        });

        test("resolves legacy numeric pins by index with the per-version address", async () => {
            const root = mkdtempSync(join(tmpdir(), "cdm-install-"));
            process.env.CDM_ROOT = root;

            try {
                const summary = await installContracts(installOpts(0));

                expect(summary.success).toBe(true);
                // version stays the raw index (path segment + cdm.json value);
                // the semver derives by the registry's v1 rule 0.0.(index+1);
                // the address is THAT version's standalone contract.
                expect(summary.results[0]).toMatchObject({
                    version: 0,
                    semver: "0.0.1",
                    address: "0xv0",
                    metadataCid: "bafy-v0",
                });
                expect(summary.results[0].savedPath.endsWith("/0")).toBe(true);
            } finally {
                rmSync(root, { recursive: true, force: true });
            }
        });

        test("rejects version requests that are neither semver nor a range", async () => {
            const summary = await installContracts(installOpts("not-a-version"));

            expect(summary.success).toBe(false);
            expect(summary.errors[0].error).toContain(
                'Invalid version request "not-a-version" for "@example/counter"',
            );
        });

        test("records per-library failures without throwing", async () => {
            const root = mkdtempSync(join(tmpdir(), "cdm-install-"));
            process.env.CDM_ROOT = root;

            try {
                const summary = await installContracts(
                    installOpts(0, {
                        libraries: [{ library: "@example/missing", requestedVersion: 0 }],
                        ipfs: {
                            fetch: async () => ({
                                json: async () => ({ abi: [] }),
                            }),
                        },
                    }),
                );

                expect(summary.success).toBe(false);
                expect(summary.errors[0]).toMatchObject({
                    library: "@example/missing",
                    error: 'No ABI found in metadata for "@example/missing"',
                });
            } finally {
                rmSync(root, { recursive: true, force: true });
            }
        });

        test("classifies viem zero-data decode errors as registry misses", () => {
            expect(
                isRegistryQueryError(
                    new Error('Cannot decode zero data ("0x") with ABI parameters.'),
                ),
            ).toBe(true);
            expect(isRegistryQueryError(new Error("AbiDecodingZeroDataError"))).toBe(true);
        });

        test("does not classify unrelated errors mentioning hex values as registry misses", () => {
            expect(isRegistryQueryError(new Error("connection refused to 0xabc node"))).toBe(false);
        });

        test("rewrites decode-shape errors to a generation-mismatch message", async () => {
            const original = new Error(
                'Bytes value "0x2e516d..." is not a valid boolean. The bytes array must contain a single byte of either a 0 or 1 value.',
            );
            original.name = "InvalidBytesBooleanError";
            const registry = {
                getVersionCount: {
                    query: async () => {
                        throw original;
                    },
                },
            } as unknown as RegistryContract;

            await expect(
                resolveLatest("@example/counter", registry, "0xregistry"),
            ).rejects.toMatchObject({
                message:
                    "failed to decode registry response — the registry at 0xregistry may be a different generation than this CLI supports",
                cause: original,
            });
        });

        test("treats decoded-but-misshapen version rows as a generation mismatch", async () => {
            const registry = {
                getVersionCount: { query: async () => queryResult(1) },
                getVersionAt: {
                    // Old-shape row: no version_key/metadata_uri components.
                    query: async () => queryResult({ isSome: true, value: "0xsomething" }),
                },
            } as unknown as RegistryContract;

            await expect(resolveLatest("@example/counter", registry)).rejects.toThrow(
                "failed to decode registry response — the registry may be a different generation than this CLI supports",
            );
        });

        test("still classifies zero-data errors as misses, not generation mismatches", () => {
            const err = new Error('Cannot decode zero data ("0x") with ABI parameters.');
            expect(isRegistryQueryError(err)).toBe(true);
        });

        test("surfaces RPC failures instead of rewriting them to contract-not-found", async () => {
            const summary = await installContracts(
                installOpts("latest", {
                    registry: {
                        getVersionCount: {
                            query: async () => {
                                throw new Error("connection refused to 0xabc node");
                            },
                        },
                    } as unknown as RegistryContract,
                }),
            );

            expect(summary.success).toBe(false);
            expect(summary.errors[0].error).toBe("connection refused to 0xabc node");
        });

        test("rewrites zero-data query errors to contract-not-found with the cause attached", async () => {
            const original = new Error('Cannot decode zero data ("0x") with ABI parameters.');
            const registry = {
                getVersionCount: {
                    query: async () => {
                        throw original;
                    },
                },
            } as unknown as RegistryContract;

            await expect(resolveLatest("@example/missing", registry)).rejects.toMatchObject({
                message: 'Contract "@example/missing" not found in registry',
                cause: original,
            });
        });

        test("preserves failed registry query reasons", async () => {
            const summary = await installContracts(
                installOpts("latest", {
                    registry: {
                        getVersionCount: {
                            query: async () => ({
                                success: false,
                                value: {
                                    type: "Module",
                                    value: {
                                        type: "Revive",
                                        value: { type: "AccountUnmapped" },
                                    },
                                },
                            }),
                        },
                    } as unknown as RegistryContract,
                }),
            );

            expect(summary.success).toBe(false);
            expect(summary.errors[0].error).toContain(
                'Failed to query registry version count for "@example/counter"',
            );
            expect(summary.errors[0].error).toContain("AccountUnmapped");
        });
    });
}
