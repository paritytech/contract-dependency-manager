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
				// Resolve workspace package dists like node: vite would inline and
				// re-transform their code-split tsup chunks, leaving exports undefined.
				external: [/src\/lib\/(contracts|env|utils)\/dist\//],
			},
		},
	},
});
