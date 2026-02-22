import React from "react";
import { Box, Text } from "ink";

/** Terminal hyperlink using OSC 8 escape sequence */
export function Link({ url, children }: { url: string; children: React.ReactNode }) {
    return (
        <Text>
            {`\x1b]8;;${url}\x07`}
            {children}
            {`\x1b]8;;\x07`}
        </Text>
    );
}

export const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export function Spinner({ tick }: { tick: number }) {
    return <Text color="yellow">{SPINNER_FRAMES[tick % SPINNER_FRAMES.length]}</Text>;
}

export const BAR_WIDTH = 12;

export function ProgressBar({ compiled, total }: { compiled: number; total: number }) {
    const filled = total > 0 ? Math.round((compiled / total) * BAR_WIDTH) : 0;
    return (
        <Text>
            <Text color="green">{"█".repeat(filled)}</Text>
            <Text dimColor>{"░".repeat(BAR_WIDTH - filled)}</Text>
            <Text>
                {" "}
                {compiled}/{total}
            </Text>
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
