import React, { useState, useEffect } from "react";
import { Box, Text } from "ink";
import type { InstallStatus } from "../install-pipeline";
import { Spinner, Cell, Idle, Done, Failed, truncateAddress, shortHash } from "./shared";

const COL_CONTRACT = 24;
const COL_REGISTRY = 10;
const COL_IPFS = 10;
const COL_SAVE = 10;
const COL_ADDR = 14;

function InstallRow({
    library,
    status,
    tick,
}: {
    library: string;
    status: InstallStatus | undefined;
    tick: number;
}) {
    const s = status;
    const state = s?.state ?? "waiting";

    // Registry column
    let registryCell: React.ReactNode;
    if (state === "querying") {
        registryCell = <Spinner tick={tick} />;
    } else if (state === "error" && !s?.version) {
        registryCell = <Failed />;
    } else if (s?.version !== undefined) {
        registryCell = <Text color="green">v{s.version}</Text>;
    } else {
        registryCell = <Idle />;
    }

    // IPFS column
    let ipfsCell: React.ReactNode;
    if (state === "fetching") {
        ipfsCell = <Spinner tick={tick} />;
    } else if (state === "error" && s?.version !== undefined && !s?.metadataCid) {
        ipfsCell = <Failed />;
    } else if (s?.metadataCid) {
        ipfsCell = <Text color="green">{shortHash(s.metadataCid)}</Text>;
    } else {
        ipfsCell = <Idle />;
    }

    // Save column
    let saveCell: React.ReactNode;
    if (state === "saving") {
        saveCell = <Spinner tick={tick} />;
    } else if (state === "error" && s?.metadataCid && !s?.savedPath) {
        saveCell = <Failed />;
    } else if (state === "done") {
        saveCell = <Done />;
    } else {
        saveCell = <Idle />;
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
            <Cell width={COL_REGISTRY}>{registryCell}</Cell>
            <Cell width={COL_IPFS}>{ipfsCell}</Cell>
            <Cell width={COL_SAVE}>{saveCell}</Cell>
            <Cell width={COL_ADDR}>{addrCell}</Cell>
        </Box>
    );
}

export interface InstallTableProps {
    statuses: Map<string, InstallStatus>;
    libraries: string[];
}

export function InstallTable({ statuses, libraries }: InstallTableProps) {
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
                <Cell width={COL_REGISTRY}>
                    <Text dimColor>Registry</Text>
                </Cell>
                <Cell width={COL_IPFS}>
                    <Text dimColor>IPFS</Text>
                </Cell>
                <Cell width={COL_SAVE}>
                    <Text dimColor>Save</Text>
                </Cell>
                <Cell width={COL_ADDR}>
                    <Text dimColor>Address</Text>
                </Cell>
            </Box>
            {libraries.map((lib) => (
                <InstallRow key={lib} library={lib} status={statuses.get(lib)} tick={tick} />
            ))}
            {errors.length > 0 && (
                <Box flexDirection="column" marginTop={1}>
                    {errors.map(({ name, error }) => (
                        <Box key={name} flexDirection="column">
                            <Text color="red">{name}:</Text>
                            <Text>  {error}</Text>
                        </Box>
                    ))}
                </Box>
            )}
        </Box>
    );
}
