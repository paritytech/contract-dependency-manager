# Registry Migration Scripts

Export a registry snapshot:

```sh
pnpm --filter @parity/cdm-migrations export -- -n paseo \
  --registry-address 0x... \
  --out registry-migration.json
```

Import a snapshot into a fresh registry:

```sh
pnpm --filter @parity/cdm-migrations import -- -n paseo \
  --registry-address 0x... \
  --suri "..." \
  --in registry-migration.json \
  --batch-size 10
```

Deploy a fresh registry and migrate the old registry into it in one command:

```sh
make deploy-registry CHAIN=paseo \
  MIGRATE_FROM_REGISTRY=0x... \
  MIGRATION_JSON=dist/paseo-registry-migration.json \
  MIGRATION_BATCH_SIZE=10
```

When `MIGRATION_JSON` is omitted, the deploy script writes the exported snapshot
to `dist/registry-migration-<chain>-<timestamp>.json`.

The JSON shape matches the contract's `adminImportContracts` input:

```json
{
  "contract_name": "@scope/name",
  "owner": "0x...",
  "versions": [
    { "address": "0x...", "metadata_uri": "ipfs://..." }
  ]
}
```
