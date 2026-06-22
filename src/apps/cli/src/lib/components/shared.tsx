import React from "react";
import { Box, Text } from "ink";
import supportsHyperlinks from "supports-hyperlinks";

/** Whether the terminal supports OSC 8 embedded hyperlinks. */
export const hyperlinksSupported = supportsHyperlinks.stdout;

/** Terminal hyperlink using OSC 8 escape sequence */
export function Link({ url, children }: { url: string; children: React.ReactNode }) {
    if (hyperlinksSupported) {
        return (
            <Text>
                {`\x1b]8;;${url}\x07`}
                {children}
                {`\x1b]8;;\x07`}
            </Text>
        );
    }
    // No OSC 8 support: render only the short anchor text in the cell so the
    // table stays aligned. The full URL is surfaced separately on its own line
    // via <LinkLine>. Rendering the full URL here would squeeze it into a
    // narrow column and wrap it into an unreadable smear (issue #44).
    return <Text>{children}</Text>;
}

/**
 * A full link printed on its own line, used as a fallback when the terminal
 * lacks OSC 8 hyperlink support. The URL is rendered outside the table grid so
 * it stays on a single line instead of being squeezed into a column.
 */
export function LinkLine({ label, url }: { label?: string; url: string }) {
    return (
        <Text>
            <Text dimColor>{`  ↳ ${label ? `${label.padEnd(8)} ` : ""}`}</Text>
            <Text color="cyan">{url}</Text>
        </Text>
    );
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
    const ratio = total > 0 ? Math.min(1, Math.max(0, compiled / total)) : 0;
    const filled = Math.round(ratio * BAR_WIDTH);
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

export function Skipped() {
    return <Text dimColor>—</Text>;
}

export function LogTail({
    lines,
    height,
}: {
    lines: string[];
    height: number;
}) {
    const tail = lines.slice(-height);
    return (
        <Box flexDirection="column" height={height} marginTop={1}>
            {Array.from({ length: height }, (_, i) => (
                <Text key={i} dimColor wrap="truncate">
                    {tail[i] ?? " "}
                </Text>
            ))}
        </Box>
    );
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
    return `${gatewayUrl.replace(/\/+$/, "")}/${cid.replace(/^\/+/, "")}`;
}
