# Deploying Contract Dependency Manager

CDM deploys a ContractRegistry contract to Asset Hub and the registry website to `contracts.dot`.

## Prerequisites
- Git (check: `git --version`)
- Node.js >= 22 (check: `node --version`)
- pnpm 9.15.x (check: `pnpm --version`)
- Bun >= 1.2 (check: `bun --version`)
- Rust + Cargo (check: `cargo --version`)
- `cargo-pvm-contract` on the legacy CDM integration branch (check: `cargo pvm-contract --version`)
- npm, used by the frontend deploy script to install `bulletin-deploy@latest` (check: `npm --version`)

Install `cargo-pvm-contract` for the registry contract:

```bash
HOST_TARGET="$(rustc -vV | awk '/^host:/ {print $2}')"
cargo install --force --locked \
  --target "$HOST_TARGET" \
  --git https://github.com/paritytech/cargo-pvm-contract.git \
  --branch charles/cdm-integration \
  cargo-pvm-contract
```

## 1. Get the code
```bash
git clone git@github.com:paritytech/contract-dependency-manager.git
cd contract-dependency-manager
git checkout main
pnpm install
```

## 2. Configure
- `CDM_DEPLOY_SURI` — deployer SURI or mnemonic for the Asset Hub registry deployment and `contracts.dot` frontend deployment.
- `CHAIN` — CDM known-chain preset for the registry deployment. Use `paseo` for the current public CDM deployment.
- `BULLETIN_DEPLOY_ENV` — bulletin-deploy environment for the frontend. Defaults to `paseo-next-v2`.

```bash
export CDM_DEPLOY_SURI='<deployer mnemonic or SURI>'
export CHAIN=paseo
export BULLETIN_DEPLOY_ENV=paseo-next-v2
```

## 3. Deploy
Deploy the registry contract:

```bash
CHAIN="$CHAIN" SURI="$CDM_DEPLOY_SURI" make deploy-registry | tee /tmp/cdm-registry-deploy.log
export CONTRACTS_REGISTRY_ADDR="$(awk -F= '/^CONTRACTS_REGISTRY_ADDR=/{print $2}' /tmp/cdm-registry-deploy.log | tail -1)"
test -n "$CONTRACTS_REGISTRY_ADDR"
```

Update the in-repo registry preset to the deployed address:

```bash
node - <<'NODE'
const fs = require("fs");
const path = "src/lib/env/src/registry.ts";
const address = process.env.CONTRACTS_REGISTRY_ADDR;
if (!/^0x[0-9a-fA-F]{40}$/.test(address ?? "")) {
  throw new Error(`Invalid CONTRACTS_REGISTRY_ADDR: ${address}`);
}
const next = fs
  .readFileSync(path, "utf8")
  .replace(
    /const PASEO_V2_REGISTRY_ADDRESS = "0x[0-9a-fA-F]{40}";/,
    `const PASEO_V2_REGISTRY_ADDRESS = "${address.toLowerCase()}";`,
  );
fs.writeFileSync(path, next);
NODE
```

Build the packages that expose the new registry address:

```bash
pnpm --filter @dotdm/env build
pnpm --filter @dotdm/contracts build
pnpm --filter @dotdm/frontend build
```

Deploy the frontend to `contracts.dot`:

```bash
src/lib/scripts/deploy-frontend.sh "$CDM_DEPLOY_SURI"
```

## 4. Verify
- Open `contracts.dot` in Polkadot Desktop / Polkadot Browser → you should see the Contract Registry site.
- Confirm the site prints or uses the current registry address from `src/lib/env/src/registry.ts`.
- Run `cdm i -n paseo @example/counter` against a known published package → it should resolve from the deployed registry.
