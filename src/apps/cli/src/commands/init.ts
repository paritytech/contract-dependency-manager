import { Command } from "commander";
import { isKnownChainPreset } from "@parity/cdm-env";
import { getAccount, saveAccount, generateAccount } from "@parity/cdm-utils/accounts";
import { printBalances } from "./account";

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
        console.error(
            "Currently only testnet chains (e.g. paseo, devnet) support auto-initialization.",
        );
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
});

export const initCommand = init;
