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
pnpm deploy:registry -- --name paseo \
  --migrate-from-registry 0x... \
  --migration-json dist/paseo-registry-migration.json \
  --migration-batch-size 10
```

When `MIGRATION_JSON` is omitted, the deploy script writes the exported snapshot
to `dist/registry-migration-<chain>-<timestamp>.json`.

Each snapshot entry carries the name's per-name proxy and its version rows
(packed semver `versionKey` as a decimal string, implementation `target`,
`metadataUri`):

```json
{
  "contract_name": "@scope/name",
  "owner": "0x...",
  "proxy": "0x...",
  "versions": [
    { "versionKey": "18446744073709551617", "target": "0x...", "metadataUri": "ipfs://..." }
  ]
}
```
