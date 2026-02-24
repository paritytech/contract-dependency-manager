import React from "react";
import { render } from "ink";
import { type AbiEntry, saveContract } from "@dotdm/contracts";
import { ALICE_SS58 } from "@dotdm/utils";
import { InstallTable } from "./components/InstallTable";

export type InstallState = "waiting" | "querying" | "fetching" | "done" | "error";

export interface InstallStatus {
    library: string;
    state: InstallState;
    error?: string;
    version?: number;
    address?: string;
    metadataCid?: string;
    savedPath?: string;
}

export interface InstallResult {
    targetHash: string;
    library: string;
    version: number;
    address: string;
    abi: AbiEntry[];
    savedPath: string;
    metadataCid: string;
}

export interface InstallRunnerOptions {
    libraries: { library: string; requestedVersion: number | "latest" }[];
    registry: any;
    ipfs: any;
    targetHash: string;
    ipfsGatewayUrl?: string;
}

function isRegistryQueryError(err: unknown): boolean {
    const msg = err instanceof Error ? err.message : String(err);
    return msg.includes("zero data") || msg.includes("0x") || msg.includes("AbiDecoding");
}

function updateStatus(
    statuses: Map<string, InstallStatus>,
    library: string,
    state: InstallState,
    extra?: Partial<InstallStatus>,
): void {
    const current = statuses.get(library)!;
    statuses.set(library, { ...current, state, ...extra });
}

async function installOneWithStatus(
    library: string,
    requestedVersion: number | "latest",
    registry: any,
    ipfs: any,
    targetHash: string,
    statuses: Map<string, InstallStatus>,
): Promise<InstallResult> {
    // Phase 1: Query registry
    updateStatus(statuses, library, "querying");

    let version: number;
    let metadataCid: string;
    let contractAddress: string;

    if (requestedVersion === "latest") {
        let versionResult;
        try {
            versionResult = await registry.query("getVersionCount", {
                origin: ALICE_SS58,
                data: { contract_name: library },
            });
        } catch (err) {
            if (isRegistryQueryError(err)) {
                throw new Error(`Contract "${library}" not found in registry`);
            }
            throw err;
        }
        if (!versionResult.success || versionResult.value.response === 0) {
            throw new Error(`Contract "${library}" not found in registry`);
        }
        version = versionResult.value.response - 1;

        let metaResult;
        try {
            metaResult = await registry.query("getMetadataUri", {
                origin: ALICE_SS58,
                data: { contract_name: library },
            });
        } catch (err) {
            if (isRegistryQueryError(err)) {
                throw new Error(`Failed to fetch metadata for "${library}" from registry`);
            }
            throw err;
        }
        if (!metaResult.success) {
            throw new Error(`Failed to query metadata URI for "${library}"`);
        }
        const metaResponse = metaResult.value.response;
        metadataCid =
            typeof metaResponse === "string"
                ? metaResponse
                : metaResponse?.isSome
                  ? metaResponse.value
                  : "";
        if (!metadataCid) {
            throw new Error(`No metadata URI found for "${library}"`);
        }

        let addrResult;
        try {
            addrResult = await registry.query("getAddress", {
                origin: ALICE_SS58,
                data: { contract_name: library },
            });
        } catch (err) {
            if (isRegistryQueryError(err)) {
                throw new Error(`Failed to fetch address for "${library}" from registry`);
            }
            throw err;
        }
        const addrResponse = addrResult.success ? addrResult.value.response : null;
        contractAddress =
            typeof addrResponse === "string"
                ? addrResponse
                : addrResponse?.isSome
                  ? addrResponse.value
                  : "";
    } else {
        version = requestedVersion;

        let metaResult;
        try {
            metaResult = await registry.query("getMetadataUriAtVersion", {
                origin: ALICE_SS58,
                data: { contract_name: library, version: requestedVersion },
            });
        } catch (err) {
            if (isRegistryQueryError(err)) {
                throw new Error(
                    `Version ${requestedVersion} of "${library}" not found in registry`,
                );
            }
            throw err;
        }
        if (!metaResult.success) {
            throw new Error(
                `Failed to query metadata URI for "${library}" version ${requestedVersion}`,
            );
        }
        const metaResponse = metaResult.value.response;
        metadataCid =
            typeof metaResponse === "string"
                ? metaResponse
                : metaResponse?.isSome
                  ? metaResponse.value
                  : "";
        if (!metadataCid) {
            throw new Error(`Version ${requestedVersion} of "${library}" not found in registry`);
        }

        let addrResult;
        try {
            addrResult = await registry.query("getAddressAtVersion", {
                origin: ALICE_SS58,
                data: { contract_name: library, version: requestedVersion },
            });
        } catch (err) {
            if (isRegistryQueryError(err)) {
                throw new Error(
                    `Failed to fetch address for "${library}" version ${requestedVersion} from registry`,
                );
            }
            throw err;
        }
        const addrResponse = addrResult.success ? addrResult.value.response : null;
        contractAddress =
            typeof addrResponse === "string"
                ? addrResponse
                : addrResponse?.isSome
                  ? addrResponse.value
                  : "";
    }

    updateStatus(statuses, library, "fetching", {
        version,
        address: contractAddress,
        metadataCid,
    });

    // Phase 2: Fetch metadata from IPFS
    const metadata = (await (await ipfs.fetch(metadataCid)).json()) as Record<string, unknown>;

    const abi = metadata.abi;
    if (!abi || !Array.isArray(abi) || abi.length === 0) {
        throw new Error(`No ABI found in metadata for "${library}"`);
    }

    // Save to disk
    const savedPath = saveContract({
        targetHash,
        library,
        version,
        abi,
        metadata,
        address: contractAddress,
        metadataCid,
    });

    updateStatus(statuses, library, "done", { savedPath });

    return {
        targetHash,
        library,
        version,
        address: contractAddress,
        abi: abi as AbiEntry[],
        savedPath,
        metadataCid,
    };
}

export interface InstallRunnerResult {
    results: InstallResult[];
    errors: { library: string; error: string }[];
    success: boolean;
}

export async function runInstallWithUI(opts: InstallRunnerOptions): Promise<InstallRunnerResult> {
    const libraryNames = opts.libraries.map((l) => l.library);

    // Initialize statuses
    const statuses = new Map<string, InstallStatus>();
    for (const { library } of opts.libraries) {
        statuses.set(library, { library, state: "waiting" });
    }

    // Render Ink UI
    const app = render(
        React.createElement(InstallTable, {
            statuses,
            libraries: libraryNames,
            ipfsGatewayUrl: opts.ipfsGatewayUrl,
        }),
    );

    // Run all installs in parallel
    const settled = await Promise.allSettled(
        opts.libraries.map(({ library, requestedVersion }) =>
            installOneWithStatus(
                library,
                requestedVersion,
                opts.registry,
                opts.ipfs,
                opts.targetHash,
                statuses,
            ).catch((err) => {
                updateStatus(statuses, library, "error", {
                    error: err instanceof Error ? err.message : String(err),
                });
                throw err;
            }),
        ),
    );

    // Brief delay for final render
    await new Promise((r) => setTimeout(r, 200));
    app.unmount();

    // Collect results and errors
    const results: InstallResult[] = [];
    const errors: { library: string; error: string }[] = [];

    for (let i = 0; i < settled.length; i++) {
        const result = settled[i];
        if (result.status === "fulfilled") {
            results.push(result.value);
        } else {
            errors.push({
                library: opts.libraries[i].library,
                error:
                    result.reason instanceof Error ? result.reason.message : String(result.reason),
            });
        }
    }

    return { results, errors, success: errors.length === 0 };
}
