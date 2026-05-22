type TxResult = { ok: boolean };

/**
 * Pass if the tx resolves with `ok: true`. Throws otherwise.
 *
 * Vitest-agnostic: assertion failures throw a plain Error which any test
 * runner (vitest, jest, node:test) treats as a failed assertion.
 */
export async function expectOk(promise: Promise<TxResult>, label?: string): Promise<void> {
    const result = await promise;
    if (!result.ok) {
        throw new Error(`${label ? `${label}: ` : ""}tx returned ok=false`);
    }
}

/**
 * Pass if the tx either resolves with `ok: false` OR throws (pre-submit
 * dry-run revert). Both paths count as a revert from the caller's POV.
 */
export async function expectRevert(promise: Promise<TxResult>, label?: string): Promise<void> {
    let result: TxResult | null = null;
    try {
        result = await promise;
    } catch {
        return; // dry-run failure is a revert
    }
    if (result.ok) {
        throw new Error(`${label ? `${label}: ` : ""}expected revert, got ok=true`);
    }
}
