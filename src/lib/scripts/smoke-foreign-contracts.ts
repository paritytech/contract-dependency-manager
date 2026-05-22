#!/usr/bin/env bun
/**
 * Manual smoke test for setupForeignContracts.
 *
 * Run with: bun run src/lib/scripts/smoke-foreign-contracts.ts
 *
 * Requires:
 *   - PPN running (`cdm network start`)
 *   - Network access to paseo Asset Hub
 *   - `@polkadot/contexts` published on the paseo CDM registry
 *
 * Reports what worked at each phase so partial breakage is visible.
 */
import { existsSync, readdirSync, statSync } from "node:fs";
import { dirname } from "node:path";
import { setupForeignContracts, cachePathFor } from "@dotdm/cdm/test";

const PKG = "@polkadot/contexts:latest";

console.log("=== Phase 4 smoke: setupForeignContracts ===\n");

try {
    const result = await setupForeignContracts({
        from: "paseo",
        packages: [PKG],
        // Registry address comes from cdm.local.json's `localRegistry`
        // (written by `cdm deploy --bootstrap -n local`).
    });
    console.log("\n✓ setupForeignContracts completed.");
    console.log("Addresses:", result.addresses);

    const cp = cachePathFor("@polkadot/contexts", 0, "paseo");
    console.log("\nCache path probe (v0):", cp);
    if (existsSync(cp)) {
        const stat = statSync(cp);
        console.log(`  exists, ${stat.size} bytes`);
    } else {
        // Walk up to the package dir to see what versions did land
        try {
            const pkgDir = dirname(cp);
            console.log(`  not at v0; pkg dir contents:`, readdirSync(pkgDir));
        } catch {
            console.log(`  pkg dir missing too`);
        }
    }
} catch (err) {
    console.error("\n✗ setupForeignContracts failed:");
    console.error((err as Error).message);
    if ((err as Error).stack) console.error((err as Error).stack);
    process.exit(1);
}
