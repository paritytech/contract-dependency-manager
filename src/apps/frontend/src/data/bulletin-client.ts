import { queryJson } from "@parity/product-sdk-cloud-storage";
import type { ProductSdkEnvironment } from "@dotdm/env/registry";
import { withTimeout } from "./timeout";

// CIDs are content-addressed and immutable, so a successful resolution can
// be reused across the renderer lifetime. The in-flight map collapses
// concurrent callers (hooks remounting, multiple cards referencing the same
// metadata) so route navigation does not repeat the same host preimage
// lookup while the first request is still resolving.
const _jsonCache = new Map<string, unknown>();
const _jsonInFlight = new Map<string, Promise<unknown>>();

function cacheKey(environment: ProductSdkEnvironment, cid: string): string {
    return `${environment}:${cid}`;
}

export function queryBulletinJson<T>(environment: ProductSdkEnvironment, cid: string): Promise<T> {
    const key = cacheKey(environment, cid);
    const cached = _jsonCache.get(key);
    if (cached !== undefined) return Promise.resolve(cached as T);

    const inFlight = _jsonInFlight.get(key);
    if (inFlight) return inFlight as Promise<T>;

    const p = (async () => {
        const value = await withTimeout(
            queryJson<T>(cid),
            `Bulletin metadata lookup timed out for CID ${cid}.`,
            30_000,
        );
        _jsonCache.set(key, value);
        return value;
    })().finally(() => {
        _jsonInFlight.delete(key);
    });

    _jsonInFlight.set(key, p);
    return p;
}
