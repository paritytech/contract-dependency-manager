import {
  useState, useEffect, useCallback, useRef, type ReactNode,
} from "react";
import { getChainAPI } from "@parity/product-sdk-chain-client";
import {
  ContractManager,
  ensureContractAccountMapped,
  type CdmJson,
} from "@parity/product-sdk-contracts";
import { paseo_asset_hub } from "@parity/product-sdk-descriptors/paseo-asset-hub";
import { SignerManager, type SignerAccount, type SignerState } from "@parity/product-sdk-signer";
import { CloudStorageClient, createLazySigner } from "@parity/product-sdk-cloud-storage";
import type { SizedHex } from "polkadot-api";
import {
  useIntersectionObserver, short, ago,
} from "./utils.ts";
import cdmJson from "../cdm.json";

// ---------------------------------------------------------------------------
// CDM — one connection for the lifetime of the page
// ---------------------------------------------------------------------------

const DOT_NS_IDENTIFIER = "instagram.dot";
const signerManager = new SignerManager({ ss58Prefix: 42, dappName: "instagram" });
let activeProductAccount: SignerAccount | null = null;

const chain = await getChainAPI("paseo");
const contracts = ContractManager.fromClient(
  cdmJson as CdmJson,
  chain.raw.assetHub,
  paseo_asset_hub,
);
const bulletin = await CloudStorageClient.create({
  environment: "paseo",
  signer: createLazySigner(() => activeProductAccount?.getSigner() ?? null),
});
const ig = contracts.getContract("@example/instagram");
const toBytes20 = (hex: string): SizedHex<20> => {
  if (!/^0x[0-9a-fA-F]{40}$/.test(hex)) throw new Error(`Expected bytes20, got ${hex}`);
  return hex as SizedHex<20>;
};

async function publishBlob(bytes: Uint8Array): Promise<string> {
  const result = await bulletin.store(bytes).withManifest(true).send();
  if (!result.cid) throw new Error("Bulletin upload returned no CID");
  return result.cid.toString();
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Post {
  user: string;          // ethAddress
  userName: string;
  index: number;
  description: string;
  photoCid: string;
  timestamp: number;
}

interface UserInfo {
  ethAddress: string;
  postCount: number;
}

const IPFS_GATEWAY = "https://paseo-bulletin-next-ipfs.polkadot.io/ipfs/";
const PAGE = 8;

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

export default function App() {
  const [signerState, setSignerState] = useState<SignerState>(() => signerManager.getState());
  const [productAccount, setProductAccount] = useState<SignerAccount | null>(null);
  const [connectError, setConnectError] = useState("");
  const [connectStatus, setConnectStatus] = useState("Connecting...");
  const [tab, setTab] = useState<"posts" | "people">("posts");
  const me = productAccount?.h160Address ?? "";

  const activateProductAccount = useCallback(async () => {
    const product = await signerManager.getProductAccount(DOT_NS_IDENTIFIER);
    if (!product.ok) {
      setConnectError(product.error.message);
      return;
    }
    setConnectStatus("Preparing account...");
    const mapped = await ensureContractAccountMapped(
      contracts.getRuntime(),
      product.value.address,
      product.value.getSigner(),
      {
        onStatus: status => setConnectStatus(
          status === "mapping" ? "Mapping account..." : "Preparing account..."
        ),
      },
    );
    if (!mapped.ok) {
      setConnectError(mapped.error.message);
      return;
    }
    activeProductAccount = product.value;
    contracts.setDefaults({
      origin: product.value.address,
      signer: product.value.getSigner(),
    });
    setProductAccount(product.value);
    setConnectError("");
  }, []);

  useEffect(() => signerManager.subscribe(setSignerState), []);

  useEffect(() => {
    let cancelled = false;

    async function connect() {
      const result = await signerManager.connect();
      if (cancelled) return;
      if (!result.ok) {
        setConnectError(result.error.message);
        return;
      }
      await activateProductAccount();
    }

    connect().catch(err => setConnectError((err as Error).message));
    return () => { cancelled = true; };
  }, [activateProductAccount]);

  const selectHostAccount = useCallback(async (address: string) => {
    const selected = signerManager.selectAccount(address);
    if (!selected.ok) {
      setConnectError(selected.error.message);
      return;
    }
    await activateProductAccount();
  }, [activateProductAccount]);

  // --- Following (persisted per-account in localStorage) ---
  const followKey = `ig-following-${me}`;
  const [following, setFollowing] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem(followKey) || "[]"); }
    catch { return []; }
  });
  useEffect(() => { localStorage.setItem(followKey, JSON.stringify(following)); }, [followKey, following]);

  const toggleFollow = useCallback((addr: string) => {
    setFollowing(f => f.includes(addr) ? f.filter(a => a !== addr) : [...f, addr]);
  }, []);

  const nameOf = (addr: string) =>
    addr.toLowerCase() === me.toLowerCase()
      ? productAccount?.name ?? "You"
      : short(addr);

  if (!productAccount) {
    return (
      <>
        <header>
          <h1>instagram</h1>
        </header>
        <div className="empty">{connectError || connectStatus}</div>
      </>
    );
  }

  return (
    <>
      <header>
        <h1>instagram</h1>
        <select
          className="account-select"
          value={signerState.selectedAccount?.address ?? ""}
          onChange={e => { void selectHostAccount(e.target.value); }}
        >
          {signerState.accounts.map(a => (
            <option key={a.address} value={a.address}>{a.name ?? short(a.address)}</option>
          ))}
        </select>
      </header>

      <div className="tabs">
        <button className={tab === "posts" ? "active" : ""} onClick={() => setTab("posts")}>
          Posts
        </button>
        <button className={tab === "people" ? "active" : ""} onClick={() => setTab("people")}>
          People
        </button>
      </div>

      {tab === "posts"
        ? <Feed following={following} nameOf={nameOf} />
        : <People me={me} following={following} toggleFollow={toggleFollow} nameOf={nameOf} />
      }

      <CreatePost onCreated={() => setTab("posts")} />
    </>
  );
}

// ---------------------------------------------------------------------------
// Feed — breadth-first across followed users
// ---------------------------------------------------------------------------

function Feed({ following, nameOf }: {
  following: string[]; nameOf: (a: string) => string;
}) {
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const cursorRef = useRef({ depth: 0, userIdx: 0 });
  const countsRef = useRef<Map<string, number> | null>(null);
  const genRef = useRef(0);

  // Reset when following list changes
  useEffect(() => {
    genRef.current++;
    setPosts([]);
    setHasMore(true);
    cursorRef.current = { depth: 0, userIdx: 0 };
    countsRef.current = null;
  }, [following.join(",")]);

  const loadMore = useCallback(async () => {
    if (loading || !hasMore || following.length === 0) return;
    const gen = ++genRef.current;
    setLoading(true);

    try {
      // Fetch post counts once
      if (!countsRef.current) {
        const counts = new Map<string, number>();
        await Promise.all(following.map(async addr => {
          const r = await ig.getPostCount.query(toBytes20(addr));
          if (r.success) counts.set(addr, Number(r.value));
        }));
        if (gen !== genRef.current) return;
        countsRef.current = counts;
      }

      const counts = countsRef.current;
      const batch: Post[] = [];
      let { depth, userIdx } = cursorRef.current;

      while (batch.length < PAGE) {
        if (userIdx >= following.length) { depth++; userIdx = 0; }
        // Check if any user has posts at this depth
        if (!following.some(u => (counts.get(u) ?? 0) > depth)) break;
        const addr = following[userIdx];
        const count = counts.get(addr) ?? 0;
        userIdx++;
        if (count <= depth) continue;

        const postIdx = count - 1 - depth;
        const r = await ig.getPost.query(toBytes20(addr), BigInt(postIdx));
        if (gen !== genRef.current) return;
        if (r.success) {
          batch.push({
            user: addr, userName: nameOf(addr), index: postIdx,
            description: r.value.description,
            photoCid: r.value.photo_cid,
            timestamp: Number(r.value.timestamp),
          });
        }
      }

      cursorRef.current = { depth, userIdx };
      setPosts(prev => [...prev, ...batch]);

      const anyMore = following.some(u => (counts.get(u) ?? 0) > depth + (userIdx >= following.length ? 1 : 0));
      setHasMore(anyMore && batch.length > 0);
    } catch (err) {
      console.error("Feed load error:", err);
      setHasMore(false);
    } finally {
      if (gen === genRef.current) setLoading(false);
    }
  }, [loading, hasMore, following, nameOf]);

  useEffect(() => { if (posts.length === 0 && hasMore && following.length > 0) loadMore(); }, [following.length]);

  const sentinelRef = useIntersectionObserver(loadMore, hasMore && !loading);

  if (following.length === 0) {
    return <div className="empty">Not following anyone yet.<br />Head to People and follow some accounts.</div>;
  }

  return (
    <div>
      {posts.map(p => <PostCard key={`${p.user}-${p.index}`} post={p} />)}
      {loading && <div className="spinner">Loading...</div>}
      {!hasMore && posts.length > 0 && <div className="empty">You're all caught up.</div>}
      {hasMore && <div ref={sentinelRef} className="sentinel" />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Post card
// ---------------------------------------------------------------------------

function PostCard({ post }: { post: Post }) {
  return (
    <div className="post">
      <div className="post-header">
        <div className="avatar">{post.userName[0]}</div>
        <span className="post-user">{post.userName}</span>
        <span className="post-time">{ago(post.timestamp)}</span>
      </div>
      {post.photoCid && (
        <img className="post-img" src={IPFS_GATEWAY + post.photoCid} alt="" loading="lazy" />
      )}
      {post.description && <p className="post-desc">{post.description}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// People — discover & follow users
// ---------------------------------------------------------------------------

function People({ me, following, toggleFollow, nameOf }: {
  me: string; following: string[]; toggleFollow: (a: string) => void; nameOf: (a: string) => string;
}) {
  const [users, setUsers] = useState<UserInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const loadedRef = useRef(0);
  const totalRef = useRef(-1);
  const busyRef = useRef(false);

  const loadMore = useCallback(async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setLoading(true);
    try {
      if (totalRef.current === -1) {
        const r = await ig.getUserCount.query();
        totalRef.current = r.success ? Number(r.value) : 0;
      }
      const total = totalRef.current;
      const start = loadedRef.current;
      const count = Math.min(PAGE, total - start);
      if (count <= 0) { setHasMore(false); return; }

      const batch: UserInfo[] = [];
      for (let i = start; i < start + count; i++) {
        const uRes = await ig.getUserAt.query(BigInt(i));
        if (!uRes.success) continue;
        const ethAddr = uRes.value as string;
        const cRes = await ig.getPostCount.query(toBytes20(ethAddr));
        batch.push({ ethAddress: ethAddr, postCount: cRes.success ? Number(cRes.value) : 0 });
      }

      loadedRef.current = start + count;
      setUsers(prev => [...prev, ...batch]);
      setHasMore(start + count < total);
    } catch (err) {
      console.error("People load error:", err);
      setHasMore(false);
    } finally {
      busyRef.current = false;
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadMore(); }, []);

  const sentinelRef = useIntersectionObserver(loadMore, hasMore && !loading);

  const allPeople = users.filter(u => u.ethAddress.toLowerCase() !== me.toLowerCase());

  return (
    <div>
      {allPeople.map(u => (
        <div key={u.ethAddress} className="person">
          <div className="avatar">{nameOf(u.ethAddress)[0]}</div>
          <div className="person-info">
            <div className="person-addr">{nameOf(u.ethAddress)}</div>
            <div className="person-posts">{u.postCount} post{u.postCount !== 1 ? "s" : ""}</div>
          </div>
          <button
            className={`follow-btn ${following.includes(u.ethAddress) ? "following" : ""}`}
            onClick={() => toggleFollow(u.ethAddress)}
          >
            {following.includes(u.ethAddress) ? "Following" : "Follow"}
          </button>
        </div>
      ))}
      {loading && <div className="spinner">Loading...</div>}
      {hasMore && <div ref={sentinelRef} className="sentinel" />}
      {allPeople.length === 0 && !loading && <div className="empty">No users yet. Be the first to post!</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Create post (FAB + modal)
// ---------------------------------------------------------------------------

function CreatePost({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [desc, setDesc] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  const pickFile = (f: File | undefined) => {
    if (!f) return;
    setFile(f);
    setPreview(URL.createObjectURL(f));
  };

  const reset = () => {
    setDesc(""); setFile(null); setStatus("");
    if (preview) URL.revokeObjectURL(preview);
    setPreview(null);
  };

  const submit = async () => {
    if (!desc && !file) return;
    setBusy(true);
    try {
      let photoCid = "";
      if (file) {
        setStatus("Uploading photo to bulletin...");
        const bytes = new Uint8Array(await file.arrayBuffer());
        photoCid = await publishBlob(bytes);
      }
      setStatus("Submitting post on-chain...");
      const posted = await ig.createPost.tx(desc, photoCid);
      if (!posted.ok) throw posted.error;
      reset(); setOpen(false); onCreated();
    } catch (err) {
      console.error("Create post error:", err);
      setStatus("Failed — check console");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button className="fab" onClick={() => setOpen(true)}>+</button>
      {open && (
        <div className="modal-overlay" onClick={() => !busy && setOpen(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h2>New Post</h2>
            <label className="file-input">
              {file ? file.name : "Choose photo"}
              <input type="file" accept="image/*" hidden
                onChange={e => pickFile(e.target.files?.[0])} />
            </label>
            {preview && <img className="preview" src={preview} alt="preview" />}
            <textarea
              rows={3} placeholder="What's on your mind?"
              value={desc} onChange={e => setDesc(e.target.value)}
            />
            {status && <div className="status">{status}</div>}
            <div className="modal-actions">
              <button className="btn btn-ghost" onClick={() => { reset(); setOpen(false); }} disabled={busy}>
                Cancel
              </button>
              <button className="btn btn-primary" onClick={submit} disabled={busy || (!desc && !file)}>
                {busy ? "Posting..." : "Post"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
