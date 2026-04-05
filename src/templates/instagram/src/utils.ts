import { useRef, useEffect } from "react";
import { getChainAPI } from "@polkadot-apps/chain-client";
import { seedToAccount } from "@polkadot-apps/keys";
import { Binary, type PolkadotSigner } from "polkadot-api";
import { CID } from "multiformats/cid";

// ---------------------------------------------------------------------------
// Wallet
// ---------------------------------------------------------------------------

export type Signer = PolkadotSigner;

export interface Wallet {
  signer: Signer;
  address: string;
}

export function deriveWallet(mnemonic: string): Wallet {
  const { signer, ss58Address } = seedToAccount(mnemonic, "//0");
  return { signer, address: ss58Address };
}

// ---------------------------------------------------------------------------
// Dev accounts (from task-rabbit — already funded on Paseo)
// ---------------------------------------------------------------------------

export const ACCOUNTS = [
  { name: "Alice",   mnemonic: "glimpse final adapt peanut entire ring lift eager mansion orchard silent grunt",   ethAddress: "0xbe1cc67438e4970ee97132721e4cec7738322fef" },
  { name: "Bob",     mnemonic: "match edit thunder foil inner tobacco drift exchange jealous short nuclear mandate",   ethAddress: "0x782f1d6bd00193565dae42a8c4cfcdc21257c564" },
  { name: "Charlie", mnemonic: "what reunion black exit find often month force envelope network connect oppose",      ethAddress: "0xdc9e7641f75f1fb3c4047da5513c33828d00b8b2" },
  { name: "Dave",    mnemonic: "novel soup ginger cereal toilet paper merge upset pottery void impulse visit",        ethAddress: "0x53e4ad30596ae0c00cf17837802fc35112bb3804" },
  { name: "Eve",     mnemonic: "reform lamp logic rare cup hood face caution sun park prison wall",                   ethAddress: "0x63de7f7d9e75a6923c1b470966e049321c2aba86" },
  { name: "Ferdie",  mnemonic: "mountain warm taxi absent note vanish remain slender hammer visa target bench",       ethAddress: "0x2e27e1406d6902e1ca35165fc7488a69f0d9db9a" },
  { name: "Grace",   mnemonic: "region laugh race tenant frozen action dose lazy manage young option van",            ethAddress: "0x4ad2c97b4e36b84f7a4823eea24996323f01f411" },
  { name: "Heidi",   mnemonic: "vacant rain charge start then laptop cotton crouch orbit input distance furnace",     ethAddress: "0xcd07ad1fca01721a870600b41e5ddc94e59fabd7" },
  { name: "Ivan",    mnemonic: "veteran chief suspect draft cause chicken dwarf chat immune proud fee snake",         ethAddress: "0x945bb77dc62eb8ef1ccecbf968ea4d54f63e79a5" },
  { name: "Judy",    mnemonic: "tobacco cycle fancy laptop sport all blood fabric hungry mosquito hold coach",        ethAddress: "0xbbe1297dde6d6612ce8d3719a40dbd3cd1f62868" },
];

// ---------------------------------------------------------------------------
// Infinite scroll sentinel
// ---------------------------------------------------------------------------

export function useIntersectionObserver(
  onIntersect: () => void,
  enabled: boolean,
) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled) return;
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) onIntersect(); },
      { threshold: 0.1 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [onIntersect, enabled]);

  return ref;
}

// ---------------------------------------------------------------------------
// Bulletin (photo upload to Polkadot's decentralised storage)
// ---------------------------------------------------------------------------

export async function publishBlob(bytes: Uint8Array, signer: Signer): Promise<string> {
  const { bulletin } = await getChainAPI("paseo");
  const result = await bulletin.tx.TransactionStorage.store({
    data: Binary.fromBytes(bytes),
  }).signAndSubmit(signer);

  const stored = bulletin.event.TransactionStorage.Stored.filter(result.events);
  if (!stored.length || !stored[0].cid) throw new Error("Upload failed");
  return CID.decode(stored[0].cid.asBytes()).toString();
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export const short = (addr: string) => addr.slice(0, 6) + "..." + addr.slice(-4);

export const ago = (ts: number) => {
  const s = Math.floor(Date.now() / 1000 - ts);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
};
