import React, { useState, useEffect } from "react";
import { Box, Text } from "ink";
import type { InstallStatus } from "../install-pipeline";
import {
    Link,
    Spinner,
    Cell,
    Idle,
    Done,
    Failed,
    truncateAddress,
    shortHash,
    ipfsUrl,
} from "./shared";

const COL_CONTRACT = 24;
const COL_VERSION = 10;
const COL_META = 10;
const COL_ADDR = 14;

function InstallRow({
    library,
    status,
    tick,
    ipfsGatewayUrl,
}: {
    library: string;
    status: InstallStatus | undefined;
    tick: number;
    ipfsGatewayUrl?: string;
}) {
    const s = status;
    const state = s?.state ?? "waiting";

    // Version column
    let versionCell: React.ReactNode;
    if (state === "querying") {
        versionCell = <Spinner tick={tick} />;
    } else if (state === "error" && !s?.version) {
        versionCell = <Failed />;
    } else if (s?.version !== undefined) {
        versionCell = <Text color="green">v{s.version}</Text>;
    } else {
        versionCell = <Idle />;
    }

    // Metadata column
    let metaCell: React.ReactNode;
    if (state === "fetching") {
        metaCell = <Spinner tick={tick} />;
    } else if (state === "error" && s?.version !== undefined && !s?.metadataCid) {
        metaCell = <Failed />;
    } else if (state === "done" && s?.metadataCid && ipfsGatewayUrl) {
        metaCell = (
            <Link url={ipfsUrl(ipfsGatewayUrl, s.metadataCid)}>
                <Text color="green">{shortHash(s.metadataCid)}</Text>
            </Link>
        );
    } else if (s?.metadataCid) {
        metaCell = <Text color="green">{shortHash(s.metadataCid)}</Text>;
    } else {
        metaCell = <Idle />;
    }

    // Address column
    let addrCell: React.ReactNode;
    if (s?.address) {
        addrCell = <Text dimColor>{truncateAddress(s.address)}</Text>;
    } else {
        addrCell = <Idle />;
    }

    return (
        <Box>
            <Cell width={COL_CONTRACT}>
                <Text bold wrap="truncate">
                    {library}
                </Text>
            </Cell>
            <Cell width={COL_VERSION}>{versionCell}</Cell>
            <Cell width={COL_META}>{metaCell}</Cell>
            <Cell width={COL_ADDR}>{addrCell}</Cell>
        </Box>
    );
}

export interface InstallTableProps {
    statuses: Map<string, InstallStatus>;
    libraries: string[];
    ipfsGatewayUrl?: string;
}

export function InstallTable({ statuses, libraries, ipfsGatewayUrl }: InstallTableProps) {
    const [tick, setTick] = useState(0);

    useEffect(() => {
        const timer = setInterval(() => setTick((t) => t + 1), 80);
        return () => clearInterval(timer);
    }, []);

    // Collect errors for display below table
    const errors: { name: string; error: string }[] = [];
    for (const lib of libraries) {
        const s = statuses.get(lib);
        if (s?.state === "error" && s.error) {
            errors.push({ name: lib, error: s.error });
        }
    }

    return (
        <Box flexDirection="column" marginTop={1}>
            {/* Header row */}
            <Box>
                <Cell width={COL_CONTRACT}>
                    <Text dimColor>Contract</Text>
                </Cell>
                <Cell width={COL_VERSION}>
                    <Text dimColor>Version</Text>
                </Cell>
                <Cell width={COL_META}>
                    <Text dimColor>Metadata</Text>
                </Cell>
                <Cell width={COL_ADDR}>
                    <Text dimColor>Address</Text>
                </Cell>
            </Box>
            {libraries.map((lib) => (
                <InstallRow
                    key={lib}
                    library={lib}
                    status={statuses.get(lib)}
                    tick={tick}
                    ipfsGatewayUrl={ipfsGatewayUrl}
                />
            ))}
            {errors.length > 0 && (
                <Box flexDirection="column" marginTop={1}>
                    {errors.map(({ name, error }) => (
                        <Box key={name} flexDirection="column">
                            <Text color="red">{name}:</Text>
                            <Text> {error}</Text>
                        </Box>
                    ))}
                </Box>
            )}
        </Box>
    );
}
