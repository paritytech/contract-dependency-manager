import { Command } from "commander";
import { Enum } from "polkadot-api";
import { submitAndWatch, type SubmittableTransaction } from "@parity/product-sdk-tx";
import {
    createCdmChainClient,
    prepareSigner,
    prepareSignerFromMnemonic,
    getChainPreset,
    isKnownChainPreset,
    type CdmBulletinApi,
    type CdmChainClient,
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
const PREVIEW_NET_BULLETIN_TRANSACTIONS = 100;
const PREVIEW_NET_BULLETIN_BYTES = 100n * 1024n * 1024n;

type BulletinAuthorization = {
    remainingTransactions: number;
    remainingBytes: bigint;
    expiration: number;
};

async function submitBestBlock(
    tx: SubmittableTransaction,
    signer: ReturnType<typeof prepareSigner>,
): Promise<void> {
    await submitAndWatch(tx, signer, { waitFor: "best-block" });
}

async function getBulletinAuthorization(
    api: CdmBulletinApi,
    address: string,
): Promise<BulletinAuthorization | null> {
    const auth = await api.query.TransactionStorage.Authorizations.getValue(
        Enum("Account", address),
    );
    if (!auth) return null;

    const extent = auth.extent;
    const remainingTransactions =
        extent.transactions_allowance === undefined
            ? Number(extent.transactions)
            : Number(extent.transactions_allowance) - Number(extent.transactions);
    const remainingBytes =
        extent.bytes_allowance === undefined
            ? BigInt(extent.bytes)
            : BigInt(extent.bytes_allowance) - BigInt(extent.bytes);

    return {
        remainingTransactions,
        remainingBytes,
        expiration: Number(auth.expiration),
    };
}

async function ensurePreviewNetBulletinAuthorization(
    chainClient: CdmChainClient,
    address: string,
): Promise<void> {
    const finalizedBlock = await chainClient.raw.bulletin.getFinalizedBlock();
    const auth = await getBulletinAuthorization(chainClient.bulletin, address);
    const hasEnough =
        auth &&
        finalizedBlock.number < auth.expiration &&
        auth.remainingTransactions >= PREVIEW_NET_BULLETIN_TRANSACTIONS &&
        auth.remainingBytes >= PREVIEW_NET_BULLETIN_BYTES;

    if (hasEnough) return;

    const authorizeTx = chainClient.bulletin.tx.TransactionStorage.authorize_account({
        who: address,
        transactions: PREVIEW_NET_BULLETIN_TRANSACTIONS,
        bytes: PREVIEW_NET_BULLETIN_BYTES,
    });
    const sudo = chainClient.bulletin.tx.Sudo?.sudo;
    const tx = sudo ? sudo({ call: authorizeTx.decodedCall }) : authorizeTx;
    await submitBestBlock(tx as SubmittableTransaction, prepareSigner("Alice"));
}

/**
 * Auto-setup an account on preview-net: fund Asset Hub from Alice, grant
 * Bulletin storage from Alice/sudo, and map the account on Asset Hub.
 */
async function setupPreviewNet(mnemonic: string): Promise<void> {
    const previewPreset = getChainPreset("preview-net");

    const previewAccount = accountFromMnemonic(mnemonic);
    saveAccount("preview-net", previewAccount);

    const aliceSigner = prepareSigner("Alice");
    const accountSigner = prepareSignerFromMnemonic(mnemonic);

    const chainClient = await createCdmChainClient({
        assethubUrl: previewPreset.assethubUrl,
        bulletinUrl: previewPreset.bulletinUrl,
        chainName: "preview-net",
    });
    try {
        await Promise.all([
            chainClient.raw.assetHub.getChainSpecData(),
            chainClient.raw.bulletin.getChainSpecData(),
        ]);

        await submitBestBlock(
            chainClient.assetHub.tx.Balances.transfer_keep_alive({
                dest: Enum("Id", previewAccount.address),
                value: PREVIEW_NET_FUND_AMOUNT,
            }) as SubmittableTransaction,
            aliceSigner,
        );

        await ensurePreviewNetBulletinAuthorization(chainClient, previewAccount.address);

        // Map account after funding completes (needs balance for tx fees)
        try {
            await submitBestBlock(
                chainClient.assetHub.tx.Revive.map_account() as SubmittableTransaction,
                accountSigner,
            );
        } catch {
            // already mapped
        }
    } finally {
        chainClient.destroy();
    }
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

    if (chainName === "preview-net") {
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
