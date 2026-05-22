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
	},
});
