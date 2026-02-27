import { Command } from "commander";
import {
    connectAssetHubWebSocket,
    connectBulletinWebSocket,
    getChainPreset,
    prepareSignerFromMnemonic,
} from "@dotdm/env";
import type { Account } from "@dotdm/utils/accounts";
import { getAccount, saveAccount, accountFromMnemonic } from "@dotdm/utils/accounts";

const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const link = (label: string, url: string) => `\x1b[4m\x1b]8;;${url}\x07${label}\x1b]8;;\x07\x1b[0m`;

function requireAccount(chainName: string): Account {
    const acc = getAccount(chainName);
    if (!acc) {
        console.error(`No account found for "${chainName}". Run "cdm init -n ${chainName}" first.`);
        process.exit(1);
    }
    return acc;
}

export async function printBalances(chainName: string, acc: Account) {
    const preset = getChainPreset(chainName);

    console.log(`  Address     ${bold(acc.address)}`);

    // Asset Hub balance
    const { client: ahClient, api: ahApi } = connectAssetHubWebSocket(preset.assethubUrl);
    const chainSpec = await ahClient.getChainSpecData();
    const rawSymbol = chainSpec.properties?.tokenSymbol;
    const rawDecimals = chainSpec.properties?.tokenDecimals;
    const symbol = Array.isArray(rawSymbol) ? rawSymbol[0] : (rawSymbol ?? "units");
    const decimals = Array.isArray(rawDecimals) ? rawDecimals[0] : (rawDecimals ?? 0);
    const { data } = await ahApi.query.System.Account.getValue(acc.address);
    console.log(
        `  Asset Hub   ${green(`${(Number(data.free) / 10 ** decimals).toFixed(4)} ${symbol}`)}`,
    );

    // Bulletin allowances
    const { client: blClient, api: blApi } = connectBulletinWebSocket(preset.bulletinUrl);
    await blClient.getChainSpecData();
    const auth = await blApi.query.TransactionStorage.Authorizations.getValue({
        type: "Account",
        value: acc.address,
    });
    if (auth) {
        const mb = (Number(auth.extent.bytes) / 1_000_000).toFixed(1);
        console.log(
            `  Bulletin    ${green(`${auth.extent.transactions} txns`)}  ${green(`${mb} MB`)}  ${dim(`expires block #${auth.expiration}`)}`,
        );
    } else {
        console.log(`  Bulletin    ${dim("no allowance")}`);
    }

    // Faucet links
    if (preset.faucets?.length) {
        const links = preset.faucets.map((f) => link(f.label + " Faucet", f.url)).join("    ");
        console.log(`\n  Top up your allowance:\n  ${links}`);
    }

    ahClient.destroy();
    blClient.destroy();
}

const account = new Command("account").description("Manage CDM accounts");

account
    .command("set")
    .description("Import an account from a mnemonic")
    .requiredOption("-n, --name <name>", "Chain preset name")
    .requiredOption("--mnemonic <phrase>", "BIP39 mnemonic phrase")
    .action(async (opts: { name: string; mnemonic: string }) => {
        const acc = accountFromMnemonic(opts.mnemonic);
        saveAccount(opts.name, acc);
        console.log(`  Address: ${bold(acc.address)}`);
    });

account
    .command("bal")
    .description("Check balance and bulletin allowances")
    .requiredOption("-n, --name <name>", "Chain preset name")
    .action(async (opts: { name: string }) => {
        await printBalances(opts.name, requireAccount(opts.name));
    });

account
    .command("map")
    .description("Map account for the Revive pallet (required before first deploy)")
    .requiredOption("-n, --name <name>", "Chain preset name")
    .action(async (opts: { name: string }) => {
        const acc = requireAccount(opts.name);
        const preset = getChainPreset(opts.name);
        const { client, api } = connectAssetHubWebSocket(preset.assethubUrl);
        await client.getChainSpecData();
        try {
            await api.tx.Revive.map_account().signAndSubmit(
                prepareSignerFromMnemonic(acc.mnemonic),
            );
            console.log("Account mapped.");
        } catch {
            console.log("Account already mapped.");
        }
        client.destroy();
    });

export const accountCommand = account;
