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
import type { MigratedContract, MigratedContractVersion, RegistryMigrationSnapshot } from "./types";

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

async function exportVersion(
    registry: RegistryContract,
    contractName: string,
    version: number,
): Promise<MigratedContractVersion> {
    const [addressResult, metadataResult] = await Promise.all([
        registry.getAddressAtVersion.query(contractName, version),
        registry.getMetadataUriAtVersion.query(contractName, version),
    ]);
    const address = unwrapOption<string>(
        requireSuccess(addressResult, `getAddressAtVersion(${contractName}, ${version})`),
    );
    const metadataUri = unwrapOption<string>(
        requireSuccess(metadataResult, `getMetadataUriAtVersion(${contractName}, ${version})`),
    );

    if (!address) {
        throw new Error(`Missing address for ${contractName} version ${version}`);
    }
    if (metadataUri === undefined) {
        throw new Error(`Missing metadata URI for ${contractName} version ${version}`);
    }

    return {
        address: address as HexString,
        metadata_uri: metadataUri,
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

    const [ownerResult, versionCountResult] = await Promise.all([
        registry.getOwner.query(contractName),
        registry.getVersionCount.query(contractName),
    ]);
    const owner = requireSuccess<string>(ownerResult, `getOwner(${contractName})`);
    const versionCount = Number(
        requireSuccess<number>(versionCountResult, `getVersionCount(${contractName})`),
    );

    const versions: MigratedContractVersion[] = [];
    for (let version = 0; version < versionCount; version++) {
        versions.push(await exportVersion(registry, contractName, version));
    }

    return {
        contract_name: contractName,
        owner: owner as HexString,
        versions,
    };
}

export async function exportRegistrySnapshot(
    opts: MigrationConnectionOptions,
): Promise<RegistryMigrationSnapshot> {
    const connection = await connectRegistry(opts);
    try {
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
            schema: "cdm.registry.v1",
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
    if (snapshot.schema !== "cdm.registry.v1") {
        throw new Error(`Unsupported registry migration schema: ${snapshot.schema}`);
    }
    if (!Array.isArray(snapshot.contracts)) {
        throw new Error("Invalid registry snapshot: contracts must be an array");
    }
    return snapshot;
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
): Promise<void> {
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
        const total = snapshot.contracts.length;
        const totalBatches = Math.ceil(total / batchSize);
        for (let start = 0; start < total; start += batchSize) {
            const batch = snapshot.contracts.slice(start, start + batchSize);
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
