import { PolkadotClient, TypedApi, SS58String } from "polkadot-api";
import type { AssetHub } from "@dotdm/env";
import { createInkSdk } from "@polkadot-api/sdk-ink";
import { prepareSigner } from "@dotdm/env";
import { stringifyBigInt, GAS_LIMIT, STORAGE_DEPOSIT_LIMIT } from "@dotdm/utils";
import { REGISTRY_ABI } from "./registry-abi";

export function getRegistryContract(client: PolkadotClient, addr: string) {
    const inkSdk = createInkSdk(client);
    return inkSdk.getContract({ abi: REGISTRY_ABI } as any, addr);
}

export type RegistryContract = ReturnType<typeof getRegistryContract>;
type RegisterEntry = { cdmPackage: string; contractAddr: string; metadataUri: string };

export class RegistryManager {
    public signer: ReturnType<typeof prepareSigner>;
    public origin: SS58String;
    public api: TypedApi<AssetHub>;
    public client: PolkadotClient;
    public registry: RegistryContract;

    constructor(
        signer: ReturnType<typeof prepareSigner>,
        origin: SS58String,
        api: TypedApi<AssetHub>,
        client: PolkadotClient,
        registryAddress: string,
    ) {
        this.signer = signer;
        this.origin = origin;
        this.api = api;
        this.client = client;
        this.registry = getRegistryContract(client, registryAddress);
    }

    async register(
        cdmPackage: string,
        contractAddr: string,
        metadataUri: string = "",
    ): Promise<{ txHash: string; blockHash: string }> {
        return this.registerBatch([{ cdmPackage, contractAddr, metadataUri }]);
    }

    async registerBatch(entries: RegisterEntry[]): Promise<{ txHash: string; blockHash: string }> {
        if (entries.length === 0) return { txHash: "", blockHash: "" };

        const mapped = entries.map((e) => ({
            pkg: e.cdmPackage,
            data: {
                contract_name: e.cdmPackage,
                contract_address: e.contractAddr,
                metadata_uri: e.metadataUri,
            },
        }));
        const sendOpts = {
            gasLimit: { ref_time: GAS_LIMIT.refTime, proof_size: GAS_LIMIT.proofSize },
            storageDepositLimit: STORAGE_DEPOSIT_LIMIT,
        };

        // Dry-run all entries in parallel with submission
        const dryRun = Promise.all(
            mapped.map((m) =>
                this.registry.query("publishLatest", { origin: this.origin, data: m.data }).then(
                    (r) => {
                        if (!r.success)
                            throw new Error(
                                `Registry rejected "${m.pkg}": not the owner of this contract name`,
                            );
                    },
                    (err) => {
                        throw new Error(`Registry will revert for "${m.pkg}": ${err}`);
                    },
                ),
            ),
        );

        // Submit: single call or batch_all
        let submit: Promise<any>;
        if (mapped.length === 1) {
            submit = this.registry
                .send("publishLatest", { data: mapped[0].data, ...sendOpts })
                .signAndSubmit(this.signer);
        } else {
            const txs = mapped.map((m) =>
                this.registry.send("publishLatest", { data: m.data, ...sendOpts }),
            );
            const calls = await Promise.all(
                txs.map(async (tx) => {
                    const call = tx.decodedCall;
                    return call instanceof Promise ? await call : call;
                }),
            );
            submit = this.api.tx.Utility.batch_all({ calls }).signAndSubmit(this.signer);
        }

        // Race: dry-run failure exits early with better error
        const result = await new Promise<any>((resolve, reject) => {
            dryRun.catch(reject);
            submit.then(resolve, async (err) => {
                try {
                    await dryRun;
                    reject(err);
                } catch (e) {
                    reject(e);
                }
            });
        });

        const failures = this.api.event.System.ExtrinsicFailed.filter(result.events);
        if (failures.length > 0) {
            await dryRun.catch((e) => {
                throw e;
            });
            throw new Error(`Register failed: ${stringifyBigInt(failures[0])}`);
        }

        return { txHash: result.txHash, blockHash: result.block.hash };
    }
}
