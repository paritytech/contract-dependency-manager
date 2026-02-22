import { readFileSync, existsSync, realpathSync } from "fs";
import { resolve } from "path";
import { getCdmRoot, getContractDir, resolveContractAbiPath } from "@dotdm/contracts";
import type { ResolvedContract, AbiEntry } from "./types";

export function resolveContract(
    targetHash: string,
    library: string,
    version: number | "latest",
): ResolvedContract {
    // If version is "latest", resolve the symlink
    let resolvedVersion: number;
    if (version === "latest") {
        const latestLink = resolve(getCdmRoot(), targetHash, "contracts", library, "latest");
        if (!existsSync(latestLink)) {
            throw new Error(`No "latest" symlink found for ${library} in target ${targetHash}`);
        }
        const realPath = realpathSync(latestLink);
        resolvedVersion = parseInt(realPath.split("/").pop()!, 10);
    } else {
        resolvedVersion = version;
    }

    const contractDir = getContractDir(targetHash, library, resolvedVersion);
    if (!existsSync(contractDir)) {
        throw new Error(`Contract ${library}@${resolvedVersion} not found in ${contractDir}`);
    }

    const infoPath = resolve(contractDir, "info.json");
    const info = JSON.parse(readFileSync(infoPath, "utf-8"));

    const abiPath = resolveContractAbiPath(targetHash, library, resolvedVersion);
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
