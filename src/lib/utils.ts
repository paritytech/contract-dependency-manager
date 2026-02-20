export function stringifyBigInt(obj: unknown): string {
    return JSON.stringify(obj, (_, v) => (typeof v === "bigint" ? v.toString() : v), 2);
}
