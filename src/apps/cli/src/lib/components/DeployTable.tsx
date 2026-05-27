import React, { useState, useEffect } from "react";
import { Box, Text } from "ink";
import type { ContractStatus, PhaseInfo } from "../deploy-pipeline";
import {
    Link,
    Spinner,
    ProgressBar,
    EmptyBar,
    Cell,
    Idle,
    Done,
    Failed,
    Cached,
    LogTail,
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
    if (s.bytecodeSize !== undefined) return "deploy";
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
        const total = s.buildProgress.total;
        buildCell =
            total && total > 0 ? (
                <ProgressBar compiled={s.buildProgress.compiled} total={total} />
            ) : (
                <Box>
                    <Spinner tick={tick} />
                    <Text dimColor> {s.buildProgress.compiled}</Text>
                </Box>
            );
    } else if (state === "building") {
        buildCell = <Spinner tick={tick} />;
    } else if (state === "error" && errorPhase(s!) === "build") {
        buildCell = <Failed />;
    } else if (state === "waiting") {
        buildCell = <EmptyBar />;
    } else {
        // built/deploying/deployed/publishing/registering/done — show completed bar
        // plus the compiled bytecode size (base-10 kB/MB) if the library
        // populated `bytecodeSize` on the status.
        const bp = s?.buildProgress;
        if (bp?.total && bp.total > 0) {
            buildCell = (
                <ProgressBar compiled={bp.total} total={bp.total} sizeBytes={s?.bytecodeSize} />
            );
        } else if (s?.bytecodeSize) {
            buildCell = <ProgressBar compiled={1} total={1} sizeBytes={s.bytecodeSize} />;
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

    // Cached state — show cache indicator across all deploy columns
    if (state === "cached") {
        return (
            <Box>
                <Cell width={COL_CONTRACT}>
                    <Text bold wrap="truncate">
                        {name}
                    </Text>
                </Cell>
                <Cell width={COL_BUILD}>{buildCell}</Cell>
                <Cell width={COL_PHASE}>
                    <Cached />
                </Cell>
                <Cell width={COL_PHASE}>
                    <Cached />
                </Cell>
                <Cell width={COL_PHASE}>
                    <Cached />
                </Cell>
                <Cell width={COL_ADDR}>
                    {s?.address ? <Text dimColor>{truncateAddress(s.address)}</Text> : <Idle />}
                </Cell>
            </Box>
        );
    }

    // Deploy column — use deployInProgress flag for spinner
    let deployCell: React.ReactNode;
    if (state === "checking") {
        deployCell = <Spinner tick={tick} />;
    } else if (s?.deployInProgress) {
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
    logLines?: string[];
    logHeight?: number;
}

export function DeployTable({
    statuses,
    displayNames,
    crates,
    buildOnly,
    assethubUrl,
    ipfsGatewayUrl,
    logLines = [],
    logHeight = 5,
}: DeployTableProps) {
    const [tick, setTick] = useState(0);

    useEffect(() => {
        const timer = setInterval(() => setTick((t) => t + 1), 80);
        return () => clearInterval(timer);
    }, []);

    const rowCrates = [
        ...crates,
        ...Array.from(statuses.keys()).filter((crate) => !crates.includes(crate)),
    ];

    // Collect and group errors for display below table. Toolchain-level
    // failures often apply to every contract in a build batch, and printing
    // the same stderr once per row makes the TUI unusable.
    const errorGroups = new Map<string, string[]>();
    for (const crate of rowCrates) {
        const s = statuses.get(crate);
        if (s?.state === "error" && s.error) {
            const names = errorGroups.get(s.error) ?? [];
            names.push(displayNames.get(crate) ?? crate);
            errorGroups.set(s.error, names);
        }
    }
    const errors = [...errorGroups].map(([error, names]) => ({ error, names }));

    return (
        <Box flexDirection="column" marginTop={1}>
            {rowCrates.map((crate) => (
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
            {logLines.length > 0 && <LogTail lines={logLines} height={logHeight} />}
            {errors.length > 0 && (
                <Box flexDirection="column" marginTop={1}>
                    {errors.map(({ names, error }) => (
                        <Box key={`${names.join(",")}:${error}`} flexDirection="column">
                            <Text color="red">{formatErrorNames(names)}:</Text>
                            <Text>{error}</Text>
                        </Box>
                    ))}
                </Box>
            )}
        </Box>
    );
}

function formatErrorNames(names: string[]): string {
    if (names.length === 1) return names[0]!;
    const preview = names.slice(0, 3).join(", ");
    const suffix = names.length > 3 ? ", ..." : "";
    return `${names.length} contracts (${preview}${suffix})`;
}
