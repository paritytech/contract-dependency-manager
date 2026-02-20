import React, { useState, useEffect } from "react";
import { Box, Text } from "ink";
import type { ContractStatus } from "../pipeline.js";

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

function Spinner({ tick }: { tick: number }) {
    return <Text color="yellow">{SPINNER_FRAMES[tick % SPINNER_FRAMES.length]}</Text>;
}

const BAR_WIDTH = 12;

function ProgressBar({ compiled, total }: { compiled: number; total: number }) {
    const filled = total > 0 ? Math.round((compiled / total) * BAR_WIDTH) : 0;
    return (
        <Text>
            <Text color="green">{"█".repeat(filled)}</Text>
            <Text dimColor>{"░".repeat(BAR_WIDTH - filled)}</Text>
            <Text> {compiled}/{total}</Text>
        </Text>
    );
}

function EmptyBar() {
    return <Text dimColor>{"░".repeat(BAR_WIDTH)}</Text>;
}

function truncateAddress(addr: string): string {
    if (addr.length <= 14) return addr;
    return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

const COL_CONTRACT = 24;
const COL_BUILD = 20;
const COL_PHASE = 3;
const COL_ADDR = 14;

function Cell({ children, width }: { children: React.ReactNode; width: number }) {
    return (
        <Box width={width} marginRight={1}>
            {typeof children === "string" ? <Text>{children}</Text> : children}
        </Box>
    );
}

function Idle() {
    return <Text dimColor>.</Text>;
}

function Done() {
    return <Text color="green">✔</Text>;
}

function Failed() {
    return <Text color="red">✖</Text>;
}

/** Infer which phase failed based on what fields exist on the status */
function errorPhase(s: ContractStatus): "build" | "deploy" | "metadata" | "register" {
    if (s.cid) return "register";
    if (s.address) {
        return "metadata";
    }
    if (s.buildProgress && s.buildProgress.compiled === s.buildProgress.total && s.buildProgress.total > 0) {
        return "deploy";
    }
    return "build";
}

function ContractRow({
    name,
    status,
    tick,
    buildOnly,
}: {
    name: string;
    status: ContractStatus | undefined;
    tick: number;
    buildOnly: boolean;
}) {
    const s = status;
    const state = s?.state ?? "waiting";

    // Build column — keep progress bar even when done, empty bar when waiting
    let buildCell: React.ReactNode;
    if (state === "building" && s?.buildProgress) {
        buildCell = <ProgressBar compiled={s.buildProgress.compiled} total={s.buildProgress.total} />;
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
                <Cell width={COL_CONTRACT}><Text bold wrap="truncate">{name}</Text></Cell>
                <Cell width={COL_BUILD}>{buildCell}</Cell>
            </Box>
        );
    }

    // Deploy column
    let deployCell: React.ReactNode;
    if (state === "deploying") {
        deployCell = <Spinner tick={tick} />;
    } else if (state === "error" && errorPhase(s!) === "deploy") {
        deployCell = <Failed />;
    } else if (["deployed", "publishing", "registering", "done"].includes(state)) {
        deployCell = <Done />;
    } else {
        deployCell = <Idle />;
    }

    // Metadata column
    let metaCell: React.ReactNode;
    if (state === "publishing") {
        metaCell = <Spinner tick={tick} />;
    } else if (state === "error" && errorPhase(s!) === "metadata") {
        metaCell = <Failed />;
    } else if (["registering", "done"].includes(state)) {
        metaCell = <Done />;
    } else {
        metaCell = <Idle />;
    }

    // Register column
    let registerCell: React.ReactNode;
    if (state === "registering") {
        registerCell = <Spinner tick={tick} />;
    } else if (state === "error" && errorPhase(s!) === "register") {
        registerCell = <Failed />;
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
            <Cell width={COL_CONTRACT}><Text bold wrap="truncate">{name}</Text></Cell>
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
}

export function DeployTable({ statuses, displayNames, crates, buildOnly }: DeployTableProps) {
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
