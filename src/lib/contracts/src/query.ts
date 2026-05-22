/**
 * Helpers for unwrapping responses from `@parity/product-sdk-contracts`'s
 * query wrappers. Browser-safe: depends on nothing Node-only.
 *
 * The SDK exposes two layers around results:
 *   - outer: `{ success: boolean; value: T }` (where success=false signals a
 *     dispatch/decoding failure)
 *   - inner: `{ isSome: boolean; value: T }` for ink `Option<T>` returns
 */

export interface QueryResult {
    success: boolean;
    value?: unknown;
}

/** Flatten an ink `Option<T>` wrapper to `T | undefined`. */
export function unwrapOption<T>(val: unknown): T | undefined {
    if (val && typeof val === "object" && "isSome" in val) {
        const opt = val as { isSome: boolean; value: T };
        return opt.isSome ? opt.value : undefined;
    }
    return val as T | undefined;
}

/**
 * Unwrap a query result returning `Option<T>`. Returns `null` for either
 * dispatch failure (`success=false`) or `Option::None`.
 */
export function unwrapQueryOption<T>(result: QueryResult): T | null {
    if (!result.success) return null;
    return unwrapOption<T>(result.value) ?? null;
}
