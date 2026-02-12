import type { InkDescriptors } from 'polkadot-api/ink';
import type { HexString, Enum } from 'polkadot-api';
type Address = HexString;
type StorageDescriptor = {};
type MessagesDescriptor = {
    "publishLatest": {
        message: {
            "contract_name": string;
            "contract_address": Address;
            "metadata_uri": string;
        };
        response: {};
    };
    "getAddress": {
        message: {
            "contract_name": string;
        };
        response: Address;
    };
    "getMetadataUri": {
        message: {
            "contract_name": string;
        };
        response: string;
    };
    "getContractCount": {
        message: {};
        response: number;
    };
};
type ConstructorsDescriptor = {
    "new": {
        message: {};
        response: {};
    };
};
type EventDescriptor = Enum<{}>;
export declare const descriptor: InkDescriptors<StorageDescriptor, MessagesDescriptor, ConstructorsDescriptor, EventDescriptor>;
export {};
