import type { InkDescriptors } from 'polkadot-api/ink';
import type { Enum } from 'polkadot-api';
type StorageDescriptor = {};
type MessagesDescriptor = {
    "readCount": {
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
