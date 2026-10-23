import { createClient } from "polkadot-api";
import { getWsProvider } from "polkadot-api/ws";
import type { ChainDefinition, PolkadotClient, HexString } from "polkadot-api";
import {
    ContractManager,
    createContractRuntimeFromClient,
    type CdmJson as ProductSdkCdmJson,
} from "@parity/product-sdk-contracts";
import { paseo_asset_hub } from "@parity/product-sdk-descriptors/paseo-asset-hub";
import type { CdmJson, CdmJsonContract } from "@parity/cdm-builder";
import { prepareSigner } from "@parity/cdm-env";
import { wrapContract, type CallDefaults } from "./wrap";
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
    private defaults: CallDefaults;
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

        // No origin unless given explicitly: it then follows the signer (see
        // `CdmOptions`), so the Alice fallback signer also means Alice's origin.
        this.defaults = {
            origin: options?.defaultOrigin,
            signer: options?.defaultSigner ?? prepareSigner("Alice"),
        };
    }

    /**
     * Update the defaults used by every contract handle, including existing
     * ones. Only the fields given change: an explicitly set origin (here or
     * via `defaultOrigin`) is kept when only the signer changes; without one,
     * the origin follows the new signer. See {@link CdmOptions}.
     */
    setDefaults(defaults: CdmDefaults): void {
        if (defaults.origin !== undefined) this.defaults.origin = defaults.origin;
        if (defaults.signer !== undefined) this.defaults.signer = defaults.signer;
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
            // JSON on disk, so this is a type-only bridge. No manager defaults:
            // the wrapper passes signer and origin on every call.
            this._manager = new ContractManager(
                this.cdmJson as unknown as ProductSdkCdmJson,
                runtime,
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

        return wrapContract(contract, data.abi as AbiEntry[], () => this.defaults) as CdmContract<
            CdmContracts[K]
        >;
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
