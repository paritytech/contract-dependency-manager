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

/** Decoded uint128 → bigint without routing the key through Number. */
function toVersionKey(value: unknown): bigint {
    if (typeof value === "bigint") return value;
    if (typeof value === "number" || typeof value === "string") return BigInt(value);
    return 0n;
}

export async function queryContractByName(
    registry: RegistryContract,
    resolver: RegistryContract,
    name: string,
): Promise<Package | null> {
    const [latestResult, metadataResult, addressResult, proxyResult] = await Promise.all([
        registry.getLatestKey.query(name),
        registry.getMetadataUri.query(name),
        registry.getAddress.query(name),
        registry.getProxy.query(name),
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

    // The resolver keys routing state by the name's proxy: `(latest_key,
    // latest_impl, min_supported, frozen, fast_path_off, sealed)`.
    // `min_supported` is 0 when no support floor has been set.
    const proxyAddress = unwrapOption<string>(proxyResult.value);
    const routingResult = await resolver.routingOf.query(proxyAddress);
    if (!routingResult.success) {
        throw registryQueryError(`Failed to query routing for ${name}`, routingResult.value);
    }
    const routing = routingResult.value as {
        min_supported?: unknown;
        minSupported?: unknown;
        fast_path_off?: unknown;
        fastPathOff?: unknown;
        sealed?: unknown;
    };
    const minSupportedKey = toVersionKey(routing.min_supported ?? routing.minSupported);
    const sealed = routing.sealed === true;

    return {
        name,
        version: keyToSemver(latestKey),
        weeklyCalls: 0,
        address: unwrapOption<string>(addressResult.value),
        proxyAddress,
        minSupportedVersion: minSupportedKey === 0n ? undefined : keyToSemver(minSupportedKey),
        sealed,
        // Sealing hands the proxy its latest version whatever the opt-out says.
        fastPathOff: !sealed && (routing.fast_path_off ?? routing.fastPathOff) === true,
        metadataUri: unwrapOption<string>(metadataResult.value),
        metadataLoaded: false,
    };
}

/** `(name, version_key, address, metadata_uri, owner)`; `address` is the per-name proxy. */
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
    version: string;
    /** Packed semver key: `(major<<64)|(minor<<32)|patch`. */
    key: bigint;
    /** The version's implementation contract; empty when the resolver read fails. */
    target: string;
    metadataUri: string;
}

/** Decode a `getVersionAt` tuple: `(isSome, version_key, metadata_uri)`. */
function parseVersionEntry(value: unknown): Omit<PackageVersionInfo, "target"> | null {
    let isSome: unknown;
    let versionKey: unknown;
    let metadataUri: unknown;

    if (Array.isArray(value)) {
        [isSome, versionKey, metadataUri] = value;
    } else if (value && typeof value === "object") {
        const entry = value as {
            isSome?: unknown;
            is_some?: unknown;
            version_key?: unknown;
            versionKey?: unknown;
            metadata_uri?: unknown;
            metadataUri?: unknown;
        };
        isSome = entry.isSome ?? entry.is_some;
        versionKey = entry.version_key ?? entry.versionKey;
        metadataUri = entry.metadata_uri ?? entry.metadataUri;
    }

    if (!isSome) return null;

    const key = toVersionKey(versionKey);
    return {
        version: keyToSemver(key),
        key,
        metadataUri: typeof metadataUri === "string" ? metadataUri : "",
    };
}

/** The resolver's `implOf(proxy, key)`; empty when the read fails. */
async function queryImplementation(
    resolver: RegistryContract,
    proxyAddress: string | undefined,
    key: bigint,
): Promise<string> {
    try {
        const result = await resolver.implOf.query(proxyAddress, key);
        return result.success && typeof result.value === "string" ? result.value : "";
    } catch {
        return "";
    }
}

/**
 * Every published version, ascending: the registry's `getVersionAt` per
 * index, each paired with its implementation from the resolver.
 */
export async function queryContractVersions(
    registry: RegistryContract,
    resolver: RegistryContract,
    name: string,
): Promise<PackageVersionInfo[]> {
    const [countResult, proxyResult] = await Promise.all([
        registry.getVersionCount.query(name),
        registry.getProxy.query(name),
    ]);
    if (!countResult.success) {
        throw registryQueryError(`Failed to query version count for ${name}`, countResult.value);
    }
    if (!proxyResult.success) {
        throw registryQueryError(`Failed to query proxy for ${name}`, proxyResult.value);
    }
    const count = Number(countResult.value ?? 0);
    // The resolver keys implementations by the name's proxy.
    const proxyAddress = unwrapOption<string>(proxyResult.value);

    const entries = await Promise.all(
        Array.from({ length: count }, async (_, index) => {
            const result = await registry.getVersionAt.query(name, index);
            if (!result.success) {
                throw registryQueryError(
                    `Failed to query version ${index} for ${name}`,
                    result.value,
                );
            }
            const entry = parseVersionEntry(result.value);
            if (!entry) return null;
            return {
                ...entry,
                target: await queryImplementation(resolver, proxyAddress, entry.key),
            };
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
