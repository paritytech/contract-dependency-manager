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

The registry (implementation + EIP-1967 proxy) is built with the mainline `cargo-pvm-contract`:

```bash
cargo install --force --locked \
  --git https://github.com/paritytech/cargo-pvm-contract.git \
  cargo-pvm-contract
```

`pnpm build:registry` then builds both blobs to `target/release/contract-registry.polkavm` and `target/release/contract-registry-proxy.polkavm` (each with a matching `.abi.json`).

## 3. Deploy Registry

Use a funded W3S/Summit Asset Hub deployer mnemonic. CDM saves this account later so registry queries use a mapped origin.

The deploy is idempotent and runs up to three steps, skipping any that already happened:

1. **CREATE3 factory bootstrap** (first deploy on a network only): the frozen factory/child blobs committed at `src/contract/create3/artifacts/` are uploaded/deployed — the child via `Revive.upload_code`, the factory via CREATE2 from the deployer EOA. Same EOA ⇒ same factory address on every network. See [src/contract/create3/README.md](src/contract/create3/README.md).
2. **Implementation blob** via plain CREATE2 — its address doesn't matter.
3. **EIP-1967 proxy THROUGH the factory**: proxy code is uploaded (`upload_code`), then `factory.deploy(salt, proxyCodeHash, implAddress)` lands it at an address that is a pure function of `(factory, salt)` — independent of the proxy bytecode and the implementation address.

The **proxy address is the registry address** — it never changes, even across proxy bytecode revisions. The proxy's deployer becomes the registry admin; later implementation upgrades are done by the admin calling `setCode(<new implementation address>)` through the proxy — the proxy is never redeployed.

```bash
export CDM_DEPLOY_SURI="<deployer-mnemonic>"
pnpm deploy:registry -- --name w3s --suri "$CDM_DEPLOY_SURI"
```

Copy the deployed proxy address from:

```text
CONTRACTS_REGISTRY_ADDR=0x...
```

(The script also prints `CONTRACTS_REGISTRY_IMPL_ADDR=0x...` — the implementation blob the proxy currently delegates to — and `CREATE3_FACTORY_ADDR=0x...` — the factory the proxy was deployed through; you normally don't need either.)

## 4. Open Address PR

Update only the W3S registry string in `src/lib/env/src/registry.ts`:

```ts
const W3S_REGISTRY_ADDRESS = "0x...";
```

Add a changeset so the updated registry address ships in both the `@parity/cdm-env` package and the compiled CLI release:

```bash
cat > .changeset/w3s-registry-address.md <<'EOF'
---
"@parity/cdm-cli": patch
"@parity/cdm-env": patch
---

Set the W3S registry address.
EOF
```

Open a PR with those changes. The Summit RPC endpoints are already wired in the W3S preset.

## 5. Install CDM CLI With W3S Registry

After the W3S registry address PR merges, update the CDM checkout and install the CLI from source so it has the new W3S registry address.

```bash
git checkout main
git pull --ff-only
pnpm install
pnpm install:cli
cdm account set -n w3s --mnemonic "$CDM_DEPLOY_SURI"
```

## 6. Deploy Contract Developer Tools Contracts

Deploy the shared contracts from `contract-developer-tools`.

```bash
cd ..
git clone https://github.com/paritytech/contract-developer-tools.git
cd contract-developer-tools
```

Make sure the CDM toolchain (Rust nightly, `rust-src`, mainline `cargo-pvm-contract`) is installed:

```bash
cdm setup
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

The script uses pinned [`polkadot-app-deploy`](https://github.com/paritytech/polkadot-app-deploy) 0.16.1 (`@parity/polkadot-app-deploy`), the successor of `bulletin-deploy`. This version supports `paseo-next-v2` and `devnet`; it does **not** provide the former `summit` environment. CDM's registry chain presets and the frontend hosting environment are separate settings. Deploying the frontend does not migrate a registry or verify its availability on W3S.

Inspect the deployment target without credentials, installation, build, or network writes:

```bash
src/lib/scripts/deploy-frontend.sh --dry-run
APP_DEPLOY_ENV=devnet src/lib/scripts/deploy-frontend.sh --dry-run
```

A CDM maintainer can build and publish with a bare mnemonic (CI exposes its `MNEMONIC` secret as `CDM_DEPLOY_SURI`, but `//Alice` is not a mnemonic):

```bash
# Default: contracts.paseo on paseo-next-v2
src/lib/scripts/deploy-frontend.sh "$CDM_DEPLOY_SURI"
# Optional: contracts.dot on devnet
APP_DEPLOY_ENV=devnet src/lib/scripts/deploy-frontend.sh "$CDM_DEPLOY_SURI"
```

The script installs version 0.16.1 globally unless `SKIP_APP_DEPLOY_INSTALL=1`, in which case it verifies the installed version. Unset `DOTNS_RPC`, `DOTNS_KEY_URI`, `PAD_ENV_FILE`, `BULLETIN_RPC`, and `IPFS_CID` so inherited overrides cannot select a different network, signer, or pre-existing content CID. The supported extra CLI arguments are `--tag frontend` and `--js-merkle`; other flags are rejected to keep the selected network and signer consistent. The existing push-to-main deployment workflow uses the default Paseo target. A PR validation run does not publish anything.

## Verify

After an authorized deployment, use the URL returned by the CLI to open the frontend and check the selected registry and shared contracts in the intended host. Live deployment, account funding, domain ownership, and W3S registry acceptance must be verified by the deploying maintainer; a successful local frontend build cannot establish them.
