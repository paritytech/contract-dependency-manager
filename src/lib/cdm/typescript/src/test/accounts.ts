import { seedToAccount } from "@parity/product-sdk-keys";
import { DEV_PHRASE } from "@polkadot-labs/hdkd-helpers";
import type { PolkadotSigner, SS58String } from "polkadot-api";

export interface DevAccount {
    name: string;
    h160: `0x${string}`;
    ss58: SS58String;
    publicKey: Uint8Array;
    signer: PolkadotSigner;
}

/**
 * Build a dev account from a derivation path against the well-known dev
 * mnemonic. `dev("Alice", "//Alice")` matches the polkadot.js dev pair.
 */
export function dev(name: string, path: string): DevAccount {
    const acct = seedToAccount(DEV_PHRASE, path);
    return {
        name,
        h160: acct.h160Address,
        ss58: acct.ss58Address,
        publicKey: acct.publicKey,
        signer: acct.signer,
    };
}

export const Alice = dev("Alice", "//Alice");
export const Bob = dev("Bob", "//Bob");
export const Charlie = dev("Charlie", "//Charlie");
export const Dave = dev("Dave", "//Dave");
export const Eve = dev("Eve", "//Eve");
export const Ferdie = dev("Ferdie", "//Ferdie");
