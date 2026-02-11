import {
    PolkadotClient,
    TypedApi,
    Binary,
    FixedSizeBinary,
} from "polkadot-api";
import { AssetHub, contracts } from "@polkadot-api/descriptors";
import { createInkSdk } from "@polkadot-api/sdk-ink";
import { readFileSync } from "fs";
import { resolve } from "path";
import { execSync } from "child_process";
import { prepareSigner } from "./signer.js";
import { detectDeploymentOrder } from "./detection.js";
import { GAS_LIMIT, STORAGE_DEPOSIT_LIMIT } from "../constants.js";

function getRegistryContract(client: PolkadotClient, addr: string) {
    const inkSdk = createInkSdk(client);
    return inkSdk.getContract(contracts.contractsRegistry, addr);
}

type RegistryContract = ReturnType<typeof getRegistryContract>;

export class ContractDeployer {
    public signer: ReturnType<typeof prepareSigner>;
    public api!: TypedApi<AssetHub>;
    public client!: PolkadotClient;
    public registry!: RegistryContract;
    public lastDeployedAddr: string | null = null;

    constructor(signerName: string = "Alice") {
        this.signer = prepareSigner(signerName);
    }

    setConnection(client: PolkadotClient, api: TypedApi<AssetHub>) {
        this.client = client;
        this.api = api;
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
     */
    async deploy(pvmPath: string): Promise<string> {
        const bytecode = readFileSync(pvmPath);
        const code = Binary.fromBytes(bytecode);
        const data = Binary.fromBytes(new Uint8Array(0));

        const result = await this.api.tx.Revive.instantiate_with_code({
            value: 0n,
            weight_limit: {
                ref_time: GAS_LIMIT.refTime,
                proof_size: GAS_LIMIT.proofSize,
            },
            storage_deposit_limit: STORAGE_DEPOSIT_LIMIT,
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
 * Build all CDM contracts with the CONTRACTS_REGISTRY_ADDR set.
 */
export function buildAllContracts(rootDir: string, registryAddr: string): void {
    const order = detectDeploymentOrder(rootDir);
    console.log(
        `Building ${order.crateNames.length} contracts with CONTRACTS_REGISTRY_ADDR=${registryAddr}...`,
    );

    for (const crateName of order.crateNames) {
        console.log(`  Building ${crateName}...`);
        pvmContractBuild(rootDir, crateName, registryAddr);
    }
    console.log("Build complete.\n");
}

/**
 * Deploy all contracts (excluding registry) and register them.
 */
export async function deployAllContracts(
    deployer: ContractDeployer,
    rootDir: string,
): Promise<void> {
    const order = detectDeploymentOrder(rootDir);
    console.log(`Deploying ${order.crateNames.length} contracts...`);

    for (let i = 0; i < order.crateNames.length; i++) {
        const crateName = order.crateNames[i];
        const cdmPackage = order.cdmPackages[i];
        const pvmPath = resolve(rootDir, `target/${crateName}.release.polkavm`);

        const addr = await deployer.deploy(pvmPath);
        console.log(`  Deployed ${crateName} to: ${addr}`);

        if (cdmPackage) {
            await deployer.register(cdmPackage);
        }
    }
}
