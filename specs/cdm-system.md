# CDM System

Status:

- Rust/PVM contracts: implemented end-to-end.
- Foundry Solidity contracts: build artifact shape known; CDM deploy/publish/register path TODO.
- Hardhat Solidity contracts: build artifact shape known; CDM deploy/publish/register path TODO.

## System Map

```mermaid
%%{init: {"theme": "base", "look": "handDrawn", "flowchart": {"curve": "basis"}, "themeVariables": {"fontFamily": "Virgil, Comic Sans MS, sans-serif", "primaryTextColor": "#202124", "lineColor": "#3f3f46", "clusterBkg": "#ffffff", "clusterBorder": "#ffffff"}}}%%
flowchart LR
    title["CDM: name -> cid -> install -> consume"]

    subgraph publish["1. PUBLISH"]
        author["Contract author<br/><code>#[pvm::contract(cdm = &quot;@org/foo&quot;)]</code>"]
        deploy["<code>cdm deploy -n paseo</code>"]
        author --> deploy
    end

    subgraph state["2. STORE / ON-CHAIN STATE"]
        registry["ContractRegistry (Asset Hub)<br/><br/><code>&quot;@org/foo&quot; -> 0xABC...</code><br/><code>&quot;@org/foo&quot; -> cid:bafy...</code>"]
        bulletin["Bulletin (content addressed)<br/><br/><code>cid:bafy... -> { abi, readme, authors, repo, ... }</code>"]
        registry -.->|"metadataCid"| bulletin
    end

    subgraph install["3. INSTALL"]
        installCmd["<code>cdm install -n paseo @org/foo</code>"]
        local["<code>~/.cdm/</code> on consumer machine<br/><br/><code>&lt;targetHash&gt;/contracts/@org/foo/&lt;version&gt;/</code><br/><code>├── abi.json</code><br/><code>├── metadata.json</code><br/><code>└── info.json</code>"]
        installCmd --> local
    end

    subgraph consume["4. CONSUME"]
        rust["Rust contract<br/><br/><code>cdm::import!(&quot;@org/foo&quot;);</code><br/><code>foo::cdm_reference()</code>"]
        ts["TypeScript app<br/><br/><code>ContractManager.getContract(&quot;@org/foo&quot;)</code><br/><code>.increment.tx()</code>"]
        rust --> ts
    end

    deploy -->|"publish latest"| registry
    deploy -->|"upload metadata"| bulletin
    registry -->|"name -> cid/address"| installCmd
    bulletin -->|"cid -> blob"| local
    local --> rust

    classDef publishBox fill:#fff3bf,stroke:#f59e0b,stroke-width:2px,color:#92400e;
    classDef stateBox fill:#dbeafe,stroke:#2563eb,stroke-width:2px,color:#1e3a8a;
    classDef bulletinBox fill:#e0e7ff,stroke:#4f46e5,stroke-width:2px,color:#3730a3;
    classDef installBox fill:#dcfce7,stroke:#16a34a,stroke-width:2px,color:#166534;
    classDef consumeBox fill:#ffe4e6,stroke:#e11d48,stroke-width:2px,color:#9f1239;
    class author,deploy publishBox;
    class registry stateBox;
    class bulletin bulletinBox;
    class installCmd,local installBox;
    class rust,ts consumeBox;
```

## Language Entry Points

```mermaid
%%{init: {"theme": "base", "look": "handDrawn", "flowchart": {"curve": "basis"}}}%%
flowchart LR
    root["Project root"] --> detect{"Detect contract project"}

    detect -->|"Cargo.toml + pvm_contract + bin target"| rust["Rust / PVM<br/><b>implemented</b>"]
    detect -.->|"foundry.toml"| foundry["Foundry / Solidity<br/><b>TODO</b>"]
    detect -.->|"hardhat.config.{ts,js,cjs,mjs}"| hardhat["Hardhat / Solidity<br/><b>TODO</b>"]

    rust --> cargo["cargo pvm-contract build"]
    cargo --> rustArtifacts["target/&lt;crate&gt;.release.*"]
    rustArtifacts --> deployRust["CDM deploy pipeline"]

    foundry -.-> forge["forge build --resolc"]
    forge -.-> foundryArtifacts["out/&lt;File.sol&gt;/&lt;Contract&gt;.json"]
    foundryArtifacts -.-> foundryTodo["TODO: metadata + CDM package + deploy adapter"]

    hardhat -.-> hh["npx hardhat compile"]
    hh -.-> hardhatArtifacts["artifacts/contracts/**/*.json"]
    hardhatArtifacts -.-> hardhatTodo["TODO: metadata + CDM package + deploy adapter"]
```

## CLI Pipeline: `cdm build`

```mermaid
%%{init: {"theme": "base", "look": "handDrawn", "flowchart": {"curve": "basis"}}}%%
flowchart TD
    cmd["cdm build<br/><code>src/apps/cli/src/commands/build.ts</code>"]
    opts["Resolve options<br/>root, contracts filter, features, registryAddress"]
    detect["detectDeploymentOrderLayered(root)<br/><code>cargo metadata --no-deps</code>"]
    graph["Build dependency layers<br/>same-layer crates build concurrently"]
    build["pvmContractBuildAsync(crate)<br/><code>cargo pvm-contract build --manifest-path &lt;root&gt;/Cargo.toml -p &lt;crate&gt;</code>"]
    env["Env:<br/><code>CONTRACTS_REGISTRY_ADDR=&lt;registryAddress&gt;</code>"]
    artifacts["Rust artifacts"]
    summary["BuildSummary"]

    cmd --> opts --> detect --> graph --> build
    env --> build
    build --> artifacts --> summary
```

Rust artifact contract:

```text
target/
  <crate>.release.polkavm      # deploy bytecode
  <crate>.release.abi.json     # Solidity-compatible ABI consumed by CDM/product-sdk
  <crate>.release.cdm.json     # { "cdmPackage": "@org/foo" }
```

Rust contract detection:

```ts
type ContractInfo = {
  name: string;                 // Cargo crate name
  cdmPackage: string | null;    // target/<crate>.release.cdm.json
  description: string | null;   // Cargo.toml [package]
  authors: string[];            // Cargo.toml [package]
  homepage: string | null;      // Cargo.toml [package]
  repository: string | null;    // Cargo.toml [package]
  readmePath: string | null;    // Cargo readme or README fallback
  path: string;                 // crate directory
  dependsOnCrates: string[];    // workspace contract deps from Cargo metadata
};
```

## CLI Pipeline: `cdm deploy`

```mermaid
%%{init: {"theme": "base", "look": "handDrawn", "flowchart": {"curve": "basis"}}}%%
flowchart TD
    cmd["cdm deploy -n paseo"]
    preset["Resolve preset<br/>Asset Hub URL, Bulletin URL, IPFS gateway, registry"]
    signer["Resolve signer<br/>--suri -> ~/.cdm/accounts.json -> Alice"]
    connect["Connect Asset Hub + Bulletin<br/><code>createCdmChainClient</code>"]
    pipeline["deployContracts(...)"]

    cmd --> preset --> signer --> connect --> pipeline

    pipeline --> detect["Detect + layer contracts"]
    detect --> build["Build Rust artifacts<br/>same build phase as cdm build"]
    build --> registryHandle["Create ContractRegistry handle"]
    registryHandle --> layerLoop["For each dependency layer"]

    layerLoop --> version["Query version count<br/><code>getVersionCount(@org/foo)</code>"]
    version --> metadata["Assemble metadata JSON"]
    metadata --> cid["Precompute Bulletin CID"]
    cid --> plan["Dry-run Revive.instantiate<br/>address, gas, storage, chunk plan"]

    plan --> assetHubLane["Asset Hub lane"]
    plan --> bulletinLane["Bulletin lane"]

    assetHubLane --> batch["Utility.batch_all<br/>Revive.instantiate_with_code + registry.publishLatest"]
    bulletinLane --> publish["BulletinClient.store(metadataBytes).send()<br/>one tx per metadata item"]

    batch --> verify["Verify Instantiated address == precomputed address"]
    publish --> cidCheck["Verify returned CID == precomputed CID"]
    verify --> done["DeploySummary"]
    cidCheck --> done
```

Deploy bytecode transaction:

```ts
Revive.instantiate_with_code({
  value: 0n,
  weight_limit: dryRunWeightWithBuffer,
  storage_deposit_limit: dryRunStorageDepositWithBuffer,
  code: Uint8Array,              // target/<crate>.release.polkavm today
  data: new Uint8Array(0),       // constructor args not supported today
  salt: computeDeploySalt(cdmPackage, nextVersion)
})
```

Deploy salt:

```ts
computeDeploySalt(cdmPackage, version) =
  blake2b(JSON.stringify([cdmPackage, version.toString()]), 32 bytes)
```

Registry publish transaction:

```ts
registry.publishLatest.prepare(
  contractName,       // "@org/foo"
  contractAddress,    // precomputed Revive address
  metadataUri,        // Bulletin CID string
  { origin, gasLimit, storageDepositLimit }
)
```

Asset Hub submission:

```text
Utility.batch_all([
  Revive.instantiate_with_code(...),
  ContractRegistry.publish_latest(...)
])
```

Bulletin submission:

```ts
const metadataBytes = new TextEncoder().encode(JSON.stringify(metadata));
const result = await bulletin.store(metadataBytes).send();
const cid = result.cid.toString();
```

## Published Metadata

```mermaid
%%{init: {"theme": "base", "look": "handDrawn", "flowchart": {"curve": "basis"}}}%%
flowchart LR
    cargo["Cargo.toml [package]"] --> description["description"]
    cargo --> authors["authors"]
    cargo --> homepage["homepage"]
    cargo --> repository1["repository"]
    git["git remote get-url origin"] --> repository2["repository fallback"]
    readmeFile["README.md / README.txt / README"] --> readme["readme<br/>max 512KB"]
    abiFile["target/&lt;crate&gt;.release.abi.json"] --> abi["abi"]
    clock["new Date().toISOString()"] --> publishedAt["published_at"]
    zero["0"] --> publishBlock["publish_block"]

    description --> metadata["Published metadata JSON"]
    authors --> metadata
    homepage --> metadata
    repository1 --> metadata
    repository2 --> metadata
    readme --> metadata
    abi --> metadata
    publishedAt --> metadata
    publishBlock --> metadata

    metadata --> bulletin["Bulletin CID"]
```

Current metadata shape:

```ts
type PublishedMetadata = {
  publish_block: number;   // currently 0
  published_at: string;    // ISO timestamp at deploy time
  description: string;     // Cargo package description or ""
  readme: string;          // README contents, truncated at 512KB
  authors: string[];       // Cargo package authors
  homepage: string;        // Cargo package homepage or ""
  repository: string;      // Cargo repository or normalized git origin or ""
  abi: AbiEntry[];         // parsed from target/<crate>.release.abi.json
};

type AbiEntry = {
  type: string;
  name?: string;
  inputs: AbiParam[];
  outputs?: AbiParam[];
  stateMutability?: string;
  anonymous?: boolean;
};

type AbiParam = {
  name: string;
  type: string;
  components?: AbiParam[];
};
```

## ContractRegistry State

```mermaid
%%{init: {"theme": "base", "look": "handDrawn", "flowchart": {"curve": "basis"}}}%%
flowchart TD
    publish["publish_latest(contract_name, contract_address, metadata_uri)"]
    ownerCheck{"name exists?"}
    newName["Create name<br/>owner = caller<br/>version_count = 0<br/>append to contract_name_at"]
    auth{"caller == owner?"}
    version["version = version_count<br/>version_count += 1"]
    address["published_address[(name, version)] = contract_address"]
    metadata["published_metadata_uri[(name, version)] = metadata_uri"]

    publish --> ownerCheck
    ownerCheck -- no --> newName --> version
    ownerCheck -- yes --> auth
    auth -- yes --> version
    auth -- no --> revert["revert Unauthorized"]
    version --> address --> metadata
```

Registry storage:

```rust
type Version = u32;

struct NamedContractInfo {
    owner: Address,
    version_count: Version,
}

contract_name_count: u32
contract_name_at[index: u32] -> String
info[contract_name: String] -> NamedContractInfo
published_address[(contract_name: String, version: Version)] -> Address
published_metadata_uri[(contract_name: String, version: Version)] -> String
```

Registry query surface:

```text
get_address(name) -> Option<Address>
get_metadata_uri(name) -> Option<String>
get_address_at_version(name, version) -> Option<Address>
get_metadata_uri_at_version(name, version) -> Option<String>
get_owner(name) -> Address
get_version_count(name) -> u32
get_contract_count() -> u32
get_contract_name_at(index) -> String
```

## CLI Pipeline: `cdm install`

```mermaid
%%{init: {"theme": "base", "look": "handDrawn", "flowchart": {"curve": "basis"}}}%%
flowchart TD
    cmd["cdm install -n paseo @org/foo"]
    target["Resolve target<br/>asset-hub + bulletin gateway + registry"]
    hash["targetHash = blake2b(assetHubUrl, ipfsGatewayUrl, registryAddress)[0..8]"]
    query["Query ContractRegistry"]
    latest["latest:<br/>getVersionCount -> getMetadataUri -> getAddress"]
    pinned["pinned:<br/>getMetadataUriAtVersion -> getAddressAtVersion"]
    fetch["Fetch metadata JSON from Bulletin/IPFS gateway by CID"]
    validate["Require metadata.abi non-empty"]
    save["Save ~/.cdm cache"]
    json["Update project cdm.json"]
    ts["If package.json exists:<br/>generate .cdm/cdm.d.ts + .cdm/contracts.d.ts"]
    rust["If Cargo.toml exists:<br/>Rust macro can resolve ABI from ~/.cdm"]

    cmd --> target --> hash --> query
    query --> latest --> fetch
    query --> pinned --> fetch
    fetch --> validate --> save --> json
    json --> ts
    json --> rust
```

Project `cdm.json` shape:

```ts
type CdmJson = {
  targets: {
    [targetHash: string]: {
      "asset-hub": string;     // Asset Hub RPC URL
      bulletin: string;        // Bulletin IPFS gateway URL
      registry?: string;       // ContractRegistry address
    };
  };
  dependencies: {
    [targetHash: string]: {
      [library: string]: "latest" | number;
    };
  };
  contracts?: {
    [targetHash: string]: {
      [library: string]: {
        version: number;
        address: string;
        abi: unknown[];
        metadataCid: string;
      };
    };
  };
};
```

Local cache shape:

```text
$CDM_ROOT or ~/.cdm/
  <targetHash>/
    contracts/
      @org/foo/
        <version>/
          abi.json
          metadata.json
          info.json
        latest -> <version>
```

`info.json`:

```json
{
  "name": "@org/foo",
  "targetHash": "<targetHash>",
  "version": 0,
  "address": "0x...",
  "metadataCid": "bafy..."
}
```

## Consumption

```mermaid
%%{init: {"theme": "base", "look": "handDrawn", "flowchart": {"curve": "basis"}}}%%
flowchart LR
    cdmJson["cdm.json"] --> manager["product-sdk ContractManager"]
    contractsDts[".cdm/contracts.d.ts"] --> manager
    cache["~/.cdm/&lt;targetHash&gt;/contracts/.../abi.json"] --> rustMacro["Rust cdm::import!"]
    cache --> contractsDts

    manager --> tsApp["TypeScript app<br/>typed getContract('@org/foo')"]
    rustMacro --> rustContract["Rust contract<br/>typed cdm_reference()"]
```

TypeScript apps should use product-sdk contract tooling:

```ts
const contracts = ContractManager.fromClient(cdmJson, chain.raw.assetHub, descriptor);
const foo = contracts.getContract("@org/foo");
await foo.increment.tx();
```

Rust contracts use CDM macro imports:

```rust
cdm::import!("@org/foo");
let foo = foo::cdm_reference();
```

## Solidity Build Skeleton

This section is intentionally a skeleton. It captures known build inputs and artifact shapes from `playground-cli`, without deciding the final CDM metadata/package-name mechanism.

```mermaid
%%{init: {"theme": "base", "look": "handDrawn", "flowchart": {"curve": "basis"}}}%%
flowchart TD
    detect{"Project type"}

    detect -->|"foundry.toml"| foundry["Foundry"]
    detect -->|"hardhat.config.*"| hardhat["Hardhat"]
    detect -->|"Cargo.toml + pvm_contract"| rust["Rust"]

    rust --> rustDone["Implemented:<br/>ContractInfo from Cargo metadata<br/>CDM package from target/*.cdm.json<br/>ABI/readme/package metadata assembled today"]

    foundry --> forge["Command:<br/><code>forge build --resolc</code>"]
    forge --> foundryOut["Artifact scan:<br/><code>out/&lt;File.sol&gt;/&lt;Contract&gt;.json</code>"]
    foundryOut --> foundryBytecode["Bytecode:<br/><code>artifact.bytecode.object</code>"]
    foundryBytecode --> foundryTodo["TODO:<br/>package name source<br/>metadata source<br/>dependency ordering<br/>constructor args<br/>registry publish path"]

    hardhat --> hh["Command:<br/><code>npx hardhat compile</code>"]
    hh --> hardhatOut["Artifact scan:<br/><code>artifacts/contracts/**/*.json</code><br/>skip <code>*.dbg.json</code>"]
    hardhatOut --> hardhatBytecode["Bytecode:<br/><code>artifact.bytecode</code>"]
    hardhatBytecode --> hardhatTodo["TODO:<br/>package name source<br/>metadata source<br/>dependency ordering<br/>constructor args<br/>registry publish path"]
```

Foundry artifact adapter known behavior:

```ts
// Detect
exists("foundry.toml") -> "foundry"

// Build
forge build --resolc

// Scan
out/<File.sol>/<Contract>.json
skip *.t.sol and *.s.sol directories

// Bytecode
const hex = artifact.bytecode.object;
skip missing, "", or "0x"
const bytes = hexToBytes(hex);
```

Hardhat artifact adapter known behavior:

```ts
// Detect
exists("hardhat.config.ts|js|cjs|mjs") -> "hardhat"

// Build
npx hardhat compile
// requires @parity/hardhat-polkadot in config so resolc runs underneath

// Scan
artifacts/contracts/**/*.json
skip *.dbg.json

// Bytecode
const hex = artifact.bytecode;
skip missing, "", or "0x"
const bytes = hexToBytes(hex);
```

Shared Solidity TODO contract artifact shape for CDM:

```ts
type SolidityCdmArtifact = {
  toolchain: "foundry" | "hardhat";
  contractName: string;
  sourceName: string;
  cdmPackage: string;       // TODO: define source of truth
  bytecode: Uint8Array;     // from artifact bytecode
  abi: AbiEntry[];          // from artifact ABI
  metadata: {
    description: string;    // TODO: source
    readme: string;         // TODO: source
    authors: string[];      // TODO: source
    homepage: string;       // TODO: source
    repository: string;     // package.json or git origin?
  };
  dependencies: string[];   // TODO: dependency graph / layer semantics
  constructorArgs: Uint8Array; // TODO: currently deploy data is empty
};
```

## Implementation References

```text
Current CDM:
  src/apps/cli/src/commands/build.ts
  src/apps/cli/src/commands/deploy.ts
  src/apps/cli/src/commands/install/index.ts
  src/apps/cli/src/lib/install-pipeline.ts
  src/lib/contracts/src/detection.ts
  src/lib/contracts/src/builder.ts
  src/lib/contracts/src/pipeline.ts
  src/lib/contracts/src/deployer.ts
  src/lib/contracts/src/publisher.ts
  src/lib/contracts/src/store.ts
  src/lib/contracts/src/cdm-json.ts
  src/contract/src/lib.rs

Playground Solidity reference:
  /Users/charleshetterich/code/playground-cli/src/utils/build/detect.ts
  /Users/charleshetterich/code/playground-cli/src/utils/build/runner.ts
  /Users/charleshetterich/code/playground-cli/src/utils/deploy/contracts.ts
```
