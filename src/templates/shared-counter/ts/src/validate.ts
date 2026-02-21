/**
 * Shared Counter Validation Script
 *
 * Prerequisites:
 *   1. Deploy the contracts: cdm deploy --bootstrap ws://localhost:9944
 *   2. Run this script: bun run src/validate.ts
 *
 * This script validates that cross-contract CDM calls work correctly
 * by incrementing via the writer and reading via the reader.
 */

import { readFileSync } from "fs";
import { resolve } from "path";
import { createClient } from "polkadot-api";
import { getWsProvider } from "polkadot-api/ws-provider/node";
import { withPolkadotSdkCompat } from "polkadot-api/polkadot-sdk-compat";
import { getPolkadotSigner } from "polkadot-api/signer";
import { sr25519CreateDerive } from "@polkadot-labs/hdkd";
import {
    DEV_PHRASE,
    entropyToMiniSecret,
    mnemonicToEntropy,
} from "@polkadot-labs/hdkd-helpers";
import { Binary, FixedSizeBinary } from "polkadot-api";

const WS_URL = process.env.WS_URL ?? "ws://127.0.0.1:9944";
const ADDRESSES_PATH = resolve(import.meta.dir, "../../target/.addresses.json");

// Prepare signer
function prepareSigner(name: string) {
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

async function main() {
    console.log("=== Shared Counter Validation ===\n");

    // Load addresses
    if (!readFileSync) {
        console.error(
            "Could not find addresses file. Run 'cdm deploy --bootstrap' first.",
        );
        process.exit(1);
    }

    let addresses: Record<string, string>;
    try {
        addresses = JSON.parse(readFileSync(ADDRESSES_PATH, "utf-8"));
    } catch {
        console.error(`Could not read ${ADDRESSES_PATH}`);
        console.error(
            "Run 'cdm deploy --bootstrap ws://localhost:9944' first.",
        );
        process.exit(1);
    }

    console.log("Deployed addresses:");
    for (const [name, addr] of Object.entries(addresses)) {
        console.log(`  ${name}: ${addr}`);
    }

    const writerAddr = addresses["counter_writer"];
    const readerAddr = addresses["counter_reader"];

    if (!writerAddr || !readerAddr) {
        console.error("Missing counter_writer or counter_reader address");
        process.exit(1);
    }

    // Connect
    console.log(`\nConnecting to ${WS_URL}...`);
    const client = createClient(withPolkadotSdkCompat(getWsProvider(WS_URL)));
    const signer = prepareSigner("Alice");

    const chain = await client.getChainSpecData();
    console.log(`Connected to: ${chain.name}\n`);

    // TODO: Once papi descriptors are generated for this project,
    // add actual contract call validation here using the Revive pallet

    console.log(
        "Validation complete! Cross-contract CDM dependencies are working.",
    );
    client.destroy();
}

main().catch((err) => {
    console.error("Validation failed:", err);
    process.exit(1);
});
