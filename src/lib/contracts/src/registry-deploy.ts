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
 * ContractRegistry deployment via the CREATE3 factory.
 *
 * Three blobs are involved:
 *
 * 1. The CREATE3 FACTORY (frozen artifact) — deployed once per network with
 *    plain CREATE2 from the operator's EOA, using the committed factory blob,
 *    the committed child code hash as its single constructor argument, and
 *    the fixed `CREATE3_FACTORY_PACKAGE` salt. Same EOA => same factory
 *    address on every network.
 * 2. The registry IMPLEMENTATION — plain CREATE2 with the
 *    `CONTRACTS_REGISTRY_IMPL_PACKAGE` salt. Its address doesn't matter;
 *    upgrades go through the registry's `setCode(address)` (called via the
 *    proxy by the admin — the proxy's deployer), never a proxy redeploy.
 * 3. The EIP-1967 PROXY — deployed THROUGH the factory
 *    (`upload_code` + `factory.deploy(salt, proxyCodeHash, implAddress)`).
 *    The resulting address is the stable registry address every consumer
 *    uses, and it is a pure function of `(factory, salt)`: unlike plain
 *    CREATE2 under pallet-revive (which commits to both the code and the
 *    constructor input), a CREATE3 address survives proxy bytecode changes
 *    and doesn't depend on the implementation address baked into the
 *    constructor data.
 * 4. The PER-NAME proxy (frozen artifact, never instantiated here) — its
 *    blob is uploaded and its code hash handed to the registry via
 *    `setProxyCodeHash`, so the registry can CREATE2 one proxy per contract
 *    name at first publish.
 *
 * Implementation upgrades go through {@link upgradeRegistryImplementation}:
 * a NEW implementation blob at a fresh CREATE2 salt + `setCode` through the
 * proxy — the registry address never moves.
 */

/**
 * ABI-encode the proxy's constructor arguments `(address implementation,
 * address admin)` — two 32-byte left-padded words.
 *
 * `admin` must be an explicit argument (not derived from the deploy caller):
 * through the CREATE3 factory, the proxy constructor's on-chain caller is
 * the single-use child deployer, and pinning admin to it would lock the
 * registry's admin surface to a dead contract.
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
     * Build a product-sdk registry handle (implementation ABI at the proxy
     * address, `CONTRACTS_REGISTRY_ABI`) with the admin signer attached —
     * used to run `setProxyCodeHash`/`getProxyCodeHash` once the proxy is
     * live. Optional for backward compatibility: when omitted, the per-name
     * proxy code hash setup is skipped and first publishes will fail with
     * `ProxyCodeHashUnset()` until {@link upgradeRegistryImplementation}
     * (or a re-run with this callback) sets it.
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

/**
 * Normalize a decoded `bytes32` return into lowercase 0x-hex. Codec paths
 * differ in how they surface fixed byte arrays (hex string, raw bytes, or a
 * Binary-like wrapper with `asHex()`).
 */
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

/**
 * Upload the frozen per-name proxy blob and point the registry's
 * `proxyCodeHash` at it, verifying with `getProxyCodeHash()`. Idempotent:
 * the upload is skipped when the code already exists on-chain, and
 * `setProxyCodeHash` is skipped when the registry already returns the
 * frozen hash.
 */
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
 * Deploy the ContractRegistry behind its proxy, bootstrapping the CREATE3
 * factory first when the network doesn't have it yet, then (when
 * `registryContract` is provided) uploading the frozen per-name proxy blob
 * and setting the registry's `proxyCodeHash`. Every step is idempotent
 * (skipped when its output already exists on-chain), so a partially-failed
 * earlier run can simply be re-run.
 *
 * Returns all three addresses; `proxyAddress` is the registry address.
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

    // The registry address depends only on (factory, salt) — if a contract
    // already lives there, the deployment already happened; only the
    // (idempotent) per-name proxy code hash setup may still be pending.
    if ((await deployer.getOnChainCode(plan.registryAddress)) !== null) {
        log(`Registry already deployed at ${plan.registryAddress}`);
        return { ...done, proxyCodeHash: await finishProxyCodeHash() };
    }

    // (i) Ensure the CREATE3 factory: upload the frozen child blob (the
    // factory instantiates it by code hash), then CREATE2 the frozen factory
    // blob with the committed child code hash as constructor arg.
    if ((await deployer.getOnChainCode(plan.factoryAddress)) === null) {
        const factoryArtifact = loadCreate3FactoryArtifact(opts.rootDir);
        const childArtifact = loadCreate3ChildArtifact(opts.rootDir);
        const constructorData = hexToBytes(childArtifact.codeHash);

        await deployer.uploadCode(childArtifact.bytes);

        // Cross-check the offline CREATE2 prediction against the node's own
        // derivation before submitting anything.
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

    // (ii) Registry implementation — plain CREATE2, exactly as before the
    // CREATE3 flow. Skipped when its address is already a contract.
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

    // (iii) The proxy, THROUGH the factory: upload its code, then
    // factory.deploy(salt, codeHash, abi-encoded impl address).
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

    // (iv) With the registry live, upload the frozen per-name proxy blob and
    // hand the registry its code hash for first-publish CREATE2s.
    return { ...done, proxyCodeHash: await finishProxyCodeHash() };
}

/**
 * Bump the numeric suffix of a salt package string:
 * `"@cdm/registry-impl.1"` → `"@cdm/registry-impl.2"`. Used to find a fresh
 * CREATE2 salt for a new registry implementation build when earlier
 * suffixes are already consumed on the target chain.
 */
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

/**
 * First salt package, starting from `CONTRACTS_REGISTRY_IMPL_PACKAGE` and
 * bumping the numeric suffix, whose predicted CREATE2 address for this
 * implementation blob holds no code on-chain (stale consumed salts from
 * earlier builds are skipped).
 */
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
    /**
     * Build a product-sdk registry handle (implementation ABI at the proxy
     * address) with the admin signer attached — `setCode` and
     * `setProxyCodeHash` are admin-only.
     */
    registryContract: (
        registryAddress: string,
    ) => Contract<ContractDef> | Promise<Contract<ContractDef>>;
    /**
     * CREATE2 salt package for the new implementation blob. When omitted,
     * probes from `CONTRACTS_REGISTRY_IMPL_PACKAGE`, bumping the numeric
     * suffix until a salt whose predicted address holds no code.
     */
    implPackage?: string;
    log?: (message: string) => void;
}

/**
 * Upgrade a live registry in place: deploy the new implementation blob at a
 * fresh CREATE2 salt, repoint the proxy with `setCode` (verified via
 * `getCode()`), then ensure the frozen per-name proxy blob is uploaded and
 * `proxyCodeHash` set. The registry address never moves and no state is
 * migrated — the v2 storage layout reads v1 records as-is.
 *
 * Idempotent: when the live implementation already matches the blob the
 * deploy and `setCode` are skipped (`upgraded: false`), and the proxy code
 * hash setup skips itself when already correct — so a re-run after any
 * partial failure just finishes the remaining steps.
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

    // Already upgraded? Compare the live implementation's on-chain bytes
    // against the blob — a re-run after success then only repairs the
    // per-name proxy code hash.
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

    // Resolve the salt: explicit package, or first free suffix bump.
    let implPackage: string;
    let implAddress: string;
    let alreadyDeployed = false;
    if (opts.implPackage !== undefined) {
        implPackage = opts.implPackage;
        implAddress = predictImplAddress(deployer, implCode, implPackage);
        // Revive CREATE2 commits to the code bytes, so code at the predicted
        // address is this exact blob from an earlier run — reuse it.
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

    // Repoint the proxy and verify the switch took.
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
        // Offline prediction needs nothing but the signer's public key — a
        // fixed one keeps the whole derivation deterministic. The committed
        // child blob doubles as a stand-in implementation blob.
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
            // The registry address is CREATE3: a pure function of the
            // factory address and the registry salt — nothing else.
            expect(a.registryAddress).toBe(
                predictCreate3Address(
                    a.factoryAddress,
                    hexToBytes(computeDeploySalt(CONTRACTS_REGISTRY_PACKAGE)),
                ),
            );
            // Constructor args: word 0 = implementation, word 1 = admin
            // (the deployer EOA — never the CREATE3 child, see
            // encodeProxyConstructorArgs).
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
