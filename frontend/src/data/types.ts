export interface Package {
  name: string;
  version: string;
  description: string;
  author: string;
  weeklyDownloads: number;
  license: string;
  keywords: string[];
  publishedDate: string;
  lastPublished: string;
  repository: string;
  homepage: string;
  readme: string;
  dependencies: Record<string, string>;
  versions: { version: string; date: string }[];
}
