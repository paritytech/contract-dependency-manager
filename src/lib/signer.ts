import { getPolkadotSigner } from "polkadot-api/signer";
import { sr25519CreateDerive } from "@polkadot-labs/hdkd";
import {
    DEV_PHRASE,
    entropyToMiniSecret,
    mnemonicToEntropy,
} from "@polkadot-labs/hdkd-helpers";

/**
 * Prepares a signer from a dev account name (e.g., "Alice", "Bob").
 * Uses sr25519 key derivation compatible with Substrate dev accounts.
 */
export function prepareSigner(name: string) {
    const entropy = mnemonicToEntropy(DEV_PHRASE);
    const miniSecret = entropyToMiniSecret(entropy);
    const derive = sr25519CreateDerive(miniSecret);
    const hdkdKeyPair = derive(`//${name}`);

    return getPolkadotSigner(
        hdkdKeyPair.publicKey,
        "Sr25519",
        hdkdKeyPair.sign,
    );
}

/**
 * Prepares a signer from a secret URI (SURI).
 * Format: "//Alice" for dev accounts or a full mnemonic + derivation path.
 */
export function prepareSignerFromSuri(suri: string) {
    // Simple case: dev account shorthand like "//Alice"
    if (suri.startsWith("//")) {
        return prepareSigner(suri.slice(2));
    }

    // For now, just support dev accounts
    // TODO: Support full mnemonics with derivation paths
    throw new Error("Custom SURI not yet supported. Use dev account names like 'Alice' or '//Alice'");
}
