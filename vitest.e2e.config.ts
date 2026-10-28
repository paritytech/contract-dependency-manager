import { defineConfig } from "vitest/config";

// E2E test suite — opt-in via `pnpm test:e2e`. Tests connect to an
// already-running local PPN (see src/lib/contracts/tests/e2e/harness.ts),
// deploy the registry, and exercise it over WS. The unit `pnpm test` flow
// excludes these so it stays fast and network-independent.
//
// Single-file run, no parallelism: every suite shares the one network and
// the one registry deployed into it.
export default defineConfig({
    test: {
        globals: true,
        include: ["src/**/tests/e2e/**/*.test.ts"],
        reporters: "verbose",
        environment: "node",
        testTimeout: 60_000,
        hookTimeout: 300_000,
        fileParallelism: false,
    },
});
