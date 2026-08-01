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
    version: string;
    description?: string;
    author?: string;
    license?: string;
    keywords?: string[];
    publishedDate?: string;
    lastPublished?: string;
    repository?: string;
    homepage?: string;
    readme?: string;
    dependencies?: Record<string, string>;
    abi?: AbiEntry[];
    address?: string;
    metadataUri?: string;
    metadataLoaded?: boolean;
}
