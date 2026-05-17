export function withTimeout<T>(
    promise: PromiseLike<T>,
    message: string,
    timeoutMs = 20_000,
    signal?: AbortSignal,
): Promise<T> {
    if (signal?.aborted) return Promise.reject(new Error("aborted"));

    return new Promise((resolve, reject) => {
        let settled = false;
        const timer = setTimeout(() => {
            settle(() => reject(new Error(message)));
        }, timeoutMs);

        const onAbort = () => settle(() => reject(new Error("aborted")));
        signal?.addEventListener("abort", onAbort, { once: true });

        Promise.resolve(promise).then(
            (value) => settle(() => resolve(value)),
            (err) => settle(() => reject(err)),
        );

        function settle(done: () => void) {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            signal?.removeEventListener("abort", onAbort);
            done();
        }
    });
}
