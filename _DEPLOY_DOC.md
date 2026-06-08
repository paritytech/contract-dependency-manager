**IN PROGRESS DO NOT RUN YET**

# Deploying CDM to W3S

Deploy the CDM ContractRegistry to W3S/Summit Asset Hub and record the deployed registry address for CDM consumers.

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

Use a funded W3S/Summit Asset Hub deployer SURI or mnemonic.

```bash
export CDM_DEPLOY_SURI="<deployer-suri-or-mnemonic>"
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

Open a PR with that change. The Summit RPC endpoints are already wired in the W3S preset; the registry deployer should not need to update templates or reinstall packages.

## 5. Deploy Contract Developer Tools Contracts

After the W3S registry address is available in the installed CLI, deploy the contracts from `contract-developer-tools`.

```bash
git clone https://github.com/paritytech/contract-developer-tools.git
cd contract-developer-tools
```

```bash
make install
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
cdm deploy -n w3s
```

## 6. Deploy Frontend

After the registry address PR merges, a CDM maintainer can redeploy `contracts.dot`:

```bash
src/lib/scripts/deploy-frontend.sh "$CDM_DEPLOY_SURI"
```

## Verify

- Re-run `SURI="$CDM_DEPLOY_SURI" CHAIN=w3s make deploy-registry`; it should detect the deployed registry and print the same `CONTRACTS_REGISTRY_ADDR`.
- After the address PR lands, `cdm install -n w3s ...` should resolve against the W3S registry.
