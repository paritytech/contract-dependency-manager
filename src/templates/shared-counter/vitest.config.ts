import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        include: ["tests/**/*.test.ts"],
        testTimeout: 60_000,
        hookTimeout: 60_000,
        // Drop polkadot-api's "Incompatible runtime entry
        // RuntimeCall(ReviveApi_trace_call)" stderr noise. polkadot-api's
        // descriptors expect ReviveApi_trace_call which not every Asset Hub
        // runtime version exposes; the call throws inside an rxjs stream
        // and the error surfaces on stderr, but query/tx paths still
        // succeed, so it's safe to silence.
        onConsoleLog(log) {
            if (log.includes("Incompatible runtime entry RuntimeCall(ReviveApi_trace_call)")) {
                return false;
            }
        },
    },
});
