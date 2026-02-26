import { createClient } from "polkadot-api";
import { getWsProvider } from "polkadot-api/ws-provider";
import { withPolkadotSdkCompat } from "polkadot-api/polkadot-sdk-compat";
import { createInkSdk } from "@polkadot-api/sdk-ink";
import type { PolkadotClient, SS58String, PolkadotSigner, HexString } from "polkadot-api";
import type { InkSdk } from "@polkadot-api/sdk-ink";
import { readCdmJson } from "@dotdm/contracts";
import type { CdmJson } from "@dotdm/contracts";
import { prepareSigner } from "@dotdm/env";
import { ALICE_SS58 } from "@dotdm/utils";
import { resolveContract } from "./resolver";
import { wrapContract } from "./wrap";
import type { CdmContract, CdmContracts, CdmOptions } from "./types";

export class Cdm {
    private cdmJson: CdmJson;
    private cdmJsonPath: string;
    private targetHash: string;
    private _client: PolkadotClient | null = null;
    private _inkSdk: InkSdk | null = null;
    private ownsClient: boolean = false;
    private defaultOrigin?: SS58String;
    private defaultSigner?: PolkadotSigner;

    constructor(options?: CdmOptions) {
        // Read cdm.json
        const result = readCdmJson(options?.cdmJsonPath);
        if (!result) {
            throw new Error("cdm.json not found. Run 'cdm install' first.");
        }
        this.cdmJson = result.cdmJson;
        this.cdmJsonPath = result.cdmJsonPath;

        // Determine target hash
        if (options?.targetHash) {
            this.targetHash = options.targetHash;
        } else {
            // Use first target in cdm.json
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

    getContract<K extends string & keyof CdmContracts>(library: K): CdmContract<CdmContracts[K]> {
        const deps = this.cdmJson.dependencies[this.targetHash];
        if (!deps || !(library in deps)) {
            throw new Error(
                `Contract "${library}" not found in cdm.json dependencies for target ${this.targetHash}`,
            );
        }
        const version = deps[library];

        const resolved = resolveContract(this.targetHash, library, version);
        const descriptor = { abi: resolved.abi };
        const papiContract = this.inkSdk.getContract(
            descriptor as any,
            resolved.address as HexString,
        );

        return wrapContract(papiContract, resolved.abi, {
            origin: this.defaultOrigin,
            signer: this.defaultSigner,
        }) as CdmContract<CdmContracts[K]>;
    }

    getAddress(library: string): HexString {
        const deps = this.cdmJson.dependencies[this.targetHash];
        if (!deps || !(library in deps)) {
            throw new Error(`Contract "${library}" not found in cdm.json dependencies`);
        }
        const version = deps[library];
        const resolved = resolveContract(this.targetHash, library, version);
        return resolved.address as HexString;
    }

    destroy(): void {
        if (this.ownsClient && this._client) {
            this._client.destroy();
            this._client = null;
        }
        this._inkSdk = null;
    }
}

export function createCdm(options?: CdmOptions): Cdm {
    return new Cdm(options);
}
