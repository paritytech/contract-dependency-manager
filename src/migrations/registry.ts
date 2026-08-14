import { readFile, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import type { HexString } from "polkadot-api";
import { createContractFromClient } from "@parity/product-sdk-contracts";
import {
    createCdmAssetHubClient,
    DEFAULT_NODE_URL,
    getChainPreset,
    getRegistryAddress,
    prepareSigner,
    prepareSignerFromMnemonic,
    prepareSignerFromSuri,
    resolveQueryOrigin,
    ss58Address,
} from "@parity/cdm-env";
import { CONTRACTS_REGISTRY_ABI } from "@parity/cdm-builder";
import { getAccount } from "@parity/cdm-utils/accounts";
import type {
    ImportContract,
    MigratedContract,
    MigratedContractVersion,
    RegistryMigrationSnapshot,
} from "./types";

type RegistryContract = Awaited<ReturnType<typeof createContractFromClient>>;

export interface MigrationConnectionOptions {
    name?: string;
    assethubUrl?: string;
    registryAddress?: string;
}

export interface ImportOptions extends MigrationConnectionOptions {
    suri?: string;
    batchSize?: number;
}

export interface ImportProgress {
    imported: number;
    total: number;
    batchIndex: number;
    totalBatches: number;
}

function requireSuccess<T>(result: { success?: boolean; value?: unknown }, action: string): T {
    if (!result.success) {
        throw new Error(`${action}: ${JSON.stringify(result.value)}`);
    }
    return result.value as T;
}

function unwrapOption<T>(value: unknown): T | undefined {
    if (Array.isArray(value)) {
        return value[0] ? (value[1] as T) : undefined;
    }
    if (value && typeof value === "object" && "isSome" in value) {
        const opt = value as { isSome: boolean; value: T };
        return opt.isSome ? opt.value : undefined;
    }
    return value as T | undefined;
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
 * What probing a versioned-registry selector on an unsupported registry looks
 * like: a typed `UnknownSelector()` revert on newer dispatchers, or
 * zero/garbage return data (viem `AbiDecoding*` failures) on the oldest ones.
 * Anything else (transport failures, timeouts) is a real error and must
 * propagate.
 */
function isUnversionedSurfaceError(err: unknown): boolean {
    const msg = errorText(err);
    return (
        msg.includes("UnknownSelector") ||
        msg.includes("zero data") ||
        msg.includes("AbiDecoding") ||
        msg.includes("out of bounds") ||
        msg.includes("reverted")
    );
}

/**
 * Fails fast unless the registry speaks the versioned surface —
 * `getVersionAt`, `getProxy`, `getProxyCodeHash`. Probed with the cheapest
 * versioned-only view; a registry without it rejects the unknown selector,
 * surfacing as a failed query or a decode error.
 */
async function requireVersionedRegistry(
    registry: RegistryContract,
    registryAddress: HexString,
): Promise<void> {
    let supported: boolean;
    try {
        supported = (await registry.getProxyCodeHash.query()).success === true;
    } catch (err) {
        if (!isUnversionedSurfaceError(err)) throw err;
        supported = false;
    }
    if (!supported) {
        throw new Error(
            `Registry at ${registryAddress} does not expose the versioned registry surface ` +
                `(getVersionAt/getProxy) and is not supported by this tooling`,
        );
    }
}

export function resolveMigrationTarget(opts: MigrationConnectionOptions): {
    assethubUrl: string;
    registryAddress: HexString;
} {
    const preset = opts.name ? getChainPreset(opts.name) : undefined;
    const assethubUrl =
        opts.assethubUrl ?? preset?.assethubUrl ?? (opts.name ? undefined : DEFAULT_NODE_URL);
    const registryAddress =
        opts.registryAddress ?? preset?.registryAddress ?? getRegistryAddress(opts.name);

    if (!assethubUrl) {
        throw new Error("Missing Asset Hub URL. Pass --assethub-url or --name.");
    }
    if (!registryAddress) {
        throw new Error("Missing registry address. Pass --registry-address or --name.");
    }

    return {
        assethubUrl,
        registryAddress: registryAddress as HexString,
    };
}

export async function connectRegistry(
    opts: MigrationConnectionOptions & {
        signer?: ReturnType<typeof prepareSigner>;
        origin?: string;
    },
): Promise<{
    registry: RegistryContract;
    destroy: () => void;
    assethubUrl: string;
    registryAddress: HexString;
}> {
    const { assethubUrl, registryAddress } = resolveMigrationTarget(opts);
    const client = await createCdmAssetHubClient(assethubUrl, opts.name);
    await client.raw.assetHub.getChainSpecData();

    const registry = await createContractFromClient(
        client.raw.assetHub,
        client.descriptors.assetHub,
        registryAddress,
        CONTRACTS_REGISTRY_ABI,
        {
            defaultSigner: opts.signer,
            defaultOrigin:
                opts.origin ??
                resolveQueryOrigin({
                    chainName: opts.name,
                    assethubUrl,
                }),
        },
    );

    return {
        registry,
        assethubUrl,
        registryAddress,
        destroy: () => client.destroy(),
    };
}

/** Decoded `getVersionAt` row (flat option-shaped tuple). */
interface VersionAtRow {
    isSome: boolean;
    version_key: bigint;
    target: string;
    metadata_uri: string;
}

async function exportVersion(
    registry: RegistryContract,
    contractName: string,
    index: number,
): Promise<MigratedContractVersion> {
    const result = await registry.getVersionAt.query(contractName, index);
    const row = requireSuccess<VersionAtRow>(result, `getVersionAt(${contractName}, ${index})`);
    if (!row?.isSome) {
        throw new Error(`Missing version row for ${contractName} at index ${index}`);
    }
    return {
        versionKey: String(row.version_key),
        target: row.target as HexString,
        metadataUri: row.metadata_uri,
    };
}

async function exportContract(
    registry: RegistryContract,
    index: number,
): Promise<MigratedContract> {
    const nameResult = await registry.getContractNameAt.query(index);
    const contractName = requireSuccess<string>(nameResult, `getContractNameAt(${index})`);
    if (!contractName) {
        throw new Error(`Empty contract name at index ${index}`);
    }

    const [ownerResult, versionCountResult, proxyResult] = await Promise.all([
        registry.getOwner.query(contractName),
        registry.getVersionCount.query(contractName),
        registry.getProxy.query(contractName),
    ]);
    const owner = requireSuccess<string>(ownerResult, `getOwner(${contractName})`);
    const versionCount = Number(
        requireSuccess<number>(versionCountResult, `getVersionCount(${contractName})`),
    );
    const proxy = unwrapOption<string>(requireSuccess(proxyResult, `getProxy(${contractName})`));
    if (!proxy || proxy === ZERO_ADDRESS) {
        throw new Error(`Missing per-name proxy for ${contractName}`);
    }

    const versions: MigratedContractVersion[] = [];
    for (let version = 0; version < versionCount; version++) {
        versions.push(await exportVersion(registry, contractName, version));
    }

    return {
        contract_name: contractName,
        owner: owner as HexString,
        proxy: proxy as HexString,
        versions,
    };
}

export async function exportRegistrySnapshot(
    opts: MigrationConnectionOptions,
): Promise<RegistryMigrationSnapshot> {
    const connection = await connectRegistry(opts);
    try {
        await requireVersionedRegistry(connection.registry, connection.registryAddress);
        const total = Number(
            requireSuccess<number>(
                await connection.registry.getContractCount.query(),
                "getContractCount",
            ),
        );

        const contracts: MigratedContract[] = [];
        for (let index = 0; index < total; index++) {
            contracts.push(await exportContract(connection.registry, index));
        }
        return {
            schema: "cdm.registry.v2",
            exported_at: new Date().toISOString(),
            chain: opts.name,
            assethub_url: connection.assethubUrl,
            registry_address: connection.registryAddress,
            contract_count: total,
            contracts,
        };
    } finally {
        connection.destroy();
    }
}

export async function writeRegistrySnapshot(
    path: string,
    snapshot: RegistryMigrationSnapshot,
): Promise<void> {
    await writeFile(path, `${JSON.stringify(snapshot, null, 2)}\n`);
}

export async function readRegistrySnapshot(path: string): Promise<RegistryMigrationSnapshot> {
    const snapshot = JSON.parse(await readFile(path, "utf8")) as RegistryMigrationSnapshot;
    if (snapshot.schema !== "cdm.registry.v2") {
        throw new Error(
            `Unsupported registry migration schema: ${(snapshot as { schema?: unknown }).schema}`,
        );
    }
    if (!Array.isArray(snapshot.contracts)) {
        throw new Error("Invalid registry snapshot: contracts must be an array");
    }
    return snapshot;
}

/** 20 zero bytes — never a valid per-name proxy. */
export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as HexString;

/**
 * Snapshot entries carry keys and proxies verbatim; only the bigints revive.
 * Every name must bring its live per-name proxy — the registry has no
 * proxy-less records.
 */
export function contractToImport(contract: MigratedContract): ImportContract {
    if (!contract.proxy || contract.proxy === ZERO_ADDRESS) {
        throw new Error(`Snapshot entry for ${contract.contract_name} has no per-name proxy`);
    }
    return {
        contract_name: contract.contract_name,
        owner: contract.owner,
        proxy: contract.proxy,
        versions: contract.versions.map((version) => ({
            version_key: BigInt(version.versionKey),
            target: version.target,
            metadata_uri: version.metadataUri,
        })),
    };
}

/** Snapshot → `adminImportContracts` payload entries. */
export function snapshotToImportContracts(snapshot: RegistryMigrationSnapshot): ImportContract[] {
    return snapshot.contracts.map(contractToImport);
}

function resolveSigner(opts: ImportOptions) {
    if (opts.suri) return prepareSignerFromSuri(opts.suri);
    if (opts.name) {
        const account = getAccount(opts.name);
        if (account) return prepareSignerFromMnemonic(account.mnemonic);
    }
    return prepareSigner("Alice");
}

export async function importRegistrySnapshot(
    snapshot: RegistryMigrationSnapshot,
    opts: ImportOptions,
    onProgress?: (progress: ImportProgress) => void,
): Promise<{ imported: number; skipped: number }> {
    const batchSize = opts.batchSize ?? 10;
    if (!Number.isInteger(batchSize) || batchSize <= 0) {
        throw new Error(`Invalid batch size: ${batchSize}`);
    }

    const signer = resolveSigner(opts);
    const connection = await connectRegistry({
        ...opts,
        signer,
        origin: ss58Address(signer.publicKey),
    });
    try {
        // Probe the target registry first and skip contracts that already
        // exist: adminImportContracts rejects duplicates with
        // ImportContractExists, so without this a half-failed run could never
        // be retried.
        const entries = snapshotToImportContracts(snapshot);
        const remaining: ImportContract[] = [];
        for (const contract of entries) {
            const countResult = await connection.registry.getVersionCount.query(
                contract.contract_name,
            );
            const versionCount = Number(
                requireSuccess<number>(countResult, `getVersionCount(${contract.contract_name})`),
            );
            if (versionCount === 0) remaining.push(contract);
        }
        const skipped = entries.length - remaining.length;
        if (skipped > 0) {
            console.log(`skipped ${skipped} already-imported contracts`);
        }

        const total = remaining.length;
        const totalBatches = Math.ceil(total / batchSize);
        for (let start = 0; start < total; start += batchSize) {
            const batch = remaining.slice(start, start + batchSize);
            const result = await connection.registry.adminImportContracts.tx(batch);
            if (!result.ok) {
                throw new Error(
                    `adminImportContracts batch ${Math.floor(start / batchSize) + 1}/${totalBatches} failed: ${result.error.message}`,
                    { cause: result.error },
                );
            }
            onProgress?.({
                imported: Math.min(start + batch.length, total),
                total,
                batchIndex: Math.floor(start / batchSize) + 1,
                totalBatches,
            });
        }
        return { imported: total, skipped };
    } finally {
        connection.destroy();
    }
}

export function parseCommonMigrationArgs(args = process.argv.slice(2)) {
    return parseArgs({
        args,
        options: {
            name: { type: "string", short: "n" },
            "assethub-url": { type: "string" },
            "registry-address": { type: "string" },
        },
    }).values;
}
