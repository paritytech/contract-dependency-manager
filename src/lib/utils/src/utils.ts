export function stringifyBigInt(obj: unknown): string {
    return JSON.stringify(obj, (_, v) => (typeof v === "bigint" ? v.toString() : v), 2);
}

/**
 * Retry an async operation with explicit delays between attempts. Each
 * element of `delaysMs` is awaited BEFORE the attempt at that index; use 0
 * as the first element for an immediate first try. The predicate decides
 * whether a result counts as good; otherwise the next delay is awaited and
 * the operation runs again. Returns the last result + an `ok` flag so
 * callers can construct their own error messages including the failing
 * payload (a typed error is intentionally not thrown — callers have richer
 * context about what "failed" means than this helper can express).
 *
 * Use for race-sensitive chain queries that may return empty/stale data
 * for a few blocks after a state-changing tx, or for plain polling
 * (`delaysMs = [0, 200, 200, ...]` with a boolean predicate).
 */
export async function retryWithBackoff<T>(
    operation: () => Promise<T>,
    isOk: (result: T) => boolean,
    delaysMs: readonly number[],
): Promise<{ result: T; ok: boolean }> {
    let last: T;
    for (const delay of delaysMs) {
        if (delay > 0) await new Promise((r) => setTimeout(r, delay));
        last = await operation();
        if (isOk(last)) return { result: last, ok: true };
    }
    return { result: last!, ok: false };
}
