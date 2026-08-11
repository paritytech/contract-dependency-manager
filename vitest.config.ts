import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		globals: true,
		includeSource: ["src/lib/*/src/**/*.ts", "src/apps/cli/src/**/*.ts"],
		include: ["src/**/tests/**/*.test.ts"],
		exclude: [
			"**/node_modules/**",
			"**/dist/**",
			"src/apps/frontend/**",
			"src/templates/**",
			"src/**/tests/e2e/**",
		],
		reporters: "verbose",
		environment: "node",
		server: {
			deps: {
				// Workspace packages are symlinked, so vite would inline and
				// re-transform their built tsup chunks, leaving code-split
				// export bindings undefined. Resolve them like node instead
				// (tests that import a workspace PACKAGE run against its
				// dist — build it first, e.g. `turbo build --filter=...`).
				external: [/src\/lib\/(contracts|env|utils)\/dist\//],
			},
		},
	},
});
