import { stringifyBigInt } from "@parity/cdm-utils";
import type { Package, AbiEntry } from "./types";
import { keyToSemver } from "@parity/cdm-builder/proxy";
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

/**
 * Coerce a decoded uint128 version key to bigint. product-sdk delivers
 * uint128 values as bigint; tolerate number/string decodes without ever
 * routing the key through Number.
 */
function toVersionKey(value: unknown): bigint {
    if (typeof value === "bigint") return value;
    if (typeof value === "number" || typeof value === "string") return BigInt(value);
    return 0n;
}

export async function queryContractByName(
    registry: RegistryContract,
    name: string,
): Promise<Package | null> {
    const [latestResult, metadataResult, addressResult, proxyResult, minSupportedResult] =
        await Promise.all([
            registry.getLatestKey.query(name),
            registry.getMetadataUri.query(name),
            registry.getAddress.query(name),
            registry.getProxy.query(name),
            registry.getMinSupported.query(name),
        ]);

    if (!latestResult.success) {
        throw registryQueryError(`Failed to query latest version for ${name}`, latestResult.value);
    }

    // getLatestKey returns 0 for unknown names; published keys are never 0.
    const latestKey = toVersionKey(latestResult.value);
    if (latestKey === 0n) return null;

    if (!metadataResult.success) {
        throw registryQueryError(`Failed to query metadata URI for ${name}`, metadataResult.value);
    }
    if (!addressResult.success) {
        throw registryQueryError(`Failed to query address for ${name}`, addressResult.value);
    }
    if (!proxyResult.success) {
        throw registryQueryError(`Failed to query proxy for ${name}`, proxyResult.value);
    }
    if (!minSupportedResult.success) {
        throw registryQueryError(
            `Failed to query min supported version for ${name}`,
            minSupportedResult.value,
        );
    }

    // getMinSupported returns 0 when no support floor has been set.
    const minSupportedKey = toVersionKey(minSupportedResult.value);

    return {
        name,
        version: keyToSemver(latestKey),
        weeklyCalls: 0,
        address: unwrapOption<string>(addressResult.value),
        proxyAddress: unwrapOption<string>(proxyResult.value),
        minSupportedVersion: minSupportedKey === 0n ? undefined : keyToSemver(minSupportedKey),
        metadataUri: unwrapOption<string>(metadataResult.value),
        metadataLoaded: false,
    };
}

/**
 * Decode a `getContracts` entry: `(name, version_key, address, metadata_uri,
 * owner)`. `address` is the name's stable address (per-name proxy for
 * new-era names, the latest standalone contract for legacy ones); the
 * trailing `owner` is not surfaced.
 */
function parseContractEntry(value: unknown): Package | null {
    let name: unknown;
    let versionKey: unknown;
    let address: unknown;
    let metadataUri: unknown;

    if (Array.isArray(value)) {
        [name, versionKey, address, metadataUri] = value;
    } else if (value && typeof value === "object") {
        const entry = value as {
            name?: unknown;
            version_key?: unknown;
            versionKey?: unknown;
            address?: unknown;
            metadata_uri?: unknown;
            metadataUri?: unknown;
        };
        name = entry.name;
        versionKey = entry.version_key ?? entry.versionKey;
        address = entry.address;
        metadataUri = entry.metadata_uri ?? entry.metadataUri;
    }

    if (typeof name !== "string") return null;

    return {
        name,
        version: keyToSemver(toVersionKey(versionKey)),
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
    /** Semver string derived from the packed key (e.g. "1.2.3"). */
    version: string;
    /** Packed semver key: `(major<<64)|(minor<<32)|patch`. */
    key: bigint;
    /** The version's implementation contract (or legacy standalone address). */
    target: string;
    metadataUri: string;
}

/** Decode a `getVersionAt` tuple: `(isSome, version_key, target, metadata_uri)`. */
function parseVersionEntry(value: unknown): PackageVersionInfo | null {
    let isSome: unknown;
    let versionKey: unknown;
    let target: unknown;
    let metadataUri: unknown;

    if (Array.isArray(value)) {
        [isSome, versionKey, target, metadataUri] = value;
    } else if (value && typeof value === "object") {
        const entry = value as {
            isSome?: unknown;
            is_some?: unknown;
            version_key?: unknown;
            versionKey?: unknown;
            target?: unknown;
            metadata_uri?: unknown;
            metadataUri?: unknown;
        };
        isSome = entry.isSome ?? entry.is_some;
        versionKey = entry.version_key ?? entry.versionKey;
        target = entry.target;
        metadataUri = entry.metadata_uri ?? entry.metadataUri;
    }

    if (!isSome || typeof target !== "string") return null;

    const key = toVersionKey(versionKey);
    return {
        version: keyToSemver(key),
        key,
        target,
        metadataUri: typeof metadataUri === "string" ? metadataUri : "",
    };
}

/**
 * Query every published version of a contract: version count first, then
 * `getVersionAt` for each index in parallel. Works for both eras (legacy
 * keys derive on-chain as `0.0.(index+1)`). Returned in ascending version
 * order (index 0..count-1).
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

    const entries = await Promise.all(
        Array.from({ length: count }, async (_, index) => {
            const result = await registry.getVersionAt.query(name, index);
            if (!result.success) {
                throw registryQueryError(
                    `Failed to query version ${index} for ${name}`,
                    result.value,
                );
            }
            return parseVersionEntry(result.value);
        }),
    );

    return entries.filter((entry): entry is PackageVersionInfo => entry !== null);
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

    // Newer metadata may also carry `storage_layout`; like any field not
    // listed below it is intentionally ignored (not rendered).
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
