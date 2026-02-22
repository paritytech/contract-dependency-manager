import React, { useState, useEffect } from "react";
import { Box, Text } from "ink";
import type { ContractStatus } from "../deploy-pipeline";
import {
    Link,
    Spinner,
    ProgressBar,
    EmptyBar,
    Cell,
    Idle,
    Done,
    Failed,
    truncateAddress,
    shortHash,
    pjsExplorerUrl,
    ipfsUrl,
} from "./shared";

const COL_CONTRACT = 24;
const COL_BUILD = 20;
const COL_PHASE = 5;
const COL_ADDR = 14;

/** Infer which phase failed based on what fields exist on the status */
function errorPhase(s: ContractStatus): "build" | "deploy" | "metadata" | "register" {
    // Register failed: both deploy and publish completed, error during register
    if (s.address && s.publishTxHash) return "register";
    // Deploy completed but publish didn't: metadata/publish failure
    if (s.address && !s.publishTxHash && s.cid) return "metadata";
    // Build completed: deploy phase (or parallel deploy+publish) failed
    if (
        s.buildProgress &&
        s.buildProgress.compiled === s.buildProgress.total &&
        s.buildProgress.total > 0
    ) {
        return "deploy";
    }
    return "build";
}

function ContractRow({
    name,
    status,
    tick,
    buildOnly,
    assethubUrl,
    ipfsGatewayUrl,
}: {
    name: string;
    status: ContractStatus | undefined;
    tick: number;
    buildOnly: boolean;
    assethubUrl?: string;
    ipfsGatewayUrl?: string;
}) {
    const s = status;
    const state = s?.state ?? "waiting";

    // Build column — keep progress bar even when done, empty bar when waiting
    let buildCell: React.ReactNode;
    if (state === "building" && s?.buildProgress) {
        buildCell = (
            <ProgressBar compiled={s.buildProgress.compiled} total={s.buildProgress.total} />
        );
    } else if (state === "building") {
        buildCell = <Spinner tick={tick} />;
    } else if (state === "error" && errorPhase(s!) === "build") {
        buildCell = <Failed />;
    } else if (state === "waiting") {
        buildCell = <EmptyBar />;
    } else {
        // built/deploying/deployed/publishing/registering/done — show completed bar
        const bp = s?.buildProgress;
        if (bp) {
            buildCell = <ProgressBar compiled={bp.total} total={bp.total} />;
        } else {
            buildCell = <Done />;
        }
    }

    if (buildOnly) {
        return (
            <Box>
                <Cell width={COL_CONTRACT}>
                    <Text bold wrap="truncate">
                        {name}
                    </Text>
                </Cell>
                <Cell width={COL_BUILD}>{buildCell}</Cell>
            </Box>
        );
    }

    // Deploy column — use deployInProgress flag for spinner
    let deployCell: React.ReactNode;
    if (s?.deployInProgress) {
        deployCell = <Spinner tick={tick} />;
    } else if (state === "error" && errorPhase(s!) === "deploy") {
        deployCell = <Failed />;
    } else if (
        ["registering", "done"].includes(state) &&
        s?.deployTxHash &&
        s?.deployBlockHash &&
        assethubUrl
    ) {
        deployCell = (
            <Link url={pjsExplorerUrl(assethubUrl, s.deployBlockHash)}>
                <Text color="green">{shortHash(s.deployTxHash)}</Text>
            </Link>
        );
    } else if (["registering", "done"].includes(state)) {
        deployCell = <Done />;
    } else {
        deployCell = <Idle />;
    }

    // Metadata column — use publishInProgress flag for spinner
    let metaCell: React.ReactNode;
    if (s?.publishInProgress) {
        metaCell = <Spinner tick={tick} />;
    } else if (state === "error" && errorPhase(s!) === "metadata") {
        metaCell = <Failed />;
    } else if (["registering", "done"].includes(state) && s?.cid && ipfsGatewayUrl) {
        metaCell = (
            <Link url={ipfsUrl(ipfsGatewayUrl, s.cid)}>
                <Text color="green">{shortHash(s.cid)}</Text>
            </Link>
        );
    } else if (["registering", "done"].includes(state) && s?.publishTxHash) {
        metaCell = <Done />;
    } else {
        metaCell = <Idle />;
    }

    // Register column — use registerInProgress flag for spinner
    let registerCell: React.ReactNode;
    if (s?.registerInProgress) {
        registerCell = <Spinner tick={tick} />;
    } else if (state === "error" && errorPhase(s!) === "register") {
        registerCell = <Failed />;
    } else if (state === "done" && s?.registerTxHash && s?.registerBlockHash && assethubUrl) {
        registerCell = (
            <Link url={pjsExplorerUrl(assethubUrl, s.registerBlockHash)}>
                <Text color="green">{shortHash(s.registerTxHash)}</Text>
            </Link>
        );
    } else if (state === "done") {
        registerCell = <Done />;
    } else {
        registerCell = <Idle />;
    }

    // Address column (at the end)
    const addr = s?.address ? truncateAddress(s.address) : undefined;
    let addrCell: React.ReactNode;
    if (addr) {
        addrCell = <Text dimColor>{addr}</Text>;
    } else {
        addrCell = <Idle />;
    }

    return (
        <Box>
            <Cell width={COL_CONTRACT}>
                <Text bold wrap="truncate">
                    {name}
                </Text>
            </Cell>
            <Cell width={COL_BUILD}>{buildCell}</Cell>
            <Cell width={COL_PHASE}>{deployCell}</Cell>
            <Cell width={COL_PHASE}>{metaCell}</Cell>
            <Cell width={COL_PHASE}>{registerCell}</Cell>
            <Cell width={COL_ADDR}>{addrCell}</Cell>
        </Box>
    );
}

export interface DeployTableProps {
    statuses: Map<string, ContractStatus>;
    displayNames: Map<string, string>;
    crates: string[];
    buildOnly: boolean;
    assethubUrl?: string;
    bulletinUrl?: string;
    ipfsGatewayUrl?: string;
}

export function DeployTable({
    statuses,
    displayNames,
    crates,
    buildOnly,
    assethubUrl,
    ipfsGatewayUrl,
}: DeployTableProps) {
    const [tick, setTick] = useState(0);

    useEffect(() => {
        const timer = setInterval(() => setTick((t) => t + 1), 80);
        return () => clearInterval(timer);
    }, []);

    // Collect errors for display below table
    const errors: { name: string; error: string }[] = [];
    for (const crate of crates) {
        const s = statuses.get(crate);
        if (s?.state === "error" && s.error) {
            errors.push({ name: displayNames.get(crate) ?? crate, error: s.error });
        }
    }

    return (
        <Box flexDirection="column" marginTop={1}>
            {crates.map((crate) => (
                <ContractRow
                    key={crate}
                    name={displayNames.get(crate) ?? crate}
                    status={statuses.get(crate)}
                    tick={tick}
                    buildOnly={buildOnly}
                    assethubUrl={assethubUrl}
                    ipfsGatewayUrl={ipfsGatewayUrl}
                />
            ))}
            {errors.length > 0 && (
                <Box flexDirection="column" marginTop={1}>
                    {errors.map(({ name, error }) => (
                        <Box key={name} flexDirection="column">
                            <Text color="red">{name}:</Text>
                            <Text>{error}</Text>
                        </Box>
                    ))}
                </Box>
            )}
        </Box>
    );
}
