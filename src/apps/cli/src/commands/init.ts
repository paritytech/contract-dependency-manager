import { Command } from "commander";
import { Enum } from "polkadot-api";
import {
    createCdmAssetHubClient,
    prepareSigner,
    prepareSignerFromMnemonic,
    getChainPreset,
    isKnownChainPreset,
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

/**
 * Auto-setup an account on preview-net Asset Hub: fund from Alice and map on Asset Hub.
 * TEMPORARY_PATCH! CDM preview-net metadata is currently stored on Paseo
 * Bulletin, so authorization is handled by the normal Paseo account/faucet flow.
 */
async function setupPreviewNet(mnemonic: string): Promise<void> {
    const previewPreset = getChainPreset("preview-net");

    const previewAccount = accountFromMnemonic(mnemonic);
    saveAccount("preview-net", previewAccount);

    const aliceSigner = prepareSigner("Alice");
    const accountSigner = prepareSignerFromMnemonic(mnemonic);

    const chainClient = await createCdmAssetHubClient(previewPreset.assethubUrl, "preview-net");
    const ahApi = chainClient.assetHub;
    await chainClient.raw.assetHub.getChainSpecData();

    await ahApi.tx.Balances.transfer_keep_alive({
        dest: Enum("Id", previewAccount.address),
        value: PREVIEW_NET_FUND_AMOUNT,
    }).signAndSubmit(aliceSigner);

    // Map account after funding completes (needs balance for tx fees)
    try {
        await ahApi.tx.Revive.map_account().signAndSubmit(accountSigner);
    } catch {
        // already mapped
    }

    chainClient.destroy();
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

    if (!isKnownChainPreset(chainName) || chainName === "polkadot") {
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
