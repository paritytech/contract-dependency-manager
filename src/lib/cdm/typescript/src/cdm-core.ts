import { createClient } from "polkadot-api";
import { getWsProvider } from "polkadot-api/ws";
import type { ChainDefinition, PolkadotClient, SS58String, HexString } from "polkadot-api";
import {
    ContractManager,
    createContractRuntimeFromClient,
    type CdmJson as ProductSdkCdmJson,
} from "@parity/product-sdk-contracts";
import { paseo_asset_hub } from "@parity/product-sdk-descriptors/paseo-asset-hub";
import type { CdmJson, CdmJsonContract } from "@parity/cdm-builder";
import { ALICE_SS58 } from "@parity/cdm-utils";
import { prepareSigner } from "@parity/cdm-env";
import { wrapContract } from "./wrap";
import type { AbiEntry, CdmContract, CdmContracts, CdmDefaults, CdmOptions } from "./types";

/**
 * Block that contract dry-runs (`.query()` and the `.tx()` sizing dry-run)
 * read from. product-sdk defaults to `"best"`; CDM keeps finalized reads.
 */
const DRY_RUN_AT = "finalized";

export class Cdm {
    private cdmJson: CdmJson;
    private _client: PolkadotClient | null = null;
    private _manager: ContractManager | null = null;
    private ownsClient: boolean = false;
    private defaults: CdmDefaults;
    private descriptor: ChainDefinition;

    constructor(cdmJson: CdmJson, options?: CdmOptions) {
        this.cdmJson = cdmJson;
        this.descriptor = options?.descriptor ?? paseo_asset_hub;

        if (options?.client) {
            this._client = options.client;
            this.ownsClient = false;
        } else if (options?.assethubUrl) {
            this._client = createClient(getWsProvider(options.assethubUrl));
            this.ownsClient = true;
        }

        this.defaults = {
            origin: options?.defaultOrigin ?? (ALICE_SS58 as SS58String),
            signer: options?.defaultSigner ?? prepareSigner("Alice"),
        };
    }

    setDefaults(defaults: CdmDefaults): void {
        if (defaults.origin !== undefined) this.defaults.origin = defaults.origin;
        if (defaults.signer !== undefined) this.defaults.signer = defaults.signer;
        this._manager?.setDefaults({ origin: defaults.origin, signer: defaults.signer });
    }

    get client(): PolkadotClient {
        if (!this._client) {
            throw new Error("No client configured. Pass options.client or options.assethubUrl.");
        }
        return this._client;
    }

    private get manager(): ContractManager {
        if (!this._manager) {
            const runtime = createContractRuntimeFromClient(this.client, this.descriptor, {
                at: DRY_RUN_AT,
            });
            // cdm-builder's CdmJson types addresses as `string` and ABIs as
            // `unknown[]`; product-sdk wants `0x${string}` / `AbiEntry[]`. Same
            // JSON on disk, so this is a type-only bridge.
            this._manager = new ContractManager(
                this.cdmJson as unknown as ProductSdkCdmJson,
                runtime,
                {
                    defaultOrigin: this.defaults.origin,
                    defaultSigner: this.defaults.signer,
                },
            );
        }
        return this._manager;
    }

    private getContractData(library: string): CdmJsonContract {
        const contract = this.cdmJson.contracts?.[library];
        if (!contract) {
            throw new Error(`Contract "${library}" not found in cdm.json contracts`);
        }
        return contract;
    }

    getContract<K extends string & keyof CdmContracts>(library: K): CdmContract<CdmContracts[K]> {
        const data = this.getContractData(library);
        const contract = this.manager.getContract(library);

        return wrapContract(contract, data.abi as AbiEntry[]) as CdmContract<CdmContracts[K]>;
    }

    getAddress(library: string): HexString {
        const data = this.getContractData(library);
        return data.address as HexString;
    }

    destroy(): void {
        if (this.ownsClient && this._client) {
            this._client.destroy();
            this._client = null;
        }
        this._manager = null;
    }
}
