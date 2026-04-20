import React from "react";
import { Box, Text } from "ink";
import supportsHyperlinks from "supports-hyperlinks";

/** Terminal hyperlink using OSC 8 escape sequence */
export function Link({ url, children }: { url: string; children: React.ReactNode }) {
    if (supportsHyperlinks.stdout) {
        return (
            <Text>
                {`\x1b]8;;${url}\x07`}
                {children}
                {`\x1b]8;;\x07`}
            </Text>
        );
    }
    return <Text>{url}</Text>;
}

export const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export function Spinner({ tick }: { tick: number }) {
    return <Text color="yellow">{SPINNER_FRAMES[tick % SPINNER_FRAMES.length]}</Text>;
}

export const BAR_WIDTH = 12;

export function ProgressBar({
    compiled,
    total,
    sizeBytes,
}: {
    compiled: number;
    total: number;
    /** If provided, render the formatted size instead of the `compiled/total`
     * fraction. Used after build completion to surface the .polkavm size. */
    sizeBytes?: number;
}) {
    const filled = total > 0 ? Math.round((compiled / total) * BAR_WIDTH) : 0;
    const tail = sizeBytes && sizeBytes > 0 ? formatBytes(sizeBytes) : `${compiled}/${total}`;
    return (
        <Text>
            <Text color="green">{"█".repeat(filled)}</Text>
            <Text dimColor>{"░".repeat(BAR_WIDTH - filled)}</Text>
            <Text> {tail}</Text>
        </Text>
    );
}

export function EmptyBar() {
    return <Text dimColor>{"░".repeat(BAR_WIDTH)}</Text>;
}

export function Cell({ children, width }: { children: React.ReactNode; width: number }) {
    return (
        <Box width={width} marginRight={1}>
            {typeof children === "string" ? <Text>{children}</Text> : children}
        </Box>
    );
}

export function Idle() {
    return <Text dimColor>.</Text>;
}

export function Done() {
    return <Text color="green">✔</Text>;
}

export function Failed() {
    return <Text color="red">✖</Text>;
}

export function Cached() {
    return <Text color="blue">~</Text>;
}

/**
 * Format a byte count as a compact, base-10 size string.
 * Chosen to be short enough to sit inside a 20-char build column.
 * Examples: `512B`, `12.3KB`, `1.4MB`.
 */
export function formatBytes(bytes: number | undefined | null): string {
    if (!bytes || bytes <= 0) return "";
    if (bytes < 1000) return `${bytes}B`;
    if (bytes < 1_000_000) return `${(bytes / 1000).toFixed(1)}KB`;
    return `${(bytes / 1_000_000).toFixed(1)}MB`;
}

export function truncateAddress(addr: string): string {
    if (addr.length <= 14) return addr;
    return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export function shortHash(hash: string): string {
    if (hash.startsWith("0x")) return hash.slice(2, 6);
    // CIDs share a common prefix (e.g. "bafk"), so use last 4 chars
    return hash.slice(-4);
}

export function pjsExplorerUrl(rpcUrl: string, blockHash: string): string {
    return `https://polkadot.js.org/apps/?rpc=${encodeURIComponent(rpcUrl)}#/explorer/query/${blockHash}`;
}

export function ipfsUrl(gatewayUrl: string, cid: string): string {
    return `${gatewayUrl}/${cid}`;
}
