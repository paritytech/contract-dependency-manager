/** Split a CDM package name into its scope prefix ("@org/") and leaf part. */
export function splitPackageName(name: string): { prefix: string; leaf: string } {
    const idx = name.lastIndexOf("/");
    if (idx < 0) return { prefix: "", leaf: name };
    return {
        prefix: name.slice(0, idx + 1),
        leaf: name.slice(idx + 1),
    };
}
