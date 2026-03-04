import { Command } from "commander";
import { Enum } from "polkadot-api";
import {
    KNOWN_CHAINS,
    connectAssetHubWebSocket,
    connectBulletinWebSocket,
    prepareSigner,
    prepareSignerFromMnemonic,
    getChainPreset,
} from "@dotdm/env";
import {
    getAccount,
    saveAccount,
    generateAccount,
    accountFromMnemonic,
} from "@dotdm/utils/accounts";
import { printBalances } from "./account";
import { spinner } from "../lib/ui";

const PREVIEW_NET_FUND_AMOUNT = 100_000_000_000_000n; // 100 units
const PREVIEW_NET_AUTH_TRANSACTIONS = 1000;
const PREVIEW_NET_AUTH_BYTES = 100_000_000n; // 100 MB

/**
 * Auto-setup an account on preview-net: fund from Alice, authorize on Bulletin, map on Asset Hub.
 * Alice is sudo on preview-net so we can do all of this directly.
 */
async function setupPreviewNet(mnemonic: string): Promise<void> {
    const previewPreset = getChainPreset("preview-net");

    const previewAccount = accountFromMnemonic(mnemonic);
    saveAccount("preview-net", previewAccount);

    const aliceSigner = prepareSigner("Alice");
    const accountSigner = prepareSignerFromMnemonic(mnemonic);

    // Connect to both chains
    const { client: ahClient, api: ahApi } = connectAssetHubWebSocket(previewPreset.assethubUrl);
    const { client: blClient, api: blApi } = connectBulletinWebSocket(previewPreset.bulletinUrl);
    await Promise.all([ahClient.getChainSpecData(), blClient.getChainSpecData()]);

    // Fund (Asset Hub) and authorize (Bulletin) in parallel
    const fundPromise = ahApi.tx.Balances.transfer_keep_alive({
        dest: Enum("Id", previewAccount.address),
        value: PREVIEW_NET_FUND_AMOUNT,
    }).signAndSubmit(aliceSigner);

    const authorizePromise = (async () => {
        const authorizeCall = await blApi.tx.TransactionStorage.authorize_account({
            who: previewAccount.address,
            transactions: PREVIEW_NET_AUTH_TRANSACTIONS,
            bytes: PREVIEW_NET_AUTH_BYTES,
        }).decodedCall;
        await blApi.tx.Sudo.sudo({ call: authorizeCall }).signAndSubmit(aliceSigner);
    })();

    await Promise.all([fundPromise, authorizePromise]);

    // Map account after funding completes (needs balance for tx fees)
    try {
        await ahApi.tx.Revive.map_account().signAndSubmit(accountSigner);
    } catch {
        // already mapped
    }

    ahClient.destroy();
    blClient.destroy();
}

const init = new Command("init")
    .description("Initialize CDM for a chain (generates keypair for testnets)")
    .option("-n, --name <name>", "Chain preset name", "paseo");

init.action(async (opts: { name: string }) => {
    const chainName = opts.name;

    if (chainName === "local") {
        console.log("Local chain uses dev accounts (Alice, Bob, etc.) — no init needed.");
        return;
    }

    if (!(chainName in KNOWN_CHAINS) || chainName === "polkadot") {
        console.error(`Init is not available for "${chainName}".`);
        console.error("Currently only testnet chains (e.g. paseo) support auto-initialization.");
        process.exit(1);
    }

    let existing = getAccount(chainName);

    if (!existing) {
        const account = generateAccount();
        saveAccount(chainName, account);
        existing = account;
        console.log(`  Mnemonic:  ${account.mnemonic}\n`);
    }

    await printBalances(chainName, existing);

    // Auto-setup preview-net in the background after paseo init
    if (chainName === "paseo") {
        console.log();
        const sp = spinner("Preview Net", "setting up account");
        try {
            await setupPreviewNet(existing.mnemonic);
            sp.succeed();
        } catch (err) {
            sp.fail();
            console.error(
                `  Preview Net setup failed: ${err instanceof Error ? err.message : err}`,
            );
        }
    }
});

export const initCommand = init;
