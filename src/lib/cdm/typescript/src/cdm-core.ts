import { createClient } from "polkadot-api";
import { getWsProvider } from "polkadot-api/ws";
import { createInkSdk } from "@polkadot-api/sdk-ink";
import type { PolkadotClient, SS58String, HexString } from "polkadot-api";
import type { InkSdk } from "@polkadot-api/sdk-ink";
import type { CdmJson, CdmJsonContract } from "@parity/cdm-builder";
import { ALICE_SS58 } from "@parity/cdm-utils";
import { prepareSigner } from "@parity/cdm-env";
import { wrapContract } from "./wrap";
import type { CdmContract, CdmContracts, CdmDefaults, CdmOptions } from "./types";

export class Cdm {
    private cdmJson: CdmJson;
    private _client: PolkadotClient | null = null;
    private _inkSdk: InkSdk | null = null;
    private ownsClient: boolean = false;
    private defaults: CdmDefaults;

    constructor(cdmJson: CdmJson, options?: CdmOptions) {
        this.cdmJson = cdmJson;

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
    }

    get client(): PolkadotClient {
        if (!this._client) {
            throw new Error("No client configured. Pass options.client or options.assethubUrl.");
        }
        return this._client;
    }

    get inkSdk(): InkSdk {
        if (!this._inkSdk) {
            this._inkSdk = createInkSdk(this.client);
        }
        return this._inkSdk;
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
        const descriptor = { abi: data.abi };
        const papiContract = this.inkSdk.getContract(descriptor as any, data.address as HexString);

        return wrapContract(papiContract, data.abi as any, this.defaults) as CdmContract<
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
        this._inkSdk = null;
    }
}
