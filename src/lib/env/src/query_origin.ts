import { ALICE_SS58 } from "@dotdm/utils";
import { getAccount } from "@dotdm/utils/accounts";
import {
    findKnownChainByAssetHubUrl,
    normalizeChainName,
    type KnownChainName,
} from "./known_chains";

export interface QueryOriginTarget {
    chainName?: string;
    assethubUrl?: string;
}

function resolveQueryAccountName(
    target: string | QueryOriginTarget | undefined,
): KnownChainName | undefined {
    const chainName = typeof target === "string" ? target : target?.chainName;
    const normalized = chainName ? normalizeChainName(chainName) : undefined;
    if (normalized && normalized !== "custom") return normalized;

    const assethubUrl = typeof target === "string" ? undefined : target?.assethubUrl;
    return assethubUrl ? findKnownChainByAssetHubUrl(assethubUrl) : undefined;
}

export function resolveQueryOrigin(target?: string | QueryOriginTarget): string {
    const accountName = resolveQueryAccountName(target);
    if (accountName) {
        const account = getAccount(accountName);
        if (account) return account.address;
    }
    return ALICE_SS58;
}

if (import.meta.vitest) {
    const { afterEach, describe, expect, test } = import.meta.vitest;
    const { mkdtempSync, rmSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const { saveAccount } = await import("@dotdm/utils/accounts");

    describe("resolveQueryOrigin", () => {
        const originalCdmRoot = process.env.CDM_ROOT;

        afterEach(() => {
            if (originalCdmRoot === undefined) {
                delete process.env.CDM_ROOT;
            } else {
                process.env.CDM_ROOT = originalCdmRoot;
            }
        });

        test("uses the normalized chain account when present", () => {
            const root = mkdtempSync(join(tmpdir(), "cdm-query-origin-"));
            process.env.CDM_ROOT = root;
            try {
                saveAccount("paseo", { mnemonic: "test", address: "paseo-address" });

                expect(resolveQueryOrigin("paseo-v2")).toBe("paseo-address");
            } finally {
                rmSync(root, { recursive: true, force: true });
            }
        });

        test("infers a known chain account from the Asset Hub URL", () => {
            const root = mkdtempSync(join(tmpdir(), "cdm-query-origin-"));
            process.env.CDM_ROOT = root;
            try {
                saveAccount("paseo", { mnemonic: "test", address: "paseo-address" });

                expect(
                    resolveQueryOrigin({
                        assethubUrl: "wss://paseo-asset-hub-next-rpc.polkadot.io",
                    }),
                ).toBe("paseo-address");
            } finally {
                rmSync(root, { recursive: true, force: true });
            }
        });

        test("falls back to Alice when no chain account is available", () => {
            const root = mkdtempSync(join(tmpdir(), "cdm-query-origin-"));
            process.env.CDM_ROOT = root;
            try {
                expect(resolveQueryOrigin("paseo")).toBe(ALICE_SS58);
            } finally {
                rmSync(root, { recursive: true, force: true });
            }
        });
    });
}
