export interface AbiParam {
    name: string;
    type: string;
    components?: AbiParam[];
}

export interface AbiEntry {
    type: string;
    name?: string;
    inputs: AbiParam[];
    outputs?: AbiParam[];
    stateMutability?: string;
    anonymous?: boolean;
}

export interface Package {
    name: string;
    /** Latest published version as a semver string (e.g. "1.2.3"). */
    version: string;
    description?: string;
    author?: string;
    weeklyCalls?: number;
    license?: string;
    keywords?: string[];
    publishedDate?: string;
    lastPublished?: string;
    repository?: string;
    homepage?: string;
    readme?: string;
    dependencies?: Record<string, string>;
    versions?: { version: string; date: string }[];
    abi?: AbiEntry[];
    address?: string;
    /** Per-name proxy (the name's stable address); unset for legacy names. */
    proxyAddress?: string;
    /** Lowest still-supported semver version; unset when no floor is set. */
    minSupportedVersion?: string;
    metadataUri?: string;
    metadataLoaded?: boolean;
}
