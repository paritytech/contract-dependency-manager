import type { Package, AbiEntry } from "./types";
import { ALICE_SS58 } from "@dotdm/utils";

export function unwrapOption<T>(val: unknown): T | undefined {
    if (val && typeof val === "object" && "isSome" in val) {
        const opt = val as { isSome: boolean; value: T };
        return opt.isSome ? opt.value : undefined;
    }
    return val as T;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function queryContractByName(registry: any, name: string): Promise<Package | null> {
    const [versionResult, metadataResult, addressResult] = await Promise.all([
        registry.query("getVersionCount", { origin: ALICE_SS58, data: { contract_name: name } }),
        registry.query("getMetadataUri", { origin: ALICE_SS58, data: { contract_name: name } }),
        registry.query("getAddress", { origin: ALICE_SS58, data: { contract_name: name } }),
    ]);

    const versionCount = versionResult.success ? versionResult.value.response : 0;
    if (versionCount === 0) return null;

    return {
        name,
        version: String(versionCount),
        weeklyCalls: 0,
        address: addressResult.success
            ? unwrapOption<string>(addressResult.value.response)
            : undefined,
        metadataUri: metadataResult.success
            ? unwrapOption<string>(metadataResult.value.response)
            : undefined,
        metadataLoaded: false,
    };
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
        author,
        lastPublished,
        publishedDate: lastPublished,
        abi,
        metadataLoaded: true,
    };
}
