import {
  useState, useEffect, useMemo, useCallback, useRef, type ReactNode,
} from "react";
import { createCdm } from "@dotdm/cdm";
import { FixedSizeBinary } from "polkadot-api";
import {
  ACCOUNTS, deriveWallet, useIntersectionObserver, short, ago, publishBlob,
  type Wallet,
} from "./utils.ts";
import cdmJson from "../cdm.json";

// ---------------------------------------------------------------------------
// CDM — one connection for the lifetime of the page
// ---------------------------------------------------------------------------

const cdm = createCdm(cdmJson);
const ig  = cdm.getContract("@example/instagram");

const toBytes = (hex: string) => FixedSizeBinary.fromHex(hex);

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

const IPFS_GATEWAY = "https://paseo-ipfs.polkadot.io/ipfs/";
const PAGE = 8;

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

export default function App() {
  const [accountIdx, setAccountIdx] = useState(0);
  const wallet = useMemo<Wallet>(() => deriveWallet(ACCOUNTS[accountIdx].mnemonic), [accountIdx]);
  const me = ACCOUNTS[accountIdx].ethAddress;

  const [tab, setTab] = useState<"posts" | "people">("posts");

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
    ACCOUNTS.find(a => a.ethAddress === addr)?.name ?? short(addr);

  return (
    <>
      <header>
        <h1>instagram</h1>
        <select
          className="account-select"
          value={accountIdx}
          onChange={e => setAccountIdx(Number(e.target.value))}
        >
          {ACCOUNTS.map((a, i) => <option key={i} value={i}>{a.name}</option>)}
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
        ? <Feed following={following} nameOf={nameOf} wallet={wallet} />
        : <People me={me} following={following} toggleFollow={toggleFollow} nameOf={nameOf} />
      }

      <CreatePost wallet={wallet} onCreated={() => setTab("posts")} />
    </>
  );
}

// ---------------------------------------------------------------------------
// Feed — breadth-first across followed users
// ---------------------------------------------------------------------------

function Feed({ following, nameOf, wallet }: {
  following: string[]; nameOf: (a: string) => string; wallet: Wallet;
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
          const r = await ig.getPostCount.query(toBytes(addr));
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
        const r = await ig.getPost.query(toBytes(addr), BigInt(postIdx));
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
  }, [loading, hasMore, following, nameOf, wallet]);

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

  const loadMore = useCallback(async () => {
    if (loading) return;
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
        const ethAddr = "0x" + [...uRes.value].map((b: number) => b.toString(16).padStart(2, "0")).join("");
        const cRes = await ig.getPostCount.query(toBytes(ethAddr));
        batch.push({ ethAddress: ethAddr, postCount: cRes.success ? Number(cRes.value) : 0 });
      }

      loadedRef.current = start + count;
      setUsers(prev => [...prev, ...batch]);
      setHasMore(start + count < total);
    } catch (err) {
      console.error("People load error:", err);
      setHasMore(false);
    } finally {
      setLoading(false);
    }
  }, [loading]);

  useEffect(() => { loadMore(); }, []);

  const sentinelRef = useIntersectionObserver(loadMore, hasMore && !loading);

  // Show known dev accounts first (even if they haven't posted yet)
  const allPeople = useMemo(() => {
    const onChain = new Map(users.map(u => [u.ethAddress, u]));
    const devAccounts: UserInfo[] = ACCOUNTS
      .filter(a => a.ethAddress !== me && !onChain.has(a.ethAddress))
      .map(a => ({ ethAddress: a.ethAddress, postCount: 0 }));
    return [...users.filter(u => u.ethAddress !== me), ...devAccounts];
  }, [users, me]);

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

function CreatePost({ wallet, onCreated }: { wallet: Wallet; onCreated: () => void }) {
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
        photoCid = await publishBlob(bytes, wallet.signer);
      }
      setStatus("Submitting post on-chain...");
      await ig.createPost.tx(desc, photoCid, {
        signer: wallet.signer,
        origin: wallet.address,
      });
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
