# Deploy CDM to a new environment

1. Clone repository

2. Setup: `pnpm install`

3. Deploy registry contract:
```
ASSET_HUB="wss://<some-asset-hub-websocket>" \
make deploy-registry
```

From the logs, take note of the address which registry was deployed to. This will be used in the next step.

4. Add new target to `src/lib/env/src/known_chains.ts`
```
    <environment name>: {
        assethubUrl: "wss://<some-asset-hub-websocket>",
        bulletinUrl: "wss://<some-bulletin-websocket>",
        ipfsGatewayUrl: "https://<some-ipfs-url>/ipfs",
        registryAddress: "0xaf4...,
    },
```

<<<<<<< Updated upstream
=======
<<<<<<< Updated upstream
5. Open a PR with the new target update.
=======
>>>>>>> Stashed changes
5. Open a PR with the new target update.

6. Deploy frontend:
```
BULLETIN_DEPLOY_ENV="<bulletin-deploy-environment>" src/lib/scripts/deploy-frontend.sh "<deployer-suri-or-mnemonic>"
```

<<<<<<< Updated upstream
7. Verify:
- Open `contracts.dot` in Polkadot Desktop or Polkadot Browser. You should see the Contract Registry site.
- Run `cdm i -n <environment name> <known package>`. It should resolve from the deployed registry.
=======
## Verify
- Open `contracts.dot` in Polkadot Desktop or Polkadot Browser. You should see the Contract Registry site.
- Run `cdm i -n <environment name> <known package>`. It should resolve from the deployed registry.
>>>>>>> Stashed changes
>>>>>>> Stashed changes
