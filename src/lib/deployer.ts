import {
    PolkadotClient,
    TypedApi,
    Binary,
    Enum,
} from "polkadot-api";
import { AssetHub, Bulletin, contracts } from "@polkadot-api/descriptors";
import { createInkSdk } from "@polkadot-api/sdk-ink";
import { readFileSync } from "fs";
import { resolve } from "path";
import { execSync, spawn } from "child_process";
import { CID } from "multiformats/cid";
import { prepareSigner } from "./signer.js";
import { ALICE_SS58, GAS_LIMIT, STORAGE_DEPOSIT_LIMIT } from "../constants.js";

function getRegistryContract(client: PolkadotClient, addr: string) {
    const inkSdk = createInkSdk(client);
    return inkSdk.getContract(contracts.contractsRegistry, addr);
}

type RegistryContract = ReturnType<typeof getRegistryContract>;

export interface AbiParam {
    name: string;
    type: string;
    components?: AbiParam[];
}

export interface AbiEntry {
    type: string;
    name?: string;
    inputs: AbiParam[];
    outputs?: AbiParam[];
    stateMutability?: string;
    anonymous?: boolean;
}

export interface Metadata {
    publish_block: number;
    published_at: string;
    description: string;
    readme: string;
    authors: string[];
    homepage: string;
    repository: string;
    abi: AbiEntry[];
}

export interface BuildResult {
    crateName: string;
    success: boolean;
    stdout: string;
    stderr: string;
    durationMs: number;
}

export type BuildProgressCallback = (processed: number, total: number, currentCrate: string) => void;

export class ContractDeployer {
    public signer: ReturnType<typeof prepareSigner>;
    public api!: TypedApi<AssetHub>;
    public client!: PolkadotClient;
    public registry!: RegistryContract;
    public lastDeployedAddr: string | null = null;
    public bulletinApi!: TypedApi<Bulletin>;
    public bulletinClient!: PolkadotClient;

    constructor(signerName: string = "Alice") {
        this.signer = prepareSigner(signerName);
    }

    setConnection(client: PolkadotClient, api: TypedApi<AssetHub>) {
        this.client = client;
        this.api = api;
    }

    setBulletinConnection(client: PolkadotClient, api: TypedApi<Bulletin>) {
        this.bulletinClient = client;
        this.bulletinApi = api;
    }

    async publishMetadata(metadata: Metadata): Promise<{ cid: string; blockNumber: number }> {
        metadata.published_at = new Date().toISOString();
        const jsonString = JSON.stringify(metadata);
        const data = Binary.fromText(jsonString);

        const result = await this.bulletinApi.tx.TransactionStorage.store({
            data,
        }).signAndSubmit(this.signer);

        const storedEvents =
            this.bulletinApi.event.TransactionStorage.Stored.filter(
                result.events,
            );
        if (storedEvents.length === 0) {
            throw new Error(
                "Metadata publishing failed - no Stored event found",
            );
        }

        const { cid: cidBytes } = storedEvents[0];
        if (!cidBytes) {
            throw new Error(
                "Metadata publishing failed - no CID in Stored event",
            );
        }

        // cidBytes is a Binary (Vec<u8> from the chain) containing serialized CIDv1
        const cid = CID.decode(cidBytes.asBytes());
        return { cid: cid.toString(), blockNumber: result.block.number };
    }

    setRegistry(registryAddress: string) {
        this.registry = getRegistryContract(this.client, registryAddress);
    }

    /**
     * Register a contract in the contracts registry via ink SDK.
     */
    async register(
        cdmPackage: string,
        contractAddr?: string,
        metadataUri: string = "",
    ): Promise<void> {
        const addr = contractAddr ?? this.lastDeployedAddr;
        if (!addr) {
            throw new Error(
                "No contract address provided and no lastDeployedAddr set.",
            );
        }

        await this.registry
            .send("publishLatest", {
                data: {
                    contract_name: cdmPackage,
                    contract_address: addr,
                    metadata_uri: metadataUri,
                },
                gasLimit: {
                    ref_time: GAS_LIMIT.refTime,
                    proof_size: GAS_LIMIT.proofSize,
                },
                storageDepositLimit: STORAGE_DEPOSIT_LIMIT,
            })
            .signAndSubmit(this.signer);

        console.log(`  Registered ${cdmPackage} -> ${addr}`);
    }

    /**
     * Deploy a PVM contract and return its address.
     * Uses a dry-run to estimate gas, then submits with the estimated values.
     */
    async deploy(pvmPath: string): Promise<string> {
        const bytecode = readFileSync(pvmPath);
        const code = Binary.fromBytes(bytecode);
        const data = Binary.fromBytes(new Uint8Array(0));

        // Dry-run to estimate gas requirements
        const dryRun = await this.api.apis.ReviveApi.instantiate(
            ALICE_SS58,
            0n,
            undefined, // unlimited gas for estimation
            undefined, // unlimited storage deposit for estimation
            Enum("Upload", code),
            data,
            undefined, // salt
        );

        if (dryRun.result.success === false) {
            const stringify = (obj: unknown) =>
                JSON.stringify(
                    obj,
                    (_, v) => (typeof v === "bigint" ? v.toString() : v),
                    2,
                );
            console.error("Dry-run failed:", stringify(dryRun.result));
            throw new Error("Contract instantiation dry-run failed");
        }

        // Use weight_required from dry-run with 20% headroom
        const gasLimit = {
            ref_time: dryRun.weight_required.ref_time * 120n / 100n,
            proof_size: dryRun.weight_required.proof_size * 120n / 100n,
        };

        // Derive storage deposit from dry-run
        let storageDeposit = STORAGE_DEPOSIT_LIMIT;
        if (dryRun.storage_deposit.type === "Charge") {
            storageDeposit = dryRun.storage_deposit.value * 120n / 100n;
        }

        const result = await this.api.tx.Revive.instantiate_with_code({
            value: 0n,
            weight_limit: gasLimit,
            storage_deposit_limit: storageDeposit,
            code,
            data,
            salt: undefined,
        }).signAndSubmit(this.signer);

        const failures = this.api.event.System.ExtrinsicFailed.filter(
            result.events,
        );
        if (failures.length > 0) {
            const stringify = (obj: unknown) =>
                JSON.stringify(
                    obj,
                    (_, v) => (typeof v === "bigint" ? v.toString() : v),
                    2,
                );
            console.error("Transaction failed:", stringify(failures[0]));
            throw new Error("Deployment transaction failed");
        }

        const instantiated = this.api.event.Revive.Instantiated.filter(
            result.events,
        );
        if (instantiated.length === 0) {
            throw new Error(
                "Contract instantiation failed - no Instantiated event",
            );
        }

        this.lastDeployedAddr = instantiated[0].contract.asHex();
        return this.lastDeployedAddr;
    }
}

/**
 * Build a single contract using `cargo pvm-contract build`.
 */
export function pvmContractBuild(
    rootDir: string,
    crateName: string,
    registryAddr?: string,
): void {
    const manifestPath = resolve(rootDir, "Cargo.toml");
    const cmd = `cargo pvm-contract build --manifest-path ${manifestPath} -p ${crateName}`;
    const env: Record<string, string> = {
        ...(process.env as Record<string, string>),
    };
    if (registryAddr) {
        env.CONTRACTS_REGISTRY_ADDR = registryAddr;
    }
    execSync(cmd, { cwd: rootDir, stdio: "inherit", env });
}

/**
 * Build a single contract asynchronously with progress tracking.
 */
export async function pvmContractBuildAsync(
    rootDir: string,
    crateName: string,
    registryAddr?: string,
    onProgress?: BuildProgressCallback,
): Promise<BuildResult> {
    const manifestPath = resolve(rootDir, "Cargo.toml");

    return new Promise((done) => {
        const startTime = Date.now();
        const args = [
            "pvm-contract", "build",
            "--manifest-path", manifestPath,
            "-p", crateName,
            "--message-format", "json",
        ];
        const env: Record<string, string> = {
            ...(process.env as Record<string, string>),
        };
        if (registryAddr) {
            env.CONTRACTS_REGISTRY_ADDR = registryAddr;
        }

        const child = spawn("cargo", args, {
            cwd: rootDir,
            env,
            stdio: ["pipe", "pipe", "pipe"],
        });

        let stdout = "";
        let stderr = "";
        let artifactsSeen = 0;
        let total = 0;

        child.stdout.on("data", (data: Buffer) => {
            const text = data.toString();
            stdout += text;

            for (const line of text.split("\n")) {
                const trimmed = line.trim();
                if (!trimmed) continue;
                try {
                    const msg = JSON.parse(trimmed);
                    if (msg.reason === "build-plan") {
                        // Emitted by cargo-pvm-contract before build starts
                        total = msg.total ?? 0;
                    } else if (msg.reason === "compiler-artifact") {
                        artifactsSeen++;
                        const name = msg.target?.name ?? "unknown";
                        onProgress?.(artifactsSeen, total, name);
                    }
                } catch {
                    // Not JSON, ignore
                }
            }
        });

        child.stderr.on("data", (data: Buffer) => {
            const text = data.toString();
            stderr += text;
        });

        child.on("close", (code) => {
            done({
                crateName,
                success: code === 0,
                stdout,
                stderr,
                durationMs: Date.now() - startTime,
            });
        });

        child.on("error", (err) => {
            done({
                crateName,
                success: false,
                stdout,
                stderr: stderr + "\n" + err.message,
                durationMs: Date.now() - startTime,
            });
        });
    });
}
