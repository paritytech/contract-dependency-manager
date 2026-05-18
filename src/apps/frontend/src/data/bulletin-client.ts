import { BulletinClient, createLazySigner } from "@parity/product-sdk-bulletin";
import type { ProductSdkEnvironment } from "@dotdm/env/registry";
import { withTimeout } from "./timeout";

const clients = new Map<ProductSdkEnvironment, Promise<BulletinClient>>();

function getBulletinClient(environment: ProductSdkEnvironment): Promise<BulletinClient> {
    let client = clients.get(environment);
    if (!client) {
        client = BulletinClient.create({
            environment,
            signer: createLazySigner(() => null),
        });
        clients.set(environment, client);
    }
    return client;
}

export async function queryBulletinJson<T>(
    environment: ProductSdkEnvironment,
    cid: string,
): Promise<T> {
    const client = await getBulletinClient(environment);
    return withTimeout(
        client.fetchJson<T>(cid),
        `Bulletin metadata lookup timed out for CID ${cid}.`,
        30_000,
    );
}
