import { readFileSync, existsSync, realpathSync } from "fs";
import { resolve } from "path";
import { getCdmRoot, getContractDir, resolveContractAbiPath } from "@parity/cdm-builder";
import type { ResolvedContract, AbiEntry } from "./types";

export function resolveContract(library: string, version: string): ResolvedContract {
    // If version is "latest", resolve the symlink to its semver directory
    let resolvedVersion: string;
    if (version === "latest") {
        const latestLink = resolve(getCdmRoot(), "contracts", library, "latest");
        if (!existsSync(latestLink)) {
            throw new Error(`No "latest" symlink found for ${library}`);
        }
        resolvedVersion = realpathSync(latestLink).split("/").pop()!;
    } else {
        resolvedVersion = version;
    }

    const contractDir = getContractDir(library, resolvedVersion);
    if (!existsSync(contractDir)) {
        throw new Error(`Contract ${library}@${resolvedVersion} not found in ${contractDir}`);
    }

    const infoPath = resolve(contractDir, "info.json");
    const info = JSON.parse(readFileSync(infoPath, "utf-8"));

    const abiPath = resolveContractAbiPath(library, resolvedVersion);
    const abi: AbiEntry[] = JSON.parse(readFileSync(abiPath, "utf-8"));

    return {
        name: info.name,
        address: info.address,
        abi,
        abiPath,
        version: info.version,
        metadataCid: info.metadataCid,
    };
}
