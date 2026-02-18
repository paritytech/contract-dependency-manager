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
}
