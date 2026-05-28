#!/usr/bin/env bun
/**
 * Local bulletin → IPFS HTTP gateway.
 *
 * PPN doesn't ship a bulletin-to-IPFS translator, but the bulletin node
 * already exposes a `bitswap_v1_get` JSON-RPC method that fetches bytes by
 * CID. This gateway translates the standard `GET /ipfs/<cid>` HTTP shape
 * into that RPC call so that any tool expecting an IPFS gateway (CDM's
 * `connectIpfsGateway`, frontends, generic CID fetchers) just works against
 * local PPN.
 *
 * Run standalone: `bun src/lib/scripts/bulletin-ipfs-gateway.ts`
 * Programmatic:   `import { startBulletinIpfsGateway } from "..."`
 *
 * Configurable via env when run standalone:
 *   BULLETIN_RPC  default http://127.0.0.1:10030
 *   PORT          default 8283
 *   HOST          default 127.0.0.1
 */
import { createServer, type Server } from "node:http";

export interface BulletinIpfsGatewayOptions {
    bulletinRpc?: string;
    port?: number;
    host?: string;
}

interface BitswapResult {
    result?: string | { data?: string };
    error?: { code: number; message: string };
}

function decodeBitswapResult(result: BitswapResult["result"]): Uint8Array | undefined {
    // Substrate JSON-RPC returns binary as a `0x`-prefixed hex string. Some
    // pallets wrap it in `{ data: "0x..." }`; handle both shapes.
    const hex = typeof result === "string" ? result : result?.data;
    if (!hex) return undefined;
    const stripped = hex.startsWith("0x") ? hex.slice(2) : hex;
    if (stripped.length === 0 || stripped.length % 2 !== 0) return undefined;
    return Buffer.from(stripped, "hex");
}

async function fetchBitswap(bulletinRpc: string, cid: string): Promise<Uint8Array> {
    const res = await fetch(bulletinRpc, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: 1, jsonrpc: "2.0", method: "bitswap_v1_get", params: [cid] }),
    });
    if (!res.ok) throw new Error(`bulletin RPC ${res.status}: ${await res.text()}`);
    const body = (await res.json()) as BitswapResult;
    if (body.error) throw new Error(`bitswap_v1_get: ${body.error.message}`);
    const bytes = decodeBitswapResult(body.result);
    if (!bytes) {
        throw new Error(`bitswap_v1_get: unexpected result shape ${JSON.stringify(body.result)}`);
    }
    return bytes;
}

export function startBulletinIpfsGateway(opts: BulletinIpfsGatewayOptions = {}): Server {
    const bulletinRpc = opts.bulletinRpc ?? "http://127.0.0.1:10030";
    const port = opts.port ?? 8283;
    const host = opts.host ?? "127.0.0.1";

    const server = createServer(async (req, res) => {
        res.setHeader("Access-Control-Allow-Origin", "*");
        if (req.method === "OPTIONS") {
            res.statusCode = 204;
            res.end();
            return;
        }
        if (req.method !== "GET" && req.method !== "HEAD") {
            res.statusCode = 405;
            res.end("method not allowed");
            return;
        }

        if (req.url === "/" || req.url === "/healthz") {
            res.statusCode = 200;
            res.end("ok");
            return;
        }

        const match = req.url?.match(/^\/ipfs\/([A-Za-z0-9]+)/);
        if (!match) {
            res.statusCode = 404;
            res.end("usage: GET /ipfs/<cid>");
            return;
        }

        try {
            const bytes = await fetchBitswap(bulletinRpc, match[1]);
            res.statusCode = 200;
            res.setHeader("Content-Type", "application/octet-stream");
            res.setHeader("Content-Length", String(bytes.byteLength));
            res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
            res.end(req.method === "HEAD" ? undefined : bytes);
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            res.statusCode = msg.includes("not found") || msg.includes("NotFound") ? 404 : 502;
            res.end(msg);
        }
    });

    server.listen(port, host, () => {
        console.log(`bulletin-ipfs-gateway: ${host}:${port} → ${bulletinRpc}`);
    });
    return server;
}

// Allow `bun src/lib/scripts/bulletin-ipfs-gateway.ts` to run the server directly.
if (import.meta.main) {
    startBulletinIpfsGateway({
        bulletinRpc: process.env.BULLETIN_RPC,
        port: process.env.PORT ? Number(process.env.PORT) : undefined,
        host: process.env.HOST,
    });
}
