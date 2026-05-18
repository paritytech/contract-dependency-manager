import type { Package, AbiEntry } from "./types";
import type { RegistryContract } from "../context/network-context";

export interface ContractNameSearchPage {
    names: string[];
    nextOffset: number;
    done: boolean;
}

export function unwrapOption<T>(val: unknown): T | undefined {
    if (val && typeof val === "object" && "isSome" in val) {
        const opt = val as { isSome: boolean; value: T };
        return opt.isSome ? opt.value : undefined;
    }
    return val as T;
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

    const versionCount = versionResult.success ? (versionResult.value as number) : 0;
    if (versionCount === 0) return null;

    return {
        name,
        version: String(versionCount),
        weeklyCalls: 0,
        address: addressResult.success ? unwrapOption<string>(addressResult.value) : undefined,
        metadataUri: metadataResult.success
            ? unwrapOption<string>(metadataResult.value)
            : undefined,
        metadataLoaded: false,
    };
}

function parseSearchPage(value: unknown): ContractNameSearchPage {
    if (Array.isArray(value)) {
        return {
            names: Array.isArray(value[0]) ? value[0] : [],
            nextOffset: Number(value[1] ?? 0),
            done: Boolean(value[2]),
        };
    }

    if (value && typeof value === "object") {
        const page = value as {
            names?: unknown;
            next_offset?: unknown;
            nextOffset?: unknown;
            done?: unknown;
        };
        return {
            names: Array.isArray(page.names) ? (page.names as string[]) : [],
            nextOffset: Number(page.next_offset ?? page.nextOffset ?? 0),
            done: Boolean(page.done),
        };
    }

    return { names: [], nextOffset: 0, done: true };
}

export async function queryContractNamesByPrefix(
    registry: RegistryContract,
    prefix: string,
    offset: number,
    limit: number,
): Promise<ContractNameSearchPage> {
    const result = await registry.searchContractNames.query(prefix, offset, limit);
    if (!result.success) throw new Error("Failed to search contract names");
    return parseSearchPage(result.value);
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
