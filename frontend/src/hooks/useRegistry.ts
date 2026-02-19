import { useState, useEffect, useCallback, useRef } from "react";
import { useNetwork } from "../context/NetworkContext";
import type { Package, AbiEntry } from "../data/types";

const ORIGIN = "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY";
const PAGE_SIZE = 10;

function unwrapOption<T>(val: unknown): T | undefined {
  if (val && typeof val === "object" && "isSome" in val) {
    const opt = val as { isSome: boolean; value: T };
    return opt.isSome ? opt.value : undefined;
  }
  return val as T;
}

export function useRegistry() {
  const { registry, connected, connecting, error: networkError, network, ipfsGatewayUrl } = useNetwork();
  const [packages, setPackages] = useState<Package[]>([]);
  const [loading, setLoading] = useState(false);
  const [queryError, setQueryError] = useState<string | null>(null);
  const [totalCount, setTotalCount] = useState(0);
  const nextIndex = useRef(-1);

  // Reset when registry changes
  useEffect(() => {
    setPackages([]);
    setQueryError(null);
    setTotalCount(0);
    nextIndex.current = -1;
  }, [registry]);

  const loadBatch = useCallback(async () => {
    if (!registry || !connected) return;

    setLoading(true);
    setQueryError(null);

    try {
      // Get total count if we don't have it yet
      let count = totalCount;
      if (count === 0) {
        const countResult = await registry.query("getContractCount", {
          origin: ORIGIN,
          data: {},
        });
        if (!countResult.success) {
          throw new Error("Failed to query contract count");
        }
        count = countResult.value.response;
        setTotalCount(count);
      }

      if (count === 0) {
        setLoading(false);
        return;
      }

      // On first load, start from the newest contract
      if (nextIndex.current === -1) {
        nextIndex.current = count - 1;
      }

      const start = nextIndex.current;
      const end = Math.max(start - PAGE_SIZE, -1);

      const newPackages: Package[] = [];

      for (let i = start; i > end; i--) {
        const nameResult = await registry.query("getContractNameAt", {
          origin: ORIGIN,
          data: { index: i },
        });
        if (!nameResult.success) continue;
        const name = nameResult.value.response;

        // Fetch version count, metadata URI, and address in parallel
        const [versionResult, metadataResult, addressResult] = await Promise.all([
          registry.query("getVersionCount", {
            origin: ORIGIN,
            data: { contract_name: name },
          }),
          registry.query("getMetadataUri", {
            origin: ORIGIN,
            data: { contract_name: name },
          }),
          registry.query("getAddress", {
            origin: ORIGIN,
            data: { contract_name: name },
          }),
        ]);

        const versionCount = versionResult.success ? versionResult.value.response : 0;
        const metadataUri = metadataResult.success
          ? unwrapOption<string>(metadataResult.value.response)
          : undefined;
        const address = addressResult.success
          ? unwrapOption<string>(addressResult.value.response)
          : undefined;

        // Fetch description from IPFS if the metadataUri is a CID (not the old bulletin:block:index format)
        let description: string | undefined;
        let readme: string | undefined;
        let homepage: string | undefined;
        let repository: string | undefined;
        let author: string | undefined;
        let lastPublished: string | undefined;
        let abi: AbiEntry[] | undefined;

        if (metadataUri && ipfsGatewayUrl && !metadataUri.includes(":")) {
          try {
            const response = await fetch(`${ipfsGatewayUrl}/${metadataUri}`);
            const metadata = await response.json();
            description = metadata.description || undefined;
            readme = metadata.readme || undefined;
            homepage = metadata.homepage || undefined;
            repository = metadata.repository || undefined;

            if (Array.isArray(metadata.authors) && metadata.authors.length > 0) {
              author = metadata.authors.join(", ");
            }

            if (metadata.published_at) {
              lastPublished = new Date(metadata.published_at).toLocaleDateString("en-US", {
                year: "numeric",
                month: "short",
                day: "numeric",
              });
            }

            if (Array.isArray(metadata.abi)) {
              abi = metadata.abi;
            }
          } catch {
            // Metadata fetch failed - leave fields undefined
          }
        }

        newPackages.push({
          name,
          version: String(versionCount),
          description,
          readme,
          homepage,
          repository,
          author,
          lastPublished,
          publishedDate: lastPublished,
          weeklyCalls: 0,
          abi,
          address,
        });
      }

      nextIndex.current = end;
      setPackages((prev) => [...prev, ...newPackages]);
    } catch (err) {
      setQueryError(err instanceof Error ? err.message : "Failed to load contracts");
    } finally {
      setLoading(false);
    }
  }, [registry, connected, totalCount, ipfsGatewayUrl]);

  // Auto-load first batch when registry connects
  useEffect(() => {
    if (registry && connected && nextIndex.current === -1) {
      loadBatch();
    }
  }, [registry, connected, loadBatch]);

  const hasMore = nextIndex.current >= 0;

  // Surface whichever error is relevant: network-level or query-level
  const error = networkError ?? queryError;

  return { packages, loading: loading || connecting, error, hasMore, loadMore: loadBatch, totalCount, network };
}
