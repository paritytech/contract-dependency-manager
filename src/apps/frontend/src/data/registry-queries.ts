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

// The reverted on-chain registry has no prefix-search method, only indexed
// iteration via `getContractCount` + `getContractNameAt(index)`. We emulate the
// previous paged-search surface by client-side filtering: walk registry indices
// starting at `offset`, lower-case-substring-match each name against `prefix`,
// and collect up to `limit` matches before returning. `nextOffset` is the next
// raw registry index to resume from (so it advances by however many indices we
// scanned, not by how many matches we returned); `done` flips to true once we
// reach the end of the registry list.
export async function queryContractNamesByPrefix(
    registry: RegistryContract,
    prefix: string,
    offset: number,
    limit: number,
): Promise<ContractNameSearchPage> {
    const countResult = await registry.getContractCount.query();
    if (!countResult.success) throw new Error("Failed to query contract count");
    const total = Number(countResult.value ?? 0);

    if (offset >= total) {
        return { names: [], nextOffset: total, done: true };
    }

    const needle = prefix.toLowerCase();
    const names: string[] = [];
    let cursor = offset;

    while (cursor < total && names.length < limit) {
        const nameResult = await registry.getContractNameAt.query(cursor);
        cursor += 1;
        if (!nameResult.success) continue;
        const name = String(nameResult.value ?? "");
        if (!name) continue;
        if (needle === "" || name.toLowerCase().includes(needle)) {
            names.push(name);
        }
    }

    return {
        names,
        nextOffset: cursor,
        done: cursor >= total,
    };
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
