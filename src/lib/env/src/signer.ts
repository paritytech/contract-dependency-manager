import { getTxCreator } from "polkadot-api/tx-creator";
import { sr25519CreateDerive } from "@polkadot-labs/hdkd";
import {
    DEV_PHRASE,
    entropyToMiniSecret,
    mnemonicToEntropy,
    ss58Address,
} from "@polkadot-labs/hdkd-helpers";

export { ss58Address };

/** A papi-3 transaction creator, as accepted by product-sdk signer parameters. */
export type CdmSigner = ReturnType<typeof getTxCreator>;

/**
 * Prepares a signer from a dev account name (e.g., "Alice", "Bob").
 * Uses sr25519 key derivation compatible with Substrate dev accounts.
 */
export function prepareSigner(name: string): CdmSigner {
    const entropy = mnemonicToEntropy(DEV_PHRASE);
    const miniSecret = entropyToMiniSecret(entropy);
    const derive = sr25519CreateDerive(miniSecret);
    const hdkdKeyPair = derive(`//${name}`);

    return getTxCreator(hdkdKeyPair.publicKey, "Sr25519", hdkdKeyPair.sign);
}

/**
 * Prepares a signer from a mnemonic phrase.
 * Derives sr25519 keypair from the mnemonic with no derivation path.
 */
export function prepareSignerFromMnemonic(mnemonic: string): CdmSigner {
    const entropy = mnemonicToEntropy(mnemonic);
    const miniSecret = entropyToMiniSecret(entropy);
    const derive = sr25519CreateDerive(miniSecret);
    const hdkdKeyPair = derive("");

    return getTxCreator(hdkdKeyPair.publicKey, "Sr25519", hdkdKeyPair.sign);
}

/**
 * Prepares a signer from a secret URI (SURI).
 * Format: "//Alice" for dev accounts or a full mnemonic.
 */
export function prepareSignerFromSuri(suri: string): CdmSigner {
    // Simple case: dev account shorthand like "//Alice"
    if (suri.startsWith("//")) {
        return prepareSigner(suri.slice(2));
    }

    // Full mnemonic
    return prepareSignerFromMnemonic(suri);
}
