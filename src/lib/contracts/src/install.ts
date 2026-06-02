import type { Contract, ContractDef } from "@parity/product-sdk-contracts";
import { mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { stringifyBigInt } from "@dotdm/utils";
import type { AbiEntry } from "./deployer";
import { saveContract } from "./store";

export type InstallRequestedVersion = number | "latest";

export interface InstallLibraryRequest {
    library: string;
    requestedVersion: InstallRequestedVersion;
}

export interface InstallResult {
    library: string;
    version: number;
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
          version: number;
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
    artifactsDir?: string;
    onEvent?: (event: InstallEvent) => void;
}

function isRegistryQueryError(err: unknown): boolean {
    const msg = err instanceof Error ? err.message : String(err);
    return msg.includes("zero data") || msg.includes("0x") || msg.includes("AbiDecoding");
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
    return new Error(`${action} for "${library}": ${stringifyBigInt(value)}`);
}

async function queryLatest(
    library: string,
    registry: RegistryContract,
): Promise<{ version: number; metadataCid: string; contractAddress: string }> {
    let versionResult;
    try {
        versionResult = await registry.getVersionCount.query(library);
    } catch (err) {
        if (isRegistryQueryError(err)) {
            throw new Error(`Contract "${library}" not found in registry`);
        }
        throw err;
    }
    if (!versionResult.success) {
        throw queryFailure("Failed to query registry version count", library, versionResult.value);
    }
    if (typeof versionResult.value !== "number" || versionResult.value === 0) {
        throw new Error(`Contract "${library}" not found in registry`);
    }
    const version = versionResult.value - 1;

    let metaResult;
    try {
        metaResult = await registry.getMetadataUri.query(library);
    } catch (err) {
        if (isRegistryQueryError(err)) {
            throw new Error(`Failed to fetch metadata for "${library}" from registry`);
        }
        throw err;
    }
    if (!metaResult.success) {
        throw queryFailure("Failed to query metadata URI", library, metaResult.value);
    }
    const metadataCid = unwrapOption<string>(metaResult.value) ?? "";
    if (!metadataCid) {
        throw new Error(`No metadata URI found for "${library}"`);
    }

    let addrResult;
    try {
        addrResult = await registry.getAddress.query(library);
    } catch (err) {
        if (isRegistryQueryError(err)) {
            throw new Error(`Failed to fetch address for "${library}" from registry`);
        }
        throw err;
    }
    if (!addrResult.success) {
        throw queryFailure("Failed to query address", library, addrResult.value);
    }
    const contractAddress = unwrapOption<string>(addrResult.value) ?? "";

    return { version, metadataCid, contractAddress };
}

async function queryVersion(
    library: string,
    requestedVersion: number,
    registry: RegistryContract,
): Promise<{ version: number; metadataCid: string; contractAddress: string }> {
    let metaResult;
    try {
        metaResult = await registry.getMetadataUriAtVersion.query(library, requestedVersion);
    } catch (err) {
        if (isRegistryQueryError(err)) {
            throw new Error(`Version ${requestedVersion} of "${library}" not found in registry`);
        }
        throw err;
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
        if (isRegistryQueryError(err)) {
            throw new Error(
                `Failed to fetch address for "${library}" version ${requestedVersion} from registry`,
            );
        }
        throw err;
    }
    if (!addrResult.success) {
        throw queryFailure(
            `Failed to query address for version ${requestedVersion}`,
            library,
            addrResult.value,
        );
    }
    const contractAddress = unwrapOption<string>(addrResult.value) ?? "";

    return { version: requestedVersion, metadataCid, contractAddress };
}

async function installOne(
    request: InstallLibraryRequest,
    opts: InstallContractsOptions,
): Promise<InstallResult> {
    const emit = opts.onEvent;
    const { library, requestedVersion } = request;

    emit?.({ type: "install-start", library, requestedVersion });
    emit?.({ type: "query-start", library });

    const { version, metadataCid, contractAddress } =
        requestedVersion === "latest"
            ? await queryLatest(library, opts.registry)
            : await queryVersion(library, requestedVersion, opts.registry);

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

    function fakeRegistry() {
        return {
            getVersionCount: { query: async () => queryResult(2) },
            getMetadataUri: { query: async () => queryResult(option("bafy-latest")) },
            getAddress: { query: async () => queryResult(option("0xlatest")) },
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

    afterEach(() => {
        if (originalCdmRoot === undefined) {
            delete process.env.CDM_ROOT;
        } else {
            process.env.CDM_ROOT = originalCdmRoot;
        }
    });

    describe("installContracts", () => {
        test("installs latest contract metadata and emits events", async () => {
            const root = mkdtempSync(join(tmpdir(), "cdm-install-"));
            process.env.CDM_ROOT = root;
            const events: InstallEvent[] = [];

            try {
                const summary = await installContracts({
                    libraries: [{ library: "@example/counter", requestedVersion: "latest" }],
                    registry: fakeRegistry(),
                    ipfs: fakeIpfs(),
                    onEvent: (event) => events.push(event),
                });

                expect(summary.success).toBe(true);
                expect(summary.results[0]).toMatchObject({
                    library: "@example/counter",
                    version: 1,
                    address: "0xlatest",
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
                const infoPath = join(root, "contracts", "@example/counter", "1", "info.json");
                expect(JSON.parse(readFileSync(infoPath, "utf8"))).toMatchObject({
                    name: "@example/counter",
                    version: 1,
                });
            } finally {
                rmSync(root, { recursive: true, force: true });
            }
        });

        test("records per-library failures without throwing", async () => {
            const root = mkdtempSync(join(tmpdir(), "cdm-install-"));
            process.env.CDM_ROOT = root;

            try {
                const summary = await installContracts({
                    libraries: [{ library: "@example/missing", requestedVersion: 0 }],
                    registry: fakeRegistry(),
                    ipfs: {
                        fetch: async () => ({
                            json: async () => ({ abi: [] }),
                        }),
                    },
                });

                expect(summary.success).toBe(false);
                expect(summary.errors[0]).toMatchObject({
                    library: "@example/missing",
                    error: 'No ABI found in metadata for "@example/missing"',
                });
            } finally {
                rmSync(root, { recursive: true, force: true });
            }
        });

        test("preserves failed registry query reasons", async () => {
            const root = mkdtempSync(join(tmpdir(), "cdm-install-"));
            process.env.CDM_ROOT = root;

            try {
                const summary = await installContracts({
                    libraries: [{ library: "@example/counter", requestedVersion: "latest" }],
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
                    ipfs: fakeIpfs(),
                });

                expect(summary.success).toBe(false);
                expect(summary.errors[0].error).toContain(
                    'Failed to query registry version count for "@example/counter"',
                );
                expect(summary.errors[0].error).toContain("AccountUnmapped");
            } finally {
                rmSync(root, { recursive: true, force: true });
            }
        });
    });
}
