import { readFileSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import {
    CONTRACTS_REGISTRY_IMPL_PACKAGE,
    CONTRACTS_REGISTRY_PACKAGE,
    CREATE3_FACTORY_PACKAGE,
} from "@parity/cdm-utils";
import type { Contract, ContractDef } from "@parity/product-sdk-contracts";
import { computeDeploySalt, type ContractDeployer } from "./deployer";
import {
    eoaH160FromPublicKey,
    loadCreate3ChildArtifact,
    loadCreate3FactoryArtifact,
    predictCreate3Address,
    predictReviveCreate2Address,
} from "./create3";
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
    /** Reuse a prior {@link predictRegistryDeploy} result. */
    prediction?: RegistryDeployPrediction;
    log?: (message: string) => void;
}

/**
 * Deploy the ContractRegistry behind its proxy, bootstrapping the CREATE3
 * factory first when the network doesn't have it yet. Every step is
 * idempotent (skipped when its output already exists on-chain), so a
 * partially-failed earlier run can simply be re-run.
 *
 * Returns all three addresses; `proxyAddress` is the registry address.
 */
export async function deployRegistryWithProxy(
    deployer: ContractDeployer,
    opts: DeployRegistryOptions,
): Promise<{ factoryAddress: string; implAddress: string; proxyAddress: string }> {
    const log = opts.log ?? (() => {});
    const plan = opts.prediction ?? predictRegistryDeploy(deployer, opts.rootDir, opts.implPvmPath);
    const done = {
        factoryAddress: plan.factoryAddress,
        implAddress: plan.implAddress,
        proxyAddress: plan.registryAddress,
    };

    // The registry address depends only on (factory, salt) — if a contract
    // already lives there, the whole deployment already happened.
    if ((await deployer.getOnChainCode(plan.registryAddress)) !== null) {
        log(`Registry already deployed at ${plan.registryAddress}`);
        return done;
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
    const { codeHash: proxyCodeHash } = await deployer.uploadCode(proxyCode);
    const factory = await opts.factoryContract(plan.factoryAddress);
    await deployer.deployViaCreate3Factory(
        factory,
        plan.factoryAddress,
        computeDeploySalt(CONTRACTS_REGISTRY_PACKAGE),
        proxyCodeHash,
        plan.constructorData,
    );

    return done;
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
