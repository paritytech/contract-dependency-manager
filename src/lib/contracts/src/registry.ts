import type { HexString, PolkadotClient, SS58String, TypedApi } from "polkadot-api";
import type { AssetHub } from "@dotdm/descriptors";
import { contracts } from "@dotdm/descriptors";
import { createInkSdk } from "@polkadot-api/sdk-ink";
import { createContract, type AbiEntry, type Contract } from "@polkadot-apps/contracts";
import { batchSubmitAndWatch, type BatchApi } from "@polkadot-apps/tx";
import type { prepareSigner } from "@dotdm/env";
import { GAS_LIMIT, STORAGE_DEPOSIT_LIMIT } from "@dotdm/utils";

/**
 * Runtime shape of `contracts.contractsRegistry` from `@dotdm/descriptors` —
 * InkDescriptors carries the raw ABI on `.abi`. Read it once so both the
 * `@polkadot-apps/contracts` `Contract` handle (for reads) and the
 * `@polkadot-api/sdk-ink` path (for batching writes) share one source of truth.
 */
const registryAbi = (contracts.contractsRegistry as unknown as { abi: AbiEntry[] }).abi;

export function getRegistryContract(client: PolkadotClient, addr: string) {
    const inkSdk = createInkSdk(client);
    return inkSdk.getContract(contracts.contractsRegistry, addr);
}

export type RegistryContract = ReturnType<typeof getRegistryContract>;
type RegisterEntry = { cdmPackage: string; contractAddr: string; metadataUri: string };

/**
 * Thin wrapper around `@polkadot-apps/contracts` for the on-chain
 * `ContractRegistry`, plus `@polkadot-apps/tx` `batchSubmitAndWatch` for
 * multi-register batches.
 *
 * Kept as a class with the original surface so downstream callers
 * (deploy-pipeline.ts) don't need to change in this migration step.
 * Later steps will collapse this into free functions.
 *
 * Gap flagged for `@polkadot-apps/contracts`: the `Contract.method.tx()` API
 * submits immediately and does not expose a way to obtain the underlying
 * decoded call for batching. For `registerBatch` we therefore drop down to
 * `@polkadot-api/sdk-ink` (`registry.send(...)`) to build the ink txs and
 * pass them to `batchSubmitAndWatch` — matching the previous implementation
 * semantically (atomic `Utility.batch_all` on AssetHub).
 */
export class RegistryManager {
    public signer: ReturnType<typeof prepareSigner>;
    public origin: SS58String;
    public api: TypedApi<AssetHub>;
    public client: PolkadotClient;
    public registry: RegistryContract;
    private contract: Contract<any>;

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
        // sdk-ink path retained for `registerBatch` (see gap note above).
        this.registry = getRegistryContract(client, registryAddress);
        // Shared sdk-ink instance for the `@polkadot-apps/contracts` Contract.
        const inkSdk = createInkSdk(client);
        this.contract = createContract(inkSdk, registryAddress as HexString, registryAbi, {
            defaultSigner: signer,
            defaultOrigin: origin,
        });
    }

    async register(
        cdmPackage: string,
        contractAddr: string,
        metadataUri: string = "",
    ): Promise<{ txHash: string; blockHash: string }> {
        return this.registerBatch([{ cdmPackage, contractAddr, metadataUri }]);
    }

    /**
     * Query the registry for the currently registered address of a CDM package.
     * Returns null if the package is not registered or the query fails.
     */
    async getAddress(cdmPackage: string): Promise<string | null> {
        try {
            const result = await this.contract.getAddress.query(cdmPackage);
            if (!result.success) return null;
            const response = result.value as { isSome?: boolean; value?: string } | string | null;
            if (response && typeof response === "object" && "value" in response) {
                return response.value ?? null;
            }
            if (typeof response === "string") return response;
            return null;
        } catch {
            return null;
        }
    }

    /**
     * Query the registry for addresses of multiple CDM packages in parallel.
     */
    async getAddressBatch(cdmPackages: string[]): Promise<Map<string, string | null>> {
        const results = await Promise.all(
            cdmPackages.map(async (pkg) => [pkg, await this.getAddress(pkg)] as const),
        );
        return new Map(results);
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

        // Dry-run all entries in parallel with submission for early owner-check feedback.
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

        // Build ink txs (AsyncTransactions) and batch via `@polkadot-apps/tx`.
        // `batchSubmitAndWatch` resolves each call's `.waited` and wraps in
        // `Utility.batch_all` by default.
        const inkTxs = mapped.map((m) =>
            this.registry.send("publishLatest", { data: m.data, ...sendOpts }),
        );

        const submit = batchSubmitAndWatch(inkTxs, this.api as unknown as BatchApi, this.signer, {
            mode: "batch_all",
            waitFor: "best-block",
        });

        // Race: dry-run failure exits early with a better error message.
        const result = await new Promise<Awaited<typeof submit>>((resolve, reject) => {
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

        if (!result.ok) {
            // Surface the dry-run error if it was the root cause, else the
            // dispatch error from the batch.
            await dryRun.catch((e) => {
                throw e;
            });
            throw new Error(
                `Register failed: ${JSON.stringify(result.dispatchError ?? "unknown dispatch error")}`,
            );
        }

        return { txHash: result.txHash, blockHash: result.block.hash };
    }
}
