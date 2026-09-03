import { readFileSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import {
    CONTRACTS_REGISTRY_IMPL_PACKAGE,
    CONTRACTS_REGISTRY_PACKAGE,
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
 * ContractRegistry deployment via the CREATE3 factory:
 *
 * 1. CREATE3 factory (frozen artifact) — plain CREATE2 from the operator's
 *    EOA with the committed child code hash as constructor arg and the
 *    `CREATE3_FACTORY_PACKAGE` salt.
 * 2. Registry implementation — plain CREATE2 (`CONTRACTS_REGISTRY_IMPL_PACKAGE`);
 *    its address is irrelevant, upgrades go through `setCode`.
 * 3. EIP-1967 proxy — through the factory, so the registry address is a pure
 *    function of `(factory, salt)` and survives proxy bytecode or constructor
 *    changes.
 * 4. Per-name proxy blob (frozen artifact) — uploaded and handed to the
 *    registry via `setProxyCodeHash`; never instantiated here.
 */

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

export interface RegistryDeployPrediction {
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
 * Predict every address of the registry deployment fully offline — no chain
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
    const implAddress = predictReviveCreate2Address(
        eoa,
        new Uint8Array(readFileSync(implPvmPath)),
        new Uint8Array(0),
        hexToBytes(computeDeploySalt(CONTRACTS_REGISTRY_IMPL_PACKAGE)),
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
    };
}

export interface DeployRegistryOptions {
    /** contract-dependency-manager checkout root (for the frozen artifacts). */
    rootDir: string;
    implPvmPath: string;
    proxyPvmPath: string;
    /**
     * Build a product-sdk contract handle for the CREATE3 factory at the
     * given address (`CREATE3_FACTORY_ABI`); registry-deploy stays free of
     * chain-descriptor knowledge this way.
     */
    factoryContract: (
        factoryAddress: string,
    ) => Contract<ContractDef> | Promise<Contract<ContractDef>>;
    /**
     * Registry handle (`CONTRACTS_REGISTRY_ABI` at the proxy address) with the
     * admin signer, for `setProxyCodeHash`. When omitted, first publishes fail
     * with `ProxyCodeHashUnset()` until a later run sets it.
     */
    registryContract?: (
        registryAddress: string,
    ) => Contract<ContractDef> | Promise<Contract<ContractDef>>;
    /** Reuse a prior {@link predictRegistryDeploy} result. */
    prediction?: RegistryDeployPrediction;
    log?: (message: string) => void;
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

/** Upload the frozen per-name proxy blob and set `proxyCodeHash`; idempotent. */
async function ensureProxyCodeHash(
    deployer: ContractDeployer,
    registry: Contract<ContractDef>,
    rootDir: string,
    log: (message: string) => void,
): Promise<`0x${string}`> {
    const artifact = loadContractProxyArtifact(rootDir);
    await deployer.uploadCode(artifact.bytes);

    const current = await registry.getProxyCodeHash.query();
    if (!current.success) {
        throw new Error(
            `getProxyCodeHash() failed: ${queryErrorDetail(current.value)} — ` +
                "the live implementation may be a pre-versioning build; upgrade it first.",
        );
    }
    if (hashHex(current.value) === artifact.codeHash) {
        log(`Per-name proxy code hash already set to ${artifact.codeHash}`);
        return artifact.codeHash;
    }

    const result = await registry.setProxyCodeHash.tx(artifact.codeHash);
    if (!result.ok) {
        throw new Error(`setProxyCodeHash failed: ${describeContractError(result.error)}`, {
            cause: result.error,
        });
    }
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
 * Deploy the registry behind its proxy (factory first if missing), then set
 * `proxyCodeHash` when `registryContract` is provided. Every step is
 * idempotent, so a partial run can be re-run. `proxyAddress` is the registry
 * address.
 */
export async function deployRegistryWithProxy(
    deployer: ContractDeployer,
    opts: DeployRegistryOptions,
): Promise<{
    factoryAddress: string;
    implAddress: string;
    proxyAddress: string;
    /** Frozen per-name proxy code hash; undefined when the setup was skipped. */
    proxyCodeHash?: `0x${string}`;
}> {
    const log = opts.log ?? (() => {});
    const plan = opts.prediction ?? predictRegistryDeploy(deployer, opts.rootDir, opts.implPvmPath);
    const done = {
        factoryAddress: plan.factoryAddress,
        implAddress: plan.implAddress,
        proxyAddress: plan.registryAddress,
    };
    const finishProxyCodeHash = async (): Promise<`0x${string}` | undefined> => {
        if (!opts.registryContract) return undefined;
        const registry = await opts.registryContract(plan.registryAddress);
        return ensureProxyCodeHash(deployer, registry, opts.rootDir, log);
    };

    // Code at the CREATE3 address means the deployment already happened.
    if ((await deployer.getOnChainCode(plan.registryAddress)) !== null) {
        log(`Registry already deployed at ${plan.registryAddress}`);
        return { ...done, proxyCodeHash: await finishProxyCodeHash() };
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
    if ((await deployer.getOnChainCode(plan.implAddress)) === null) {
        const { address } = await deployer.deploy(
            opts.implPvmPath,
            CONTRACTS_REGISTRY_IMPL_PACKAGE,
        );
        if (address.toLowerCase() !== plan.implAddress.toLowerCase()) {
            throw new Error(
                `Registry implementation address mismatch: deployed ${address}, offline prediction says ${plan.implAddress}`,
            );
        }
    }

    // (iii) The proxy, through the factory.
    const proxyCode = new Uint8Array(readFileSync(opts.proxyPvmPath));
    const { codeHash: registryProxyCodeHash } = await deployer.uploadCode(proxyCode);
    const factory = await opts.factoryContract(plan.factoryAddress);
    await deployer.deployViaCreate3Factory(
        factory,
        plan.factoryAddress,
        computeDeploySalt(CONTRACTS_REGISTRY_PACKAGE),
        registryProxyCodeHash,
        plan.constructorData,
    );

    // (iv) Per-name proxy code hash.
    return { ...done, proxyCodeHash: await finishProxyCodeHash() };
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

/** First suffix bump of `CONTRACTS_REGISTRY_IMPL_PACKAGE` whose predicted address holds no code. */
async function resolveFreeImplPackage(
    deployer: ContractDeployer,
    implCode: Uint8Array,
    log: (message: string) => void,
): Promise<{ implPackage: string; address: string }> {
    let implPackage = CONTRACTS_REGISTRY_IMPL_PACKAGE;
    for (let probes = 0; probes < MAX_IMPL_SALT_PROBES; probes++) {
        const address = predictImplAddress(deployer, implCode, implPackage);
        if ((await deployer.getOnChainCode(address)) === null) {
            return { implPackage, address };
        }
        log(`Implementation salt "${implPackage}" already consumed at ${address} — bumping`);
        implPackage = bumpPackageSuffix(implPackage);
    }
    throw new Error(
        `No free implementation salt within ${MAX_IMPL_SALT_PROBES} bumps of ` +
            `"${CONTRACTS_REGISTRY_IMPL_PACKAGE}"`,
    );
}

export interface UpgradeRegistryOptions {
    /** contract-dependency-manager checkout root (for the frozen artifacts). */
    rootDir: string;
    /** The NEW implementation blob to upgrade to. */
    implPvmPath: string;
    /** Address of the live registry proxy being upgraded. */
    registryAddress: string;
    /** Registry handle with the admin signer (`setCode`/`setProxyCodeHash` are admin-only). */
    registryContract: (
        registryAddress: string,
    ) => Contract<ContractDef> | Promise<Contract<ContractDef>>;
    /** Salt package for the new blob; default: first free suffix bump of `CONTRACTS_REGISTRY_IMPL_PACKAGE`. */
    implPackage?: string;
    log?: (message: string) => void;
}

/**
 * Upgrade a live registry in place: new implementation at a fresh CREATE2
 * salt, `setCode`, then `proxyCodeHash`. Idempotent — a matching live
 * implementation skips the deploy and `setCode` (`upgraded: false`).
 */
export async function upgradeRegistryImplementation(
    deployer: ContractDeployer,
    opts: UpgradeRegistryOptions,
): Promise<{
    implAddress: string;
    /** Salt package the new blob was deployed under; undefined when skipped. */
    implPackage?: string;
    proxyCodeHash: `0x${string}`;
    upgraded: boolean;
}> {
    const log = opts.log ?? (() => {});
    const registry = await opts.registryContract(opts.registryAddress);
    const implCode = new Uint8Array(readFileSync(opts.implPvmPath));

    const live = await registry.getCode.query();
    if (!live.success) {
        throw new Error(`getCode() failed: ${queryErrorDetail(live.value)}`);
    }
    const liveAddress = String(live.value);
    const liveCode = await deployer.getOnChainCode(liveAddress);
    if (liveCode !== null && keccakCodeHash(liveCode) === keccakCodeHash(implCode)) {
        log(`Implementation at ${liveAddress} already matches ${opts.implPvmPath}`);
        const proxyCodeHash = await ensureProxyCodeHash(deployer, registry, opts.rootDir, log);
        return { implAddress: liveAddress, proxyCodeHash, upgraded: false };
    }

    let implPackage: string;
    let implAddress: string;
    let alreadyDeployed = false;
    if (opts.implPackage !== undefined) {
        implPackage = opts.implPackage;
        implAddress = predictImplAddress(deployer, implCode, implPackage);
        // CREATE2 commits to the code, so code at this address is this blob.
        alreadyDeployed = (await deployer.getOnChainCode(implAddress)) !== null;
    } else {
        ({ implPackage, address: implAddress } = await resolveFreeImplPackage(
            deployer,
            implCode,
            log,
        ));
    }

    if (alreadyDeployed) {
        log(`Implementation already deployed at ${implAddress} (salt "${implPackage}")`);
    } else {
        const { address } = await deployer.deploy(implCode, implPackage);
        if (address.toLowerCase() !== implAddress.toLowerCase()) {
            throw new Error(
                `Implementation address mismatch: deployed ${address}, offline prediction says ${implAddress}`,
            );
        }
        log(`New implementation deployed at ${implAddress} (salt "${implPackage}")`);
    }

    const setResult = await registry.setCode.tx(implAddress);
    if (!setResult.ok) {
        throw new Error(`setCode failed: ${describeContractError(setResult.error)}`, {
            cause: setResult.error,
        });
    }
    const verify = await registry.getCode.query();
    if (!verify.success || String(verify.value).toLowerCase() !== implAddress.toLowerCase()) {
        throw new Error(
            `setCode verification failed: getCode() returned ${
                verify.success ? String(verify.value) : queryErrorDetail(verify.value)
            }, expected ${implAddress}`,
        );
    }
    log(`Registry ${opts.registryAddress} now delegates to ${implAddress}`);

    const proxyCodeHash = await ensureProxyCodeHash(deployer, registry, opts.rootDir, log);
    return { implAddress, implPackage, proxyCodeHash, upgraded: true };
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
        // The committed child blob doubles as a stand-in implementation blob.
        const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
        const fakeDeployer = {
            signer: { publicKey: new Uint8Array(32).fill(0x11) },
        } as unknown as ContractDeployer;
        const implPvmPath = resolve(
            repoRoot,
            "src/contract/create3/artifacts/create3-child.polkavm",
        );

        test("is deterministic and internally consistent", () => {
            const a = predictRegistryDeploy(fakeDeployer, repoRoot, implPvmPath);
            const b = predictRegistryDeploy(fakeDeployer, repoRoot, implPvmPath);
            expect(a).toEqual(b);
            expect(a.registryAddress).toBe(
                predictCreate3Address(
                    a.factoryAddress,
                    hexToBytes(computeDeploySalt(CONTRACTS_REGISTRY_PACKAGE)),
                ),
            );
            // word 0 = implementation, word 1 = admin (the deployer EOA).
            expect(a.constructorData.length).toBe(64);
            expect(Array.from(a.constructorData.slice(12, 32))).toEqual(
                Array.from(hexToBytes(a.implAddress)),
            );
            expect(Array.from(a.constructorData.slice(44))).toEqual(
                Array.from(hexToBytes(eoaH160FromPublicKey(fakeDeployer.signer.publicKey))),
            );
        });

        test("factory (and thus registry) address is bytecode-independent of the impl", () => {
            const otherImplPath = resolve(
                repoRoot,
                "src/contract/create3/artifacts/create3-factory.polkavm",
            );
            const a = predictRegistryDeploy(fakeDeployer, repoRoot, implPvmPath);
            const b = predictRegistryDeploy(fakeDeployer, repoRoot, otherImplPath);
            expect(b.factoryAddress).toBe(a.factoryAddress);
            expect(b.registryAddress).toBe(a.registryAddress);
            expect(b.implAddress).not.toBe(a.implAddress);
        });
    });
}
