# Deploying CDM to W3S

Deploy the CDM ContractRegistry to W3S/Summit Asset Hub, register the shared CDM contracts, and prepare the frontend deploy path.

Assumes Node.js 22, pnpm, Bun, Rust/Cargo, and a funded W3S/Summit deployer mnemonic are available.

## 1. Get The Code

```bash
git clone https://github.com/paritytech/contract-dependency-manager.git
cd contract-dependency-manager
git checkout main
pnpm install
```

## 2. Install Registry Build Tooling

The registry contract is still built with the legacy `charles/cdm-integration` branch of `cargo-pvm-contract`.

```bash
HOST_TARGET="$(rustc -vV | awk '/^host:/ {print $2}')"
cargo install --force --locked \
  --target "$HOST_TARGET" \
  --git https://github.com/paritytech/cargo-pvm-contract.git \
  --branch charles/cdm-integration \
  cargo-pvm-contract
```

## 3. Deploy Registry

Use a funded W3S/Summit Asset Hub deployer mnemonic. CDM saves this account later so registry queries use a mapped origin.

```bash
export CDM_DEPLOY_SURI="<deployer-mnemonic>"
SURI="$CDM_DEPLOY_SURI" CHAIN=w3s make deploy-registry
```

Copy the deployed address from:

```text
CONTRACTS_REGISTRY_ADDR=0x...
```

## 4. Open Address PR

Update only the W3S registry string in `src/lib/env/src/registry.ts`:

```ts
const W3S_REGISTRY_ADDRESS = "0x...";
```

Open a PR with that change. The Summit RPC endpoints are already wired in the W3S preset.

## 5. Install CDM CLI With W3S Registry

After the W3S registry address PR merges, update the CDM checkout and install the CLI from source so it has the new W3S registry address.

```bash
git checkout main
git pull --ff-only
pnpm install
make install
cdm account set -n w3s --mnemonic "$CDM_DEPLOY_SURI"
```

## 6. Deploy Contract Developer Tools Contracts

Deploy the shared contracts from `contract-developer-tools`.

```bash
cd ..
git clone https://github.com/paritytech/contract-developer-tools.git
cd contract-developer-tools
```

Install the legacy `cargo-pvm-contract` branch required by these contracts:

```bash
HOST_TARGET="$(rustc -vV | awk '/^host:/ {print $2}')"
cargo install --force --locked \
  --target "$HOST_TARGET" \
  --git https://github.com/paritytech/cargo-pvm-contract.git \
  --branch charles/cdm-integration \
  cargo-pvm-contract
```

```bash
cdm deploy -n w3s --suri "$CDM_DEPLOY_SURI"
```

## Verify

Install the shared contracts from the W3S registry and confirm `cdm.json` contains resolved contract metadata and addresses.

```bash
cdm install -n w3s \
  @polkadot/contexts \
  @mock/disputes \
  @polkadot/profiles \
  @mock/reputation \
  @polkadot/threads
```

Then just validate `cdm.json` contains resolved contract metadata and addresses.

## 7. Deploy Frontend

Pending W3S environment support in `bulletin-deploy`. Once `bulletin-deploy --list-environments` includes the W3S/Summit environment, a CDM maintainer can redeploy `contracts.dot`:

```bash
cd ../contract-dependency-manager
BULLETIN_DEPLOY_ENV=w3s src/lib/scripts/deploy-frontend.sh "$CDM_DEPLOY_SURI"
```

## Verify

The website should now be available at `contracts.dot` with the shared contracts visible on the w3s environment.