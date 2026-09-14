import { stringifyBigInt } from "@parity/cdm-utils";
import type { Package, AbiEntry } from "./types";
import type { RegistryContract } from "../utils/contracts";

export interface ContractPage {
    total: number;
    packages: Package[];
}

export function unwrapOption<T>(val: unknown): T | undefined {
    if (val && typeof val === "object" && "isSome" in val) {
        const opt = val as { isSome: boolean; value: T };
        return opt.isSome ? opt.value : undefined;
    }
    return val as T;
}

export function registryQueryError(action: string, value: unknown): Error {
    return new Error(`${action}: ${stringifyBigInt(value)}`);
}

export async function queryContractByName(
    registry: RegistryContract,
    name: string,
): Promise<Package | null> {
    const [versionResult, metadataResult, addressResult] = await Promise.all([
        registry.getVersionCount.query(name),
        registry.getMetadataUri.query(name),
        registry.getAddress.query(name),
    ]);

    if (!versionResult.success) {
        throw registryQueryError(`Failed to query version count for ${name}`, versionResult.value);
    }

    const versionCount = versionResult.value as number;
    if (versionCount === 0) return null;
    const latestVersion = versionCount - 1;

    if (!metadataResult.success) {
        throw registryQueryError(`Failed to query metadata URI for ${name}`, metadataResult.value);
    }
    if (!addressResult.success) {
        throw registryQueryError(`Failed to query address for ${name}`, addressResult.value);
    }

    return {
        name,
        version: String(latestVersion),
        weeklyCalls: 0,
        address: unwrapOption<string>(addressResult.value),
        metadataUri: unwrapOption<string>(metadataResult.value),
        metadataLoaded: false,
    };
}

function parseContractEntry(value: unknown): Package | null {
    let name: unknown;
    let version: unknown;
    let address: unknown;
    let metadataUri: unknown;

    if (Array.isArray(value)) {
        [name, version, address, metadataUri] = value;
    } else if (value && typeof value === "object") {
        const entry = value as {
            name?: unknown;
            version?: unknown;
            address?: unknown;
            metadata_uri?: unknown;
            metadataUri?: unknown;
        };
        name = entry.name;
        version = entry.version;
        address = entry.address;
        metadataUri = entry.metadata_uri ?? entry.metadataUri;
    }

    if (typeof name !== "string") return null;

    return {
        name,
        version: String(Number(version ?? 0)),
        weeklyCalls: 0,
        address: typeof address === "string" ? address : undefined,
        metadataUri: typeof metadataUri === "string" ? metadataUri : undefined,
        metadataLoaded: false,
    };
}

function parseContractPage(value: unknown): ContractPage {
    let total: unknown;
    let entries: unknown;

    if (Array.isArray(value)) {
        [total, entries] = value;
    } else if (value && typeof value === "object") {
        const page = value as { total?: unknown; entries?: unknown };
        total = page.total;
        entries = page.entries;
    }

    return {
        total: Number(total ?? 0),
        packages: Array.isArray(entries)
            ? entries.map(parseContractEntry).filter((pkg): pkg is Package => pkg !== null)
            : [],
    };
}

export async function queryContractsPage(
    registry: RegistryContract,
    start: number,
    count: number,
): Promise<ContractPage> {
    const result = await registry.getContracts.query(start, count);
    if (!result.success) throw registryQueryError("Failed to query contract page", result.value);
    return parseContractPage(result.value);
}

export interface PackageVersionInfo {
    version: number;
    address?: string;
    metadataUri?: string;
}

/**
 * Query every published version of a contract: version count first, then each
 * version's address and metadata URI in parallel. Returned in ascending
 * version order (0..count-1).
 */
export async function queryContractVersions(
    registry: RegistryContract,
    name: string,
): Promise<PackageVersionInfo[]> {
    const countResult = await registry.getVersionCount.query(name);
    if (!countResult.success) {
        throw registryQueryError(`Failed to query version count for ${name}`, countResult.value);
    }
    const count = Number(countResult.value ?? 0);

    return Promise.all(
        Array.from({ length: count }, async (_, version) => {
            const [addressResult, metadataResult] = await Promise.all([
                registry.getAddressAtVersion.query(name, version),
                registry.getMetadataUriAtVersion.query(name, version),
            ]);
            if (!addressResult.success) {
                throw registryQueryError(
                    `Failed to query address for ${name} v${version}`,
                    addressResult.value,
                );
            }
            if (!metadataResult.success) {
                throw registryQueryError(
                    `Failed to query metadata URI for ${name} v${version}`,
                    metadataResult.value,
                );
            }
            return {
                version,
                address: unwrapOption<string>(addressResult.value),
                metadataUri: unwrapOption<string>(metadataResult.value),
            };
        }),
    );
}

export function metadataCidFromUri(uri: string | undefined): string | undefined {
    if (!uri) return undefined;
    if (uri.startsWith("ipfs://")) return uri.slice("ipfs://".length);
    const ipfsPath = "/ipfs/";
    const idx = uri.indexOf(ipfsPath);
    if (idx >= 0) return uri.slice(idx + ipfsPath.length);
    return uri.includes(":") ? undefined : uri;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function parseMetadata(metadata: any): Partial<Package> {
    const author =
        Array.isArray(metadata.authors) && metadata.authors.length > 0
            ? metadata.authors.join(", ")
            : undefined;

    const lastPublished = metadata.published_at
        ? new Date(metadata.published_at).toLocaleDateString("en-US", {
              year: "numeric",
              month: "short",
              day: "numeric",
          })
        : undefined;

    const abi: AbiEntry[] | undefined = Array.isArray(metadata.abi) ? metadata.abi : undefined;

    return {
        description: metadata.description || undefined,
        readme: metadata.readme || undefined,
        homepage: metadata.homepage || undefined,
        repository: metadata.repository || undefined,
        license: metadata.license || undefined,
        keywords: Array.isArray(metadata.keywords) ? metadata.keywords : undefined,
        dependencies:
            metadata.dependencies && typeof metadata.dependencies === "object"
                ? metadata.dependencies
                : undefined,
        author,
        lastPublished,
        publishedDate: lastPublished,
        abi,
        metadataLoaded: true,
    };
}
