import { mkdtempSync, readFileSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import {
    CONTRACTS_REGISTRY_IMPL_PACKAGE,
    CONTRACTS_REGISTRY_PACKAGE,
    CONTRACTS_RESOLVER_IMPL_PACKAGE,
    CONTRACTS_RESOLVER_PACKAGE,
    CONTRACTS_SHIM_FACTORY_PACKAGE,
    CREATE3_FACTORY_PACKAGE,
    stringifyBigInt,
} from "@parity/cdm-utils";
import type { Contract, ContractDef } from "@parity/product-sdk-contracts";
import {
    computeDeploySalt,
    type ContractDeployer,
    decodedErrorSignature,
    describeContractError,
} from "./deployer";
import {
    eoaH160FromPublicKey,
    loadCreate3ChildArtifact,
    loadCreate3FactoryArtifact,
    predictCreate3Address,
    predictReviveCreate2Address,
} from "./create3";
import { loadContractProxyArtifact } from "./proxy-artifacts";
import { extractFoundryBytecode, hexToBytes } from "./solidity";

/**
 * CDM's on-chain bootstrap via the CREATE3 factory:
 *
 * 1. CREATE3 factory (frozen artifact) — plain CREATE2 from the operator's
 *    EOA with the committed child code hash as constructor arg and the
 *    `CREATE3_FACTORY_PACKAGE` salt.
 * 2. Shim factory — plain CREATE2 (`CONTRACTS_SHIM_FACTORY_PACKAGE`). The
 *    registry is EVM bytecode and cannot create a PVM contract itself, so it
 *    delegate-calls this to instantiate each name's shim.
 * 3. Registry implementation (EVM bytecode) — plain CREATE2
 *    (`CONTRACTS_REGISTRY_IMPL_PACKAGE`) with the shim factory as constructor
 *    arg; its address is irrelevant, upgrades go through `setCode`.
 * 4. Registry proxy (EIP-1967) — through the CREATE3 factory, so the registry
 *    address is a pure function of `(factory, salt)` and survives proxy
 *    bytecode or constructor changes.
 * 5. Resolver implementation (EVM bytecode) — plain CREATE2
 *    (`CONTRACTS_RESOLVER_IMPL_PACKAGE`).
 * 6. Resolver proxy (the same EIP-1967 blob) — through the CREATE3 factory
 *    with the registry as admin, then handed to the registry via `setResolver`.
 * 7. Per-name shim blob (frozen artifact) — uploaded once its hash matches
 *    the one compiled into the registry; never instantiated here.
 */

/** The build outputs a registry deploy or upgrade reads. */
export interface RegistryArtifacts {
    /** Forge artifact of the registry implementation. */
    registryArtifactPath: string;
    /** Forge artifact of the resolver implementation. */
    resolverArtifactPath: string;
    /** The EIP-1967 proxy blob, shared by the registry and the resolver. */
    eip1967ProxyPvmPath: string;
    /** The blob the registry delegate-calls to create a name's shim. */
    shimFactoryPvmPath: string;
}

/** Where `pnpm build:registry` leaves them in a checkout rooted at `rootDir`. */
export function registryArtifacts(rootDir: string): RegistryArtifacts {
    return {
        registryArtifactPath: resolve(
            rootDir,
            "src/contract/solidity/out/Registry.sol/Registry.json",
        ),
        resolverArtifactPath: resolve(
            rootDir,
            "src/contract/solidity/out/Resolver.sol/Resolver.json",
        ),
        eip1967ProxyPvmPath: resolve(rootDir, "target/release/contract-eip1967-proxy.polkavm"),
        shimFactoryPvmPath: resolve(rootDir, "target/release/contract-shim-factory.polkavm"),
    };
}

type ContractHandle = (address: string) => Contract<ContractDef> | Promise<Contract<ContractDef>>;
type Log = (message: string) => void;

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

/**
 * `(address implementation, address admin)` as two left-padded words. `admin`
 * is explicit because the constructor's on-chain caller is the single-use
 * CREATE3 child.
 */
export function encodeProxyConstructorArgs(implementation: string, admin: string): Uint8Array {
    const out = new Uint8Array(64);
    out.set(encodeAddressWord(implementation, "implementation"), 0);
    out.set(encodeAddressWord(admin, "admin"), 32);
    return out;
}

function encodeAddressWord(address: string, what: string): Uint8Array {
    const hex = address.toLowerCase().replace(/^0x/, "");
    if (!/^[0-9a-f]{40}$/.test(hex)) {
        throw new Error(`Invalid ${what} address for constructor encoding: ${address}`);
    }
    const word = new Uint8Array(32);
    for (let i = 0; i < 20; i++) {
        word[12 + i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    }
    return word;
}

function readBlob(path: string): Uint8Array {
    return new Uint8Array(readFileSync(path));
}

/**
 * The creation code in a forge artifact with `constructorArgs` appended: an
 * EVM constructor reads its arguments from the end of the code.
 */
function evmCreationCode(
    artifactPath: string,
    constructorArgs: Uint8Array = new Uint8Array(0),
): Uint8Array {
    const bytecode = extractFoundryBytecode(JSON.parse(readFileSync(artifactPath, "utf8")));
    if (!bytecode) throw new Error(`No creation bytecode in forge artifact ${artifactPath}`);
    const code = hexToBytes(bytecode);
    const out = new Uint8Array(code.length + constructorArgs.length);
    out.set(code, 0);
    out.set(constructorArgs, code.length);
    return out;
}

/** The registry implementation's creation code: its one constructor arg is the shim factory. */
function registryImplCode(artifacts: RegistryArtifacts, shimFactoryAddress: string): Uint8Array {
    return evmCreationCode(
        artifacts.registryArtifactPath,
        encodeAddressWord(shimFactoryAddress, "shim factory"),
    );
}

/** Where a plain CREATE2 of `code` under `pkg` lands for this deployer. */
function predictCreate2(deployer: ContractDeployer, code: Uint8Array, pkg: string): string {
    return predictReviveCreate2Address(
        eoaH160FromPublicKey(deployer.signer.publicKey),
        code,
        new Uint8Array(0),
        hexToBytes(computeDeploySalt(pkg)),
    );
}

export interface ResolverDeployPrediction {
    /** CREATE2 address of the resolver implementation. */
    resolverImplAddress: string;
    /** CREATE3 address of the resolver proxy; depends ONLY on (factoryAddress, resolver salt). */
    resolverAddress: string;
    /** ABI-encoded proxy constructor args (resolver implementation, admin = the registry). */
    resolverConstructorData: Uint8Array;
}

/** Offline prediction of the resolver pair behind `registryAddress`. */
export function predictResolverDeploy(
    deployer: ContractDeployer,
    factoryAddress: string,
    registryAddress: string,
    artifacts: RegistryArtifacts,
): ResolverDeployPrediction {
    const resolverImplAddress = predictCreate2(
        deployer,
        evmCreationCode(artifacts.resolverArtifactPath),
        CONTRACTS_RESOLVER_IMPL_PACKAGE,
    );
    const resolverAddress = predictCreate3Address(
        factoryAddress,
        hexToBytes(computeDeploySalt(CONTRACTS_RESOLVER_PACKAGE)),
    );
    return {
        resolverImplAddress,
        resolverAddress,
        resolverConstructorData: encodeProxyConstructorArgs(resolverImplAddress, registryAddress),
    };
}

export interface RegistryDeployPrediction extends ResolverDeployPrediction {
    /** CREATE2 address of the CREATE3 factory (frozen blob, fixed salt). */
    factoryAddress: string;
    /** CREATE2 address of the shim factory the registry implementation is built for. */
    shimFactoryAddress: string;
    /** CREATE2 address of the registry implementation. */
    implAddress: string;
    /**
     * CREATE3 address of the registry proxy — the stable registry address.
     * Depends ONLY on (factoryAddress, registry salt).
     */
    registryAddress: string;
    /** ABI-encoded proxy constructor args (implementation, admin = deployer EOA). */
    constructorData: Uint8Array;
}

/**
 * Predict every address of the deployment fully offline — no chain
 * round-trips, so this also works when (some of) the contracts already exist
 * on-chain, where an instantiate dry-run would fail with `DuplicateContract`.
 *
 * `rootDir` must be a contract-dependency-manager checkout (the frozen
 * CREATE3 artifacts are loaded — and hash-verified — from
 * `src/contract/create3/artifacts/`).
 */
export function predictRegistryDeploy(
    deployer: ContractDeployer,
    rootDir: string,
    artifacts: RegistryArtifacts,
): RegistryDeployPrediction {
    const factoryArtifact = loadCreate3FactoryArtifact(rootDir);
    const childArtifact = loadCreate3ChildArtifact(rootDir);
    const eoa = eoaH160FromPublicKey(deployer.signer.publicKey);

    const factoryAddress = predictReviveCreate2Address(
        eoa,
        factoryArtifact.bytes,
        hexToBytes(childArtifact.codeHash), // constructor arg: 32 raw bytes
        hexToBytes(computeDeploySalt(CREATE3_FACTORY_PACKAGE)),
    );
    const shimFactoryAddress = predictCreate2(
        deployer,
        readBlob(artifacts.shimFactoryPvmPath),
        CONTRACTS_SHIM_FACTORY_PACKAGE,
    );
    const implAddress = predictCreate2(
        deployer,
        registryImplCode(artifacts, shimFactoryAddress),
        CONTRACTS_REGISTRY_IMPL_PACKAGE,
    );
    const registryAddress = predictCreate3Address(
        factoryAddress,
        hexToBytes(computeDeploySalt(CONTRACTS_REGISTRY_PACKAGE)),
    );
    return {
        factoryAddress,
        shimFactoryAddress,
        implAddress,
        registryAddress,
        constructorData: encodeProxyConstructorArgs(implAddress, eoa),
        ...predictResolverDeploy(deployer, factoryAddress, registryAddress, artifacts),
    };
}

/** The artifacts and handles every resolver step needs. */
interface ResolverSetup {
    /** contract-dependency-manager checkout root (for the frozen artifacts). */
    rootDir: string;
    artifacts: RegistryArtifacts;
    /**
     * Build a product-sdk contract handle for the CREATE3 factory at the
     * given address (`CREATE3_FACTORY_ABI`); registry-deploy stays free of
     * chain-descriptor knowledge this way.
     */
    factoryContract: ContractHandle;
}

export interface DeployRegistryOptions extends ResolverSetup {
    /**
     * Registry handle (`CONTRACTS_REGISTRY_ABI` at the proxy address) with the
     * admin signer, for `setResolver`. When omitted, the resolver is not
     * deployed and first publishes fail until a later run.
     */
    registryContract?: ContractHandle;
    /** Reuse a prior {@link predictRegistryDeploy} result. */
    prediction?: RegistryDeployPrediction;
    log?: Log;
}

/** `decodedErrorSignature` with a stringified fallback, for query failures. */
function queryErrorDetail(value: unknown): string {
    return decodedErrorSignature(value) ?? stringifyBigInt(value);
}

/** Decoded `bytes32` (hex string, bytes, or `asHex()` wrapper) → lowercase hex. */
function hashHex(value: unknown): string | undefined {
    if (typeof value === "string") return value.toLowerCase();
    if (value instanceof Uint8Array) {
        let out = "0x";
        for (const b of value) out += b.toString(16).padStart(2, "0");
        return out;
    }
    if (value && typeof value === "object" && "asHex" in value) {
        return (value as { asHex(): string }).asHex().toLowerCase();
    }
    return undefined;
}

/** The value of a successful query, or a thrown error naming `what`. */
async function expectQuery(
    query: Promise<{ success: boolean; value: unknown }>,
    what: string,
): Promise<unknown> {
    const result = await query;
    if (!result.success) {
        throw new Error(`${what} failed: ${queryErrorDetail(result.value)}`);
    }
    return result.value;
}

async function submit(tx: Promise<{ ok: boolean; error?: unknown }>, what: string): Promise<void> {
    const result = await tx;
    if (!result.ok) {
        throw new Error(`${what} failed: ${describeContractError(result.error)}`, {
            cause: result.error,
        });
    }
}

/** Re-read an address through `query` after a write and require `expected`. */
async function verifyAddress(
    query: Promise<{ success: boolean; value: unknown }>,
    expected: string,
    what: string,
): Promise<void> {
    const result = await query;
    const actual = result.success ? String(result.value) : undefined;
    if (actual?.toLowerCase() !== expected.toLowerCase()) {
        throw new Error(
            `${what} verification failed: read back ${
                result.success ? actual : queryErrorDetail(result.value)
            }, expected ${expected}`,
        );
    }
}

/** CREATE2-deploy `code` under `pkg` unless its address already holds code. */
async function ensureCreate2(
    deployer: ContractDeployer,
    code: Uint8Array,
    pkg: string,
    what: string,
    log: Log,
): Promise<string> {
    const address = predictCreate2(deployer, code, pkg);
    if ((await deployer.getOnChainCode(address)) !== null) {
        log(`${what} already deployed at ${address} (salt "${pkg}")`);
        return address;
    }
    const deployed = await deployer.deploy(code, pkg);
    if (deployed.address.toLowerCase() !== address.toLowerCase()) {
        throw new Error(
            `${what} address mismatch: deployed ${deployed.address}, offline prediction says ${address}`,
        );
    }
    log(`${what} deployed at ${address} (salt "${pkg}")`);
    return address;
}

/** The shim factory, then the registry implementation built for it. */
async function ensureRegistryImplementation(
    deployer: ContractDeployer,
    artifacts: RegistryArtifacts,
    implPackage: string,
    log: Log,
): Promise<string> {
    const shimFactoryAddress = await ensureShimFactory(deployer, artifacts, log);
    return ensureCreate2(
        deployer,
        registryImplCode(artifacts, shimFactoryAddress),
        implPackage,
        "Registry implementation",
        log,
    );
}

function ensureShimFactory(
    deployer: ContractDeployer,
    artifacts: RegistryArtifacts,
    log: Log,
): Promise<string> {
    return ensureCreate2(
        deployer,
        readBlob(artifacts.shimFactoryPvmPath),
        CONTRACTS_SHIM_FACTORY_PACKAGE,
        "Shim factory",
        log,
    );
}

/** Deploy the EIP-1967 proxy blob through the factory at `expected` unless code is there. */
async function ensureProxyViaFactory(
    deployer: ContractDeployer,
    setup: ResolverSetup,
    factoryAddress: string,
    pkg: string,
    constructorData: Uint8Array,
    expected: string,
    what: string,
    log: Log,
): Promise<void> {
    if ((await deployer.getOnChainCode(expected)) !== null) {
        log(`${what} already deployed at ${expected}`);
        return;
    }
    const { codeHash } = await deployer.uploadCode(readBlob(setup.artifacts.eip1967ProxyPvmPath));
    const factory = await setup.factoryContract(factoryAddress);
    await deployer.deployViaCreate3Factory(
        factory,
        factoryAddress,
        computeDeploySalt(pkg),
        codeHash,
        constructorData,
    );
    // The block that included the deploy can still be reorged out.
    if ((await deployer.getOnChainCode(expected)) === null) {
        throw new Error(`${what} not found at ${expected} after its deploy was included`);
    }
    log(`${what} deployed at ${expected}`);
}

/**
 * Deploy the resolver pair behind `registryAddress` and hand it to the
 * registry; idempotent, so a run cut short after `setResolver` still lands
 * the proxy. A registry already pointing at a different resolver is an
 * error: shims bake the address in, so it can never change.
 */
async function ensureResolver(
    deployer: ContractDeployer,
    registry: Contract<ContractDef>,
    registryAddress: string,
    factoryAddress: string,
    setup: ResolverSetup,
    log: Log,
): Promise<string> {
    const plan = predictResolverDeploy(deployer, factoryAddress, registryAddress, setup.artifacts);
    const live = String(
        await expectQuery(
            registry.getResolver.query(),
            "getResolver() (the live implementation may predate the resolver; upgrade it first)",
        ),
    ).toLowerCase();
    if (live !== ZERO_ADDRESS && live !== plan.resolverAddress.toLowerCase()) {
        throw new Error(
            `Registry ${registryAddress} already uses resolver ${live}, not the predicted ${plan.resolverAddress}`,
        );
    }

    await ensureCreate2(
        deployer,
        evmCreationCode(setup.artifacts.resolverArtifactPath),
        CONTRACTS_RESOLVER_IMPL_PACKAGE,
        "Resolver implementation",
        log,
    );
    await ensureProxyViaFactory(
        deployer,
        setup,
        factoryAddress,
        CONTRACTS_RESOLVER_PACKAGE,
        plan.resolverConstructorData,
        plan.resolverAddress,
        "Resolver",
        log,
    );
    if (live === ZERO_ADDRESS) {
        await submit(registry.setResolver.tx(plan.resolverAddress), "setResolver");
        await verifyAddress(registry.getResolver.query(), plan.resolverAddress, "setResolver");
    }
    log(`Resolver set to ${plan.resolverAddress}`);
    return plan.resolverAddress;
}

/**
 * Upload the frozen per-name shim blob. The registry creates shims from the
 * hash compiled into its implementation, so a live implementation built for
 * another blob is an error here; idempotent.
 */
async function ensureProxyCode(
    deployer: ContractDeployer,
    registry: Contract<ContractDef>,
    rootDir: string,
    log: Log,
): Promise<`0x${string}`> {
    const artifact = loadContractProxyArtifact(rootDir);
    const live = hashHex(
        await expectQuery(
            registry.getProxyCodeHash.query(),
            "getProxyCodeHash() (the live implementation may be a pre-versioning build; upgrade it first)",
        ),
    );
    if (live !== artifact.codeHash) {
        throw new Error(
            `The live registry implementation creates shims from code hash ${live}, but the ` +
                `frozen shim blob hashes to ${artifact.codeHash} — upgrade the registry to an ` +
                "implementation built for this blob.",
        );
    }
    await deployer.uploadCode(artifact.bytes);
    log(`Per-name shim blob uploaded (code hash ${artifact.codeHash})`);
    return artifact.codeHash;
}

/**
 * Deploy the registry behind its proxy (factory first if missing), then the
 * resolver and the shim blob when `registryContract` is provided. Every
 * step is idempotent, so a partial run can be re-run. `proxyAddress` is the
 * registry address.
 */
export async function deployRegistryWithProxy(
    deployer: ContractDeployer,
    opts: DeployRegistryOptions,
): Promise<{
    factoryAddress: string;
    implAddress: string;
    proxyAddress: string;
    /** The resolver proxy; undefined when the registry setup was skipped. */
    resolverAddress?: string;
    /** Frozen per-name shim code hash; undefined when the registry setup was skipped. */
    proxyCodeHash?: `0x${string}`;
}> {
    const log = opts.log ?? (() => {});
    const plan = opts.prediction ?? predictRegistryDeploy(deployer, opts.rootDir, opts.artifacts);
    const done = {
        factoryAddress: plan.factoryAddress,
        implAddress: plan.implAddress,
        proxyAddress: plan.registryAddress,
    };
    const finish = async () => {
        if (!opts.registryContract) return done;
        const registry = await opts.registryContract(plan.registryAddress);
        const resolverAddress = await ensureResolver(
            deployer,
            registry,
            plan.registryAddress,
            plan.factoryAddress,
            opts,
            log,
        );
        const proxyCodeHash = await ensureProxyCode(deployer, registry, opts.rootDir, log);
        return { ...done, resolverAddress, proxyCodeHash };
    };

    // Code at the CREATE3 address means the deployment already happened.
    if ((await deployer.getOnChainCode(plan.registryAddress)) !== null) {
        log(`Registry already deployed at ${plan.registryAddress}`);
        return finish();
    }

    // (i) CREATE3 factory: upload the child blob, then CREATE2 the factory
    // with the child code hash as constructor arg.
    if ((await deployer.getOnChainCode(plan.factoryAddress)) === null) {
        const factoryArtifact = loadCreate3FactoryArtifact(opts.rootDir);
        const childArtifact = loadCreate3ChildArtifact(opts.rootDir);
        const constructorData = hexToBytes(childArtifact.codeHash);

        await deployer.uploadCode(childArtifact.bytes);

        const dryRun = await deployer.dryRunDeploy(
            factoryArtifact.bytes,
            CREATE3_FACTORY_PACKAGE,
            undefined,
            undefined,
            constructorData,
        );
        if (dryRun.address.toLowerCase() !== plan.factoryAddress.toLowerCase()) {
            throw new Error(
                `CREATE3 factory address mismatch: node derives ${dryRun.address}, offline prediction says ${plan.factoryAddress}`,
            );
        }

        await deployer.deploy(
            factoryArtifact.bytes,
            CREATE3_FACTORY_PACKAGE,
            undefined,
            undefined,
            constructorData,
        );
        log(`CREATE3 factory deployed at ${plan.factoryAddress}`);
    } else {
        log(`CREATE3 factory already deployed at ${plan.factoryAddress}`);
    }

    // (ii) Shim factory and registry implementation — plain CREATE2 each.
    await ensureRegistryImplementation(
        deployer,
        opts.artifacts,
        CONTRACTS_REGISTRY_IMPL_PACKAGE,
        log,
    );

    // (iii) The registry proxy, through the CREATE3 factory.
    await ensureProxyViaFactory(
        deployer,
        opts,
        plan.factoryAddress,
        CONTRACTS_REGISTRY_PACKAGE,
        plan.constructorData,
        plan.registryAddress,
        "Registry",
        log,
    );

    // (iv) Resolver and per-name shim code hash.
    return finish();
}

/** `"@cdm/registry-impl.1"` → `"@cdm/registry-impl.2"`. */
export function bumpPackageSuffix(pkg: string): string {
    const match = /^(.*\.)(\d+)$/.exec(pkg);
    if (!match) {
        throw new Error(`Cannot bump salt package "${pkg}": expected a ".<number>" suffix`);
    }
    return `${match[1]}${Number(match[2]) + 1}`;
}

/** Paranoia guard for the salt probe loop, not a capacity limit. */
const MAX_IMPL_SALT_PROBES = 100;

/**
 * The first of `basePackage` and its suffix bumps for which `visit` returns a
 * value. Each candidate comes with the address `code` deploys to under it.
 */
async function probeSalts<T>(
    deployer: ContractDeployer,
    code: Uint8Array,
    basePackage: string,
    visit: (candidate: string, address: string) => Promise<T | undefined>,
): Promise<T | undefined> {
    let candidate = basePackage;
    for (let probes = 0; probes < MAX_IMPL_SALT_PROBES; probes++) {
        const found = await visit(candidate, predictCreate2(deployer, code, candidate));
        if (found !== undefined) return found;
        candidate = bumpPackageSuffix(candidate);
    }
    return undefined;
}

/**
 * Deploy `code` under `implPackage`, or under the first suffix bump of
 * `basePackage` whose predicted address holds no code.
 */
async function deployAtFreeSalt(
    deployer: ContractDeployer,
    code: Uint8Array,
    basePackage: string,
    implPackage: string | undefined,
    what: string,
    log: Log,
): Promise<{ implAddress: string; implPackage: string }> {
    const free =
        implPackage ??
        (await probeSalts(deployer, code, basePackage, async (candidate, address) => {
            if ((await deployer.getOnChainCode(address)) === null) return candidate;
            log(`Implementation salt "${candidate}" already consumed at ${address} — bumping`);
            return undefined;
        }));
    if (free === undefined) {
        throw new Error(
            `No free implementation salt within ${MAX_IMPL_SALT_PROBES} bumps of "${basePackage}"`,
        );
    }
    // CREATE2 commits to the code, so code at this address is this code.
    return {
        implAddress: await ensureCreate2(deployer, code, free, what, log),
        implPackage: free,
    };
}

/**
 * Whether the contract at `address` was created from `code`. CREATE2 commits
 * to the creation code, so it was iff `address` is where `code` lands under
 * `implPackage`, or under `basePackage` or one of its bumps.
 */
async function createdFrom(
    deployer: ContractDeployer,
    address: string,
    code: Uint8Array,
    basePackage: string,
    implPackage: string | undefined,
): Promise<boolean> {
    const live = address.toLowerCase();
    if (implPackage !== undefined) {
        return predictCreate2(deployer, code, implPackage).toLowerCase() === live;
    }
    const found = await probeSalts(deployer, code, basePackage, async (_, candidate) =>
        candidate.toLowerCase() === live ? true : undefined,
    );
    return found === true;
}

/** `artifacts` holds the NEW registry implementation to upgrade to. */
export interface UpgradeRegistryOptions extends ResolverSetup {
    /** Address of the live registry proxy being upgraded. */
    registryAddress: string;
    /** Registry handle with the admin signer (`setCode` and the setup writes are admin-only). */
    registryContract: ContractHandle;
    /** Salt package for the new implementation; default: first free suffix bump of `CONTRACTS_REGISTRY_IMPL_PACKAGE`. */
    implPackage?: string;
    log?: Log;
}

/**
 * Upgrade a live registry in place: new implementation at a fresh CREATE2
 * salt, `setCode`, then the resolver and the shim blob are ensured.
 * Idempotent — a live implementation created from this code skips the deploy
 * and `setCode` (`upgraded: false`).
 */
export async function upgradeRegistryImplementation(
    deployer: ContractDeployer,
    opts: UpgradeRegistryOptions,
): Promise<{
    implAddress: string;
    /** Salt package the new implementation was deployed under; undefined when skipped. */
    implPackage?: string;
    resolverAddress: string;
    proxyCodeHash: `0x${string}`;
    upgraded: boolean;
}> {
    const log = opts.log ?? (() => {});
    const registry = await opts.registryContract(opts.registryAddress);
    const implCode = registryImplCode(
        opts.artifacts,
        await ensureShimFactory(deployer, opts.artifacts, log),
    );

    const finish = async (implAddress: string, implPackage?: string, upgraded = false) => {
        const factoryAddress = predictRegistryDeploy(
            deployer,
            opts.rootDir,
            opts.artifacts,
        ).factoryAddress;
        const resolverAddress = await ensureResolver(
            deployer,
            registry,
            opts.registryAddress,
            factoryAddress,
            opts,
            log,
        );
        const proxyCodeHash = await ensureProxyCode(deployer, registry, opts.rootDir, log);
        return { implAddress, implPackage, resolverAddress, proxyCodeHash, upgraded };
    };

    const liveAddress = String(await expectQuery(registry.getCode.query(), "getCode()"));
    if (
        await createdFrom(
            deployer,
            liveAddress,
            implCode,
            CONTRACTS_REGISTRY_IMPL_PACKAGE,
            opts.implPackage,
        )
    ) {
        log(
            `Implementation at ${liveAddress} already matches ${opts.artifacts.registryArtifactPath}`,
        );
        return finish(liveAddress);
    }

    const { implAddress, implPackage } = await deployAtFreeSalt(
        deployer,
        implCode,
        CONTRACTS_REGISTRY_IMPL_PACKAGE,
        opts.implPackage,
        "Registry implementation",
        log,
    );
    await submit(registry.setCode.tx(implAddress), "setCode");
    await verifyAddress(registry.getCode.query(), implAddress, "setCode");
    log(`Registry ${opts.registryAddress} now delegates to ${implAddress}`);
    return finish(implAddress, implPackage, true);
}

export interface UpgradeResolverOptions {
    /** Forge artifact of the NEW resolver implementation to upgrade to. */
    resolverArtifactPath: string;
    /** Address of the live registry proxy, the resolver's admin. */
    registryAddress: string;
    /** Registry handle with the admin signer (`upgradeResolver` is admin-only). */
    registryContract: ContractHandle;
    /** Resolver handle (`CONTRACT_RESOLVER_ABI`) for the verifying reads. */
    resolverContract: ContractHandle;
    /** Salt package for the new implementation; default: first free suffix bump of `CONTRACTS_RESOLVER_IMPL_PACKAGE`. */
    implPackage?: string;
    log?: Log;
}

/**
 * Upgrade the live resolver in place through the registry: new implementation
 * at a fresh CREATE2 salt, then `upgradeResolver`. One upgrade reaches every
 * name ever published. Idempotent like {@link upgradeRegistryImplementation}.
 */
export async function upgradeResolverImplementation(
    deployer: ContractDeployer,
    opts: UpgradeResolverOptions,
): Promise<{
    resolverAddress: string;
    implAddress: string;
    implPackage?: string;
    upgraded: boolean;
}> {
    const log = opts.log ?? (() => {});
    const registry = await opts.registryContract(opts.registryAddress);
    const resolverAddress = String(
        await expectQuery(registry.getResolver.query(), "getResolver()"),
    );
    if (resolverAddress.toLowerCase() === ZERO_ADDRESS) {
        throw new Error(
            `Registry ${opts.registryAddress} has no resolver yet — run the deploy first.`,
        );
    }
    const resolver = await opts.resolverContract(resolverAddress);
    const implCode = evmCreationCode(opts.resolverArtifactPath);

    const liveAddress = String(await expectQuery(resolver.getCode.query(), "getCode()"));
    if (
        await createdFrom(
            deployer,
            liveAddress,
            implCode,
            CONTRACTS_RESOLVER_IMPL_PACKAGE,
            opts.implPackage,
        )
    ) {
        log(
            `Resolver implementation at ${liveAddress} already matches ${opts.resolverArtifactPath}`,
        );
        return { resolverAddress, implAddress: liveAddress, upgraded: false };
    }

    const { implAddress, implPackage } = await deployAtFreeSalt(
        deployer,
        implCode,
        CONTRACTS_RESOLVER_IMPL_PACKAGE,
        opts.implPackage,
        "Resolver implementation",
        log,
    );
    await submit(registry.upgradeResolver.tx(implAddress), "upgradeResolver");
    await verifyAddress(resolver.getCode.query(), implAddress, "upgradeResolver");
    log(`Resolver ${resolverAddress} now delegates to ${implAddress}`);
    return { resolverAddress, implAddress, implPackage, upgraded: true };
}

if (import.meta.vitest) {
    const { describe, test, expect } = import.meta.vitest;

    describe("encodeProxyConstructorArgs", () => {
        test("encodes (implementation, admin) as two left-padded words", () => {
            const encoded = encodeProxyConstructorArgs(
                "0x1111111111111111111111111111111111111111",
                "0x2222222222222222222222222222222222222222",
            );
            expect(encoded.length).toBe(64);
            expect(Array.from(encoded.slice(0, 12))).toEqual(new Array(12).fill(0));
            expect(Array.from(encoded.slice(12, 32))).toEqual(new Array(20).fill(0x11));
            expect(Array.from(encoded.slice(32, 44))).toEqual(new Array(12).fill(0));
            expect(Array.from(encoded.slice(44))).toEqual(new Array(20).fill(0x22));
        });

        test("rejects malformed addresses", () => {
            expect(() => encodeProxyConstructorArgs("0x1234", "0x1234")).toThrow();
            expect(() =>
                encodeProxyConstructorArgs(
                    "0x1111111111111111111111111111111111111111",
                    "not-an-address",
                ),
            ).toThrow();
        });
    });

    describe("bumpPackageSuffix", () => {
        test("bumps the numeric suffix, including across digit widths", () => {
            expect(bumpPackageSuffix("@cdm/registry-impl.1")).toBe("@cdm/registry-impl.2");
            expect(bumpPackageSuffix("@cdm/registry-impl.9")).toBe("@cdm/registry-impl.10");
            expect(bumpPackageSuffix("@cdm/registry-impl.10")).toBe("@cdm/registry-impl.11");
        });

        test("bumps only the trailing dot-separated number", () => {
            expect(bumpPackageSuffix("@cdm/registry.2")).toBe("@cdm/registry.3");
            expect(bumpPackageSuffix("@cdm/a.1.5")).toBe("@cdm/a.1.6");
        });

        test("rejects packages without a numeric suffix", () => {
            expect(() => bumpPackageSuffix("@cdm/registry-impl")).toThrow(/suffix/);
            expect(() => bumpPackageSuffix("@cdm/registry-impl.")).toThrow(/suffix/);
            expect(() => bumpPackageSuffix("@cdm/registry-impl.1x")).toThrow(/suffix/);
        });
    });

    describe("predictRegistryDeploy", () => {
        const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
        const fakeDeployer = {
            signer: { publicKey: new Uint8Array(32).fill(0x11) },
        } as unknown as ContractDeployer;
        const dir = mkdtempSync(resolve(tmpdir(), "cdm-registry-artifacts-"));
        const forgeArtifact = (name: string, bytecode: string) => {
            const path = resolve(dir, `${name}.json`);
            writeFileSync(path, JSON.stringify({ bytecode: { object: bytecode } }));
            return path;
        };
        // The committed CREATE3 child blob stands in for the PVM blobs.
        const blob = resolve(repoRoot, "src/contract/create3/artifacts/create3-child.polkavm");
        const artifacts = (registry: string, resolver: string): RegistryArtifacts => ({
            registryArtifactPath: forgeArtifact(`registry-${registry}`, `0x${registry}`),
            resolverArtifactPath: forgeArtifact(`resolver-${resolver}`, `0x${resolver}`),
            eip1967ProxyPvmPath: blob,
            shimFactoryPvmPath: blob,
        });

        test("is deterministic and internally consistent", () => {
            const a = predictRegistryDeploy(fakeDeployer, repoRoot, artifacts("6001", "6002"));
            const b = predictRegistryDeploy(fakeDeployer, repoRoot, artifacts("6001", "6002"));
            expect(a).toEqual(b);
            expect(a.registryAddress).toBe(
                predictCreate3Address(
                    a.factoryAddress,
                    hexToBytes(computeDeploySalt(CONTRACTS_REGISTRY_PACKAGE)),
                ),
            );
            expect(a.resolverAddress).toBe(
                predictCreate3Address(
                    a.factoryAddress,
                    hexToBytes(computeDeploySalt(CONTRACTS_RESOLVER_PACKAGE)),
                ),
            );
            // Registry proxy: word 0 = implementation, word 1 = the deployer EOA.
            expect(a.constructorData.length).toBe(64);
            expect(Array.from(a.constructorData.slice(12, 32))).toEqual(
                Array.from(hexToBytes(a.implAddress)),
            );
            expect(Array.from(a.constructorData.slice(44))).toEqual(
                Array.from(hexToBytes(eoaH160FromPublicKey(fakeDeployer.signer.publicKey))),
            );
            // Resolver proxy: word 0 = resolver implementation, word 1 = the registry.
            expect(Array.from(a.resolverConstructorData.slice(12, 32))).toEqual(
                Array.from(hexToBytes(a.resolverImplAddress)),
            );
            expect(Array.from(a.resolverConstructorData.slice(44))).toEqual(
                Array.from(hexToBytes(a.registryAddress)),
            );
        });

        test("proxy addresses are bytecode-independent of the implementations", () => {
            const a = predictRegistryDeploy(fakeDeployer, repoRoot, artifacts("6001", "6002"));
            const b = predictRegistryDeploy(fakeDeployer, repoRoot, artifacts("6002", "6001"));
            expect(b.factoryAddress).toBe(a.factoryAddress);
            expect(b.registryAddress).toBe(a.registryAddress);
            expect(b.resolverAddress).toBe(a.resolverAddress);
            expect(b.implAddress).not.toBe(a.implAddress);
            expect(b.resolverImplAddress).not.toBe(a.resolverImplAddress);
        });

        test("the registry implementation address commits to the shim factory", () => {
            const base = artifacts("6001", "6002");
            const a = predictRegistryDeploy(fakeDeployer, repoRoot, base);
            const b = predictRegistryDeploy(fakeDeployer, repoRoot, {
                ...base,
                shimFactoryPvmPath: resolve(
                    repoRoot,
                    "src/contract/create3/artifacts/create3-factory.polkavm",
                ),
            });
            expect(b.implAddress).not.toBe(a.implAddress);
        });
    });
}
