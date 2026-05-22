import { describe, expect, test } from "vitest";
import { Alice, Bob, Charlie, Dave, dev } from "../src/test/accounts";

describe("dev accounts", () => {
    test("Alice has the canonical sr25519 SS58 address", () => {
        expect(Alice.ss58).toBe("5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY");
    });

    test("Alice's H160 is keccak256(publicKey)[12:32]", () => {
        // Empirically verified against polkadot.js apps. Pinning the value
        // catches accidental key-derivation regressions in product-sdk-keys.
        expect(Alice.h160).toBe("0x9621dde636de098b43efb0fa9b61facfe328f99d");
    });

    test("each pre-instantiated account has a 32-byte public key", () => {
        for (const a of [Alice, Bob, Charlie, Dave]) {
            expect(a.publicKey).toBeInstanceOf(Uint8Array);
            expect(a.publicKey.length).toBe(32);
        }
    });

    test("dev() is deterministic — same derivation path → same address", () => {
        const a = dev("X", "//Alice");
        expect(a.h160).toBe(Alice.h160);
        expect(a.ss58).toBe(Alice.ss58);
    });

    test("different paths produce different accounts", () => {
        expect(Alice.h160).not.toBe(Bob.h160);
        expect(Alice.ss58).not.toBe(Bob.ss58);
    });

    test("name is preserved verbatim", () => {
        expect(dev("Custom", "//Custom").name).toBe("Custom");
    });

    test("signer can produce a signature (sanity)", async () => {
        // Don't validate the signature, just confirm the signer machinery is wired.
        const sig = await Alice.signer.signBytes(new Uint8Array([1, 2, 3]));
        expect(sig).toBeInstanceOf(Uint8Array);
        expect(sig.length).toBeGreaterThan(0);
    });
});
