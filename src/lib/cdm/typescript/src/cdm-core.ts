import { createClient } from "polkadot-api";
import { getWsProvider } from "polkadot-api/ws-provider";
import { withPolkadotSdkCompat } from "polkadot-api/polkadot-sdk-compat";
import { createInkSdk } from "@polkadot-api/sdk-ink";
import type { PolkadotClient, SS58String, PolkadotSigner, HexString } from "polkadot-api";
import type { InkSdk } from "@polkadot-api/sdk-ink";
import type { CdmJson, CdmJsonContract } from "@dotdm/contracts";
import { ALICE_SS58 } from "@dotdm/utils";
import { prepareSigner } from "@dotdm/env";
import { wrapContract } from "./wrap";
import type { CdmContract, CdmContracts, CdmOptions } from "./types";

export class Cdm {
    private cdmJson: CdmJson;
    private targetHash: string;
    private _client: PolkadotClient | null = null;
    private _inkSdk: InkSdk | null = null;
    private ownsClient: boolean = false;
    private defaultOrigin?: SS58String;
    private defaultSigner?: PolkadotSigner;

    constructor(cdmJson: CdmJson, options?: CdmOptions) {
        this.cdmJson = cdmJson;

        // Determine target hash
        if (options?.targetHash) {
            this.targetHash = options.targetHash;
        } else {
            const targets = Object.keys(this.cdmJson.targets);
            if (targets.length === 0) throw new Error("No targets found in cdm.json");
            this.targetHash = targets[0];
        }

        if (options?.client) {
            this._client = options.client;
            this.ownsClient = false;
        }

        this.defaultOrigin = options?.defaultOrigin ?? (ALICE_SS58 as SS58String);
        this.defaultSigner = options?.defaultSigner ?? prepareSigner("Alice");
    }

    get client(): PolkadotClient {
        if (!this._client) {
            const target = this.cdmJson.targets[this.targetHash];
            if (!target) throw new Error(`Target ${this.targetHash} not found in cdm.json`);
            this._client = createClient(withPolkadotSdkCompat(getWsProvider(target["asset-hub"])));
            this.ownsClient = true;
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
        const contractsForTarget = this.cdmJson.contracts?.[this.targetHash];
        if (!contractsForTarget || !(library in contractsForTarget)) {
            throw new Error(
                `Contract "${library}" not found in cdm.json contracts for target ${this.targetHash}`,
            );
        }
        return contractsForTarget[library];
    }

    getContract<K extends string & keyof CdmContracts>(library: K): CdmContract<CdmContracts[K]> {
        const data = this.getContractData(library);
        const descriptor = { abi: data.abi };
        const papiContract = this.inkSdk.getContract(descriptor as any, data.address as HexString);

        return wrapContract(papiContract, data.abi as any, {
            origin: this.defaultOrigin,
            signer: this.defaultSigner,
        }) as CdmContract<CdmContracts[K]>;
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
