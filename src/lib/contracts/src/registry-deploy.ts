import { readFileSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import {
    CONTRACTS_REGISTRY_IMPL_PACKAGE,
    CONTRACTS_REGISTRY_PACKAGE,
    CONTRACTS_RESOLVER_IMPL_PACKAGE,
    CONTRACTS_RESOLVER_PACKAGE,
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
    keccakCodeHash,
    loadCreate3ChildArtifact,
    loadCreate3FactoryArtifact,
    predictCreate3Address,
    predictReviveCreate2Address,
} from "./create3";
import { loadContractProxyArtifact } from "./proxy-artifacts";
import { hexToBytes } from "./solidity";

/**
 * CDM's on-chain bootstrap via the CREATE3 factory:
 *
 * 1. CREATE3 factory (frozen artifact) — plain CREATE2 from the operator's
 *    EOA with the committed child code hash as constructor arg and the
 *    `CREATE3_FACTORY_PACKAGE` salt.
 * 2. Registry implementation — plain CREATE2 (`CONTRACTS_REGISTRY_IMPL_PACKAGE`);
 *    its address is irrelevant, upgrades go through `setCode`.
 * 3. Registry proxy (EIP-1967) — through the factory, so the registry address
 *    is a pure function of `(factory, salt)` and survives proxy bytecode or
 *    constructor changes.
 * 4. Resolver implementation — plain CREATE2 (`CONTRACTS_RESOLVER_IMPL_PACKAGE`).
 * 5. Resolver proxy (the same EIP-1967 blob) — through the factory with the
 *    registry as admin, then handed to the registry via `setResolver`.
 * 6. Per-name shim blob (frozen artifact) — uploaded and handed to the
 *    registry via `setProxyCodeHash`; never instantiated here.
 */

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

function predictImplAddress(
    deployer: ContractDeployer,
    implCode: Uint8Array,
    implPackage: string,
): string {
    return predictReviveCreate2Address(
        eoaH160FromPublicKey(deployer.signer.publicKey),
        implCode,
        new Uint8Array(0),
        hexToBytes(computeDeploySalt(implPackage)),
    );
}

export interface ResolverDeployPrediction {
    /** CREATE2 address of the resolver implementation blob. */
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
    resolverImplPvmPath: string,
): ResolverDeployPrediction {
    const resolverImplAddress = predictImplAddress(
        deployer,
        readBlob(resolverImplPvmPath),
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
    /** CREATE2 address of the registry implementation blob. */
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
    implPvmPath: string,
    resolverImplPvmPath: string,
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
    const implAddress = predictImplAddress(
        deployer,
        readBlob(implPvmPath),
        CONTRACTS_REGISTRY_IMPL_PACKAGE,
    );
    const registryAddress = predictCreate3Address(
        factoryAddress,
        hexToBytes(computeDeploySalt(CONTRACTS_REGISTRY_PACKAGE)),
    );
    return {
        factoryAddress,
        implAddress,
        registryAddress,
        constructorData: encodeProxyConstructorArgs(implAddress, eoa),
        ...predictResolverDeploy(deployer, factoryAddress, registryAddress, resolverImplPvmPath),
    };
}

/** The blobs and handles every resolver step needs. */
interface ResolverSetup {
    /** contract-dependency-manager checkout root (for the frozen artifacts). */
    rootDir: string;
    /** The EIP-1967 proxy blob, shared by the registry and the resolver. */
    eip1967ProxyPvmPath: string;
    resolverImplPvmPath: string;
    /**
     * Build a product-sdk contract handle for the CREATE3 factory at the
     * given address (`CREATE3_FACTORY_ABI`); registry-deploy stays free of
     * chain-descriptor knowledge this way.
     */
    factoryContract: ContractHandle;
}

export interface DeployRegistryOptions extends ResolverSetup {
    implPvmPath: string;
    /**
     * Registry handle (`CONTRACTS_REGISTRY_ABI` at the proxy address) with the
     * admin signer, for `setResolver` / `setProxyCodeHash`. When omitted, the
     * resolver is not deployed and first publishes fail until a later run.
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

/** CREATE2-deploy `code` under `implPackage` unless its address already holds code. */
async function ensureImplementation(
    deployer: ContractDeployer,
    code: Uint8Array,
    implPackage: string,
    log: Log,
): Promise<string> {
    const address = predictImplAddress(deployer, code, implPackage);
    if ((await deployer.getOnChainCode(address)) !== null) {
        log(`Implementation already deployed at ${address} (salt "${implPackage}")`);
        return address;
    }
    const deployed = await deployer.deploy(code, implPackage);
    if (deployed.address.toLowerCase() !== address.toLowerCase()) {
        throw new Error(
            `Implementation address mismatch: deployed ${deployed.address}, offline prediction says ${address}`,
        );
    }
    log(`Implementation deployed at ${address} (salt "${implPackage}")`);
    return address;
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
    const { codeHash } = await deployer.uploadCode(readBlob(setup.eip1967ProxyPvmPath));
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
    const plan = predictResolverDeploy(
        deployer,
        factoryAddress,
        registryAddress,
        setup.resolverImplPvmPath,
    );
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

    await ensureImplementation(
        deployer,
        readBlob(setup.resolverImplPvmPath),
        CONTRACTS_RESOLVER_IMPL_PACKAGE,
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

/** Upload the frozen per-name shim blob and set `proxyCodeHash`; idempotent. */
async function ensureProxyCodeHash(
    deployer: ContractDeployer,
    registry: Contract<ContractDef>,
    rootDir: string,
    log: Log,
): Promise<`0x${string}`> {
    const artifact = loadContractProxyArtifact(rootDir);
    await deployer.uploadCode(artifact.bytes);

    const current = await expectQuery(
        registry.getProxyCodeHash.query(),
        "getProxyCodeHash() (the live implementation may be a pre-versioning build; upgrade it first)",
    );
    if (hashHex(current) === artifact.codeHash) {
        log(`Per-name proxy code hash already set to ${artifact.codeHash}`);
        return artifact.codeHash;
    }

    await submit(registry.setProxyCodeHash.tx(artifact.codeHash), "setProxyCodeHash");
    const verify = await registry.getProxyCodeHash.query();
    const verified = verify.success ? hashHex(verify.value) : undefined;
    if (verified !== artifact.codeHash) {
        throw new Error(
            `setProxyCodeHash verification failed: getProxyCodeHash() returned ${
                verify.success ? verified : queryErrorDetail(verify.value)
            }, expected ${artifact.codeHash}`,
        );
    }
    log(`Per-name proxy code hash set to ${artifact.codeHash}`);
    return artifact.codeHash;
}

/**
 * Deploy the registry behind its proxy (factory first if missing), then the
 * resolver and `proxyCodeHash` when `registryContract` is provided. Every
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
    const plan =
        opts.prediction ??
        predictRegistryDeploy(deployer, opts.rootDir, opts.implPvmPath, opts.resolverImplPvmPath);
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
        const proxyCodeHash = await ensureProxyCodeHash(deployer, registry, opts.rootDir, log);
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

    // (ii) Registry implementation — plain CREATE2.
    await ensureImplementation(
        deployer,
        readBlob(opts.implPvmPath),
        CONTRACTS_REGISTRY_IMPL_PACKAGE,
        log,
    );

    // (iii) The registry proxy, through the factory.
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
 * Deploy `code` under `implPackage`, or under the first suffix bump of
 * `basePackage` whose predicted address holds no code.
 */
async function deployAtFreeSalt(
    deployer: ContractDeployer,
    code: Uint8Array,
    basePackage: string,
    implPackage: string | undefined,
    log: Log,
): Promise<{ implAddress: string; implPackage: string }> {
    if (implPackage !== undefined) {
        // CREATE2 commits to the code, so code at this address is this blob.
        return {
            implAddress: await ensureImplementation(deployer, code, implPackage, log),
            implPackage,
        };
    }
    let candidate = basePackage;
    for (let probes = 0; probes < MAX_IMPL_SALT_PROBES; probes++) {
        const address = predictImplAddress(deployer, code, candidate);
        if ((await deployer.getOnChainCode(address)) === null) {
            return {
                implAddress: await ensureImplementation(deployer, code, candidate, log),
                implPackage: candidate,
            };
        }
        log(`Implementation salt "${candidate}" already consumed at ${address} — bumping`);
        candidate = bumpPackageSuffix(candidate);
    }
    throw new Error(
        `No free implementation salt within ${MAX_IMPL_SALT_PROBES} bumps of "${basePackage}"`,
    );
}

/** Whether the contract at `address` runs exactly `code`. */
async function liveCodeMatches(
    deployer: ContractDeployer,
    address: string,
    code: Uint8Array,
): Promise<boolean> {
    const live = await deployer.getOnChainCode(address);
    return live !== null && keccakCodeHash(live) === keccakCodeHash(code);
}

export interface UpgradeRegistryOptions extends ResolverSetup {
    /** The NEW implementation blob to upgrade to. */
    implPvmPath: string;
    /** Address of the live registry proxy being upgraded. */
    registryAddress: string;
    /** Registry handle with the admin signer (`setCode` and the setup writes are admin-only). */
    registryContract: ContractHandle;
    /** Salt package for the new blob; default: first free suffix bump of `CONTRACTS_REGISTRY_IMPL_PACKAGE`. */
    implPackage?: string;
    log?: Log;
}

/**
 * Upgrade a live registry in place: new implementation at a fresh CREATE2
 * salt, `setCode`, then the resolver and `proxyCodeHash` are ensured.
 * Idempotent — a matching live implementation skips the deploy and `setCode`
 * (`upgraded: false`).
 */
export async function upgradeRegistryImplementation(
    deployer: ContractDeployer,
    opts: UpgradeRegistryOptions,
): Promise<{
    implAddress: string;
    /** Salt package the new blob was deployed under; undefined when skipped. */
    implPackage?: string;
    resolverAddress: string;
    proxyCodeHash: `0x${string}`;
    upgraded: boolean;
}> {
    const log = opts.log ?? (() => {});
    const registry = await opts.registryContract(opts.registryAddress);
    const implCode = readBlob(opts.implPvmPath);

    const finish = async (implAddress: string, implPackage?: string, upgraded = false) => {
        const factoryAddress = predictRegistryDeploy(
            deployer,
            opts.rootDir,
            opts.implPvmPath,
            opts.resolverImplPvmPath,
        ).factoryAddress;
        const resolverAddress = await ensureResolver(
            deployer,
            registry,
            opts.registryAddress,
            factoryAddress,
            opts,
            log,
        );
        const proxyCodeHash = await ensureProxyCodeHash(deployer, registry, opts.rootDir, log);
        return { implAddress, implPackage, resolverAddress, proxyCodeHash, upgraded };
    };

    const liveAddress = String(await expectQuery(registry.getCode.query(), "getCode()"));
    if (await liveCodeMatches(deployer, liveAddress, implCode)) {
        log(`Implementation at ${liveAddress} already matches ${opts.implPvmPath}`);
        return finish(liveAddress);
    }

    const { implAddress, implPackage } = await deployAtFreeSalt(
        deployer,
        implCode,
        CONTRACTS_REGISTRY_IMPL_PACKAGE,
        opts.implPackage,
        log,
    );
    await submit(registry.setCode.tx(implAddress), "setCode");
    await verifyAddress(registry.getCode.query(), implAddress, "setCode");
    log(`Registry ${opts.registryAddress} now delegates to ${implAddress}`);
    return finish(implAddress, implPackage, true);
}

export interface UpgradeResolverOptions {
    /** The NEW resolver implementation blob to upgrade to. */
    resolverImplPvmPath: string;
    /** Address of the live registry proxy, the resolver's admin. */
    registryAddress: string;
    /** Registry handle with the admin signer (`upgradeResolver` is admin-only). */
    registryContract: ContractHandle;
    /** Resolver handle (`CONTRACT_RESOLVER_ABI`) for the verifying reads. */
    resolverContract: ContractHandle;
    /** Salt package for the new blob; default: first free suffix bump of `CONTRACTS_RESOLVER_IMPL_PACKAGE`. */
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
    const implCode = readBlob(opts.resolverImplPvmPath);

    const liveAddress = String(await expectQuery(resolver.getCode.query(), "getCode()"));
    if (await liveCodeMatches(deployer, liveAddress, implCode)) {
        log(
            `Resolver implementation at ${liveAddress} already matches ${opts.resolverImplPvmPath}`,
        );
        return { resolverAddress, implAddress: liveAddress, upgraded: false };
    }

    const { implAddress, implPackage } = await deployAtFreeSalt(
        deployer,
        implCode,
        CONTRACTS_RESOLVER_IMPL_PACKAGE,
        opts.implPackage,
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
        // The committed CREATE3 blobs double as stand-in implementation blobs.
        const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
        const fakeDeployer = {
            signer: { publicKey: new Uint8Array(32).fill(0x11) },
        } as unknown as ContractDeployer;
        const implPvmPath = resolve(
            repoRoot,
            "src/contract/create3/artifacts/create3-child.polkavm",
        );
        const otherPvmPath = resolve(
            repoRoot,
            "src/contract/create3/artifacts/create3-factory.polkavm",
        );

        test("is deterministic and internally consistent", () => {
            const a = predictRegistryDeploy(fakeDeployer, repoRoot, implPvmPath, otherPvmPath);
            const b = predictRegistryDeploy(fakeDeployer, repoRoot, implPvmPath, otherPvmPath);
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
            const a = predictRegistryDeploy(fakeDeployer, repoRoot, implPvmPath, otherPvmPath);
            const b = predictRegistryDeploy(fakeDeployer, repoRoot, otherPvmPath, implPvmPath);
            expect(b.factoryAddress).toBe(a.factoryAddress);
            expect(b.registryAddress).toBe(a.registryAddress);
            expect(b.resolverAddress).toBe(a.resolverAddress);
            expect(b.implAddress).not.toBe(a.implAddress);
            expect(b.resolverImplAddress).not.toBe(a.resolverImplAddress);
        });
    });
}
