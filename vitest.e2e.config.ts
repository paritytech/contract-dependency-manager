import { defineConfig } from "vitest/config";

// E2E test suite — opt-in via `pnpm test:e2e`. Tests spawn a real
// `revive-dev-node`, deploy the registry, and exercise it over WS. The unit
// `pnpm test` flow excludes these so it stays fast and binary-independent.
//
// Single-file run, no parallelism: the harness allocates ports from a static
// counter and shares one dev-node per suite.
export default defineConfig({
    test: {
        globals: true,
        include: ["src/**/tests/e2e/**/*.test.ts"],
        reporters: "verbose",
        environment: "node",
        testTimeout: 60_000,
        hookTimeout: 180_000,
        fileParallelism: false,
    },
});
