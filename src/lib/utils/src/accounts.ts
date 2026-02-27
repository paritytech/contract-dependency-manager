import { homedir } from "os";
import { resolve } from "path";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { sr25519CreateDerive } from "@polkadot-labs/hdkd";
import {
    entropyToMiniSecret,
    mnemonicToEntropy,
    generateMnemonic,
    ss58Address,
} from "@polkadot-labs/hdkd-helpers";

export interface Account {
    mnemonic: string;
    address: string;
}

type AccountsFile = Record<string, Account>;

function getAccountsPath(): string {
    const cdmRoot = process.env.CDM_ROOT ?? resolve(homedir(), ".cdm");
    return resolve(cdmRoot, "accounts.json");
}

export function readAccounts(): AccountsFile {
    const path = getAccountsPath();
    if (!existsSync(path)) return {};
    return JSON.parse(readFileSync(path, "utf-8"));
}

export function getAccount(chainName: string): Account | undefined {
    return readAccounts()[chainName];
}

export function saveAccount(chainName: string, account: Account): void {
    const path = getAccountsPath();
    mkdirSync(resolve(path, ".."), { recursive: true });
    const accounts = readAccounts();
    accounts[chainName] = account;
    writeFileSync(path, JSON.stringify(accounts, null, 2));
}

export function generateAccount(): Account {
    const mnemonic = generateMnemonic(128);
    return accountFromMnemonic(mnemonic);
}

export function accountFromMnemonic(mnemonic: string): Account {
    const entropy = mnemonicToEntropy(mnemonic);
    const miniSecret = entropyToMiniSecret(entropy);
    const derive = sr25519CreateDerive(miniSecret);
    const keyPair = derive("");
    const address = ss58Address(keyPair.publicKey);
    return { mnemonic, address };
}

if (import.meta.vitest) {
    const { describe, test, expect, beforeEach, afterEach } = import.meta.vitest;
    const { mkdtempSync, rmSync, existsSync: fsExists } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");

    describe("accounts", () => {
        let tmpDir: string;
        let origCdmRoot: string | undefined;

        beforeEach(() => {
            tmpDir = mkdtempSync(join(tmpdir(), "cdm-accounts-test-"));
            origCdmRoot = process.env.CDM_ROOT;
            process.env.CDM_ROOT = tmpDir;
        });

        afterEach(() => {
            if (origCdmRoot === undefined) {
                delete process.env.CDM_ROOT;
            } else {
                process.env.CDM_ROOT = origCdmRoot;
            }
            rmSync(tmpDir, { recursive: true, force: true });
        });

        test("readAccounts returns empty object when no file exists", () => {
            expect(readAccounts()).toEqual({});
        });

        test("saveAccount creates accounts.json and getAccount retrieves it", () => {
            const account = { mnemonic: "test mnemonic", address: "5TestAddr" };
            saveAccount("paseo", account);

            expect(fsExists(join(tmpDir, "accounts.json"))).toBe(true);
            expect(getAccount("paseo")).toEqual(account);
        });

        test("saveAccount preserves existing accounts", () => {
            saveAccount("paseo", { mnemonic: "mnemonic1", address: "addr1" });
            saveAccount("polkadot", { mnemonic: "mnemonic2", address: "addr2" });

            const accounts = readAccounts();
            expect(Object.keys(accounts)).toHaveLength(2);
            expect(accounts.paseo.address).toBe("addr1");
            expect(accounts.polkadot.address).toBe("addr2");
        });

        test("getAccount returns undefined for unknown chain", () => {
            expect(getAccount("nonexistent")).toBeUndefined();
        });

        test("generateAccount creates valid 12-word mnemonic and address", () => {
            const account = generateAccount();
            expect(account.mnemonic.split(" ")).toHaveLength(12);
            expect(account.address.length).toBeGreaterThan(10);
        });

        test("generateAccount produces unique accounts", () => {
            const a = generateAccount();
            const b = generateAccount();
            expect(a.mnemonic).not.toBe(b.mnemonic);
            expect(a.address).not.toBe(b.address);
        });

        test("accountFromMnemonic is deterministic", () => {
            const mnemonic =
                "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
            const a = accountFromMnemonic(mnemonic);
            const b = accountFromMnemonic(mnemonic);
            expect(a.address).toBe(b.address);
            expect(a.mnemonic).toBe(mnemonic);
        });

        test("accountFromMnemonic returns an ss58 address", () => {
            const mnemonic =
                "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
            const account = accountFromMnemonic(mnemonic);
            expect(account.address).toMatch(/^[1-9A-HJ-NP-Za-km-z]/);
        });
    });
}
