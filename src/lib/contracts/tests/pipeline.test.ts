import { describe, test, expect, vi, beforeEach } from "vitest";
import type { PolkadotSigner, SS58String } from "polkadot-api";
import { buildContracts, deployContracts, type BuildEvent } from "../src/pipeline";
import type { ContractInfo, DeploymentOrderLayered } from "../src/detection";

vi.mock("../src/builder", () => ({
    pvmContractBuildAsync: vi.fn(
        async (_root: string, crateName: string) =>
            ({
                crateName,
                success: true,
                stdout: "",
                stderr: "",
                durationMs: 100,
            }) as const,
    ),
}));

vi.mock("../src/detection", async () => {
    const actual = await vi.importActual<typeof import("../src/detection")>("../src/detection");
    return {
        ...actual,
        detectDeploymentOrderLayered: vi.fn(),
        getGitRemoteUrl: vi.fn(() => "https://github.com/test/repo"),
        readReadmeContent: vi.fn(() => ""),
    };
});

vi.mock("../src/cid", () => ({
    computeBulletinStoreCid: vi.fn(async () => "fakeCid123"),
}));

vi.mock("@parity/product-sdk-contracts", () => ({
    createContractFromClient: vi.fn(async () => ({
        getVersionCount: {
            query: vi.fn(async () => ({ success: true, value: 0 })),
        },
    })),
}));

vi.mock("../src/deployer", async () => {
    const actual = await vi.importActual<typeof import("../src/deployer")>("../src/deployer");
    return {
        ...actual,
        ContractDeployer: vi.fn().mockImplementation(() => ({
            planDeploy: vi.fn(async (pvmPaths: string[]) => ({
                prepared: pvmPaths.map((_path, index) => ({
                    address: `0x${String(index + 1).padStart(40, "0")}`,
                    gasLimit: { ref_time: 1n, proof_size: 1n },
                    extrinsicWeight: { ref_time: 1n, proof_size: 1n },
                    storageDeposit: 0n,
                })),
                budget: { ref_time: 10n, proof_size: 10n },
                chunks: [pvmPaths.map((_path, index) => index)],
            })),
            deployAndRegisterBatch: vi.fn(
                async (
                    pvmPaths: string[],
                    _packages: string[],
                    _registry: unknown,
                    _metadataUris: string[],
                    onChunk: (chunk: {
                        addresses: string[];
                        txHash: string;
                        blockHash: string;
                    }) => void,
                ) => {
                    const addresses = pvmPaths.map(
                        (_path, index) => `0x${String(index + 1).padStart(40, "0")}`,
                    );
                    onChunk({
                        addresses,
                        txHash: "0xdeploy",
                        blockHash: "0xblock",
                    });
                    return { addresses };
                },
            ),
        })),
    };
});

vi.mock("../src/publisher", () => ({
    MetadataPublisher: vi.fn().mockImplementation(() => ({
        publishBatch: vi.fn(async (metadataList: unknown[]) => ({
            cids: metadataList.map(() => "fakeCid123"),
            txHash: "0xpublish",
        })),
    })),
}));

vi.mock("../src/solidity", () => ({
    buildSolidityToolchain: vi.fn(),
    detectSolidityBuildTargets: vi.fn(() => []),
}));

// Scoping note: this `fs` mock is intentionally confined to this test file.
// A previous incarnation lived in an `import.meta.vitest` block inside
// `pipeline.ts` itself, where vitest's `includeSource` evaluation hoisted the
// mock at module-load time and polluted every test file that imported
// anything from `@parity/cdm-builder` (cdm-json.ts uses `from "fs"` and got
// stubbed `existsSync: () => true`, masquerading empty tmp dirs as having a
// cdm.json). Keeping the mock in a dedicated test file scopes it to just the
// pipeline tests that need it.
vi.mock("fs", () => ({
    existsSync: vi.fn(() => true),
    mkdirSync: vi.fn(),
    readFileSync: vi.fn(() => Buffer.from("[]")),
    writeFileSync: vi.fn(),
}));

const { pvmContractBuildAsync: mockBuild } = await import("../src/builder");
const { detectDeploymentOrderLayered: mockDetect } = await import("../src/detection");
const {
    buildSolidityToolchain: mockBuildSolidity,
    detectSolidityBuildTargets: mockDetectSolidity,
} = await import("../src/solidity");
const { MetadataPublisher: mockMetadataPublisher } = await import("../src/publisher");
const { writeFileSync: mockWriteFileSync } = await import("fs");

type CI = ContractInfo;

function makeOrder(
    layers: string[][],
    deps: Record<string, string[]> = {},
    cdm: Record<string, string> = {},
): DeploymentOrderLayered {
    const contractMap = new Map<string, CI>();
    for (const layer of layers) {
        for (const crate of layer) {
            contractMap.set(crate, {
                name: crate,
                cdmPackage: cdm[crate] ?? null,
                description: null,
                authors: [],
                homepage: null,
                repository: null,
                readmePath: null,
                path: `/fake/${crate}`,
                dependsOnCrates: deps[crate] ?? [],
            });
        }
    }
    const cdmPackageMap = new Map(Object.entries(cdm));
    return { layers, contractMap, cdmPackageMap };
}

beforeEach(() => {
    vi.clearAllMocks();
    (mockDetectSolidity as any).mockReturnValue([]);
    (mockBuildSolidity as any).mockResolvedValue({
        result: { success: true, stdout: "", stderr: "", durationMs: 10 },
        artifacts: [],
        missing: [],
    });
    (mockBuild as any).mockImplementation(async (_root: string, crateName: string) => ({
        crateName,
        success: true,
        stdout: "",
        stderr: "",
        durationMs: 100,
    }));
});

function makePolkadotSigner(fill: number): PolkadotSigner {
    return {
        publicKey: new Uint8Array(32).fill(fill),
        signTx: vi.fn(async () => new Uint8Array(65).fill(fill)),
        signBytes: vi.fn(async () => new Uint8Array(64).fill(fill)),
    };
}

describe("buildContracts", () => {
    test("contracts in same layer build concurrently", async () => {
        (mockDetect as any).mockReturnValue(makeOrder([["a", "b"]]));
        const summary = await buildContracts({ rootDir: "/fake" });
        expect(mockBuild).toHaveBeenCalledTimes(2);
        expect(summary.contracts.map((c) => c.crate).sort()).toEqual(["a", "b"]);
        expect(summary.contracts.every((c) => !c.error)).toBe(true);
    });

    test("layer N+1 waits for layer N to complete", async () => {
        (mockDetect as any).mockReturnValue(makeOrder([["a"], ["b"]], { b: ["a"] }));
        const callOrder: string[] = [];
        (mockBuild as any).mockImplementation(async (_root: string, crateName: string) => {
            callOrder.push(`start:${crateName}`);
            await new Promise((r) => setTimeout(r, 5));
            callOrder.push(`end:${crateName}`);
            return { crateName, success: true, stdout: "", stderr: "", durationMs: 50 };
        });
        await buildContracts({ rootDir: "/fake" });
        expect(callOrder.indexOf("end:a")).toBeLessThan(callOrder.indexOf("start:b"));
    });

    test("error in one contract cascades to dependents", async () => {
        (mockDetect as any).mockReturnValue(makeOrder([["a"], ["b"]], { b: ["a"] }));
        (mockBuild as any).mockImplementation(async (_root: string, crateName: string) => {
            if (crateName === "a") {
                return {
                    crateName,
                    success: false,
                    stdout: "",
                    stderr: "fail",
                    durationMs: 10,
                };
            }
            return { crateName, success: true, stdout: "", stderr: "", durationMs: 10 };
        });
        const summary = await buildContracts({ rootDir: "/fake" });
        expect(summary.contracts.find((c) => c.crate === "a")!.error).toBeDefined();
        expect(summary.contracts.find((c) => c.crate === "b")!.error).toBe(
            "Skipped: dependency failed",
        );
    });

    test("emits detect + pipeline-done events", async () => {
        (mockDetect as any).mockReturnValue(makeOrder([["a"]]));
        const events: BuildEvent[] = [];
        await buildContracts({ rootDir: "/fake", onEvent: (e) => events.push(e) });
        expect(events[0].type).toBe("detect");
        expect(events.at(-1)!.type).toBe("pipeline-done");
    });

    test("empty pipeline succeeds immediately", async () => {
        (mockDetect as any).mockReturnValue({
            layers: [],
            contractMap: new Map(),
            cdmPackageMap: new Map(),
        });
        const summary = await buildContracts({ rootDir: "/fake" });
        expect(summary.contracts).toEqual([]);
    });

    test("contract filter narrows the build set", async () => {
        (mockDetect as any).mockReturnValue(makeOrder([["a", "b", "c"]]));
        const summary = await buildContracts({ rootDir: "/fake", contracts: ["b"] });
        expect(summary.contracts.map((c) => c.crate)).toEqual(["b"]);
    });

    test("rejects duplicate CDM package names", async () => {
        (mockDetect as any).mockReturnValue(
            makeOrder([["a", "b"]], {}, { a: "@example/counter", b: "@example/counter" }),
        );
        await expect(buildContracts({ rootDir: "/fake" })).rejects.toThrow(
            'Duplicate CDM package "@example/counter"',
        );
    });

    test("features option is forwarded to pvmContractBuildAsync", async () => {
        (mockDetect as any).mockReturnValue(makeOrder([["a"]]));
        await buildContracts({ rootDir: "/fake", features: "my-feature" });
        expect(mockBuild).toHaveBeenCalledWith(
            "/fake",
            "a",
            expect.any(Function),
            "my-feature",
            undefined,
        );
    });

    test("features is undefined when not provided", async () => {
        (mockDetect as any).mockReturnValue(makeOrder([["a"]]));
        await buildContracts({ rootDir: "/fake" });
        expect(mockBuild).toHaveBeenCalledWith(
            "/fake",
            "a",
            expect.any(Function),
            undefined,
            undefined,
        );
    });

    test("overwrites local Solidity imports with build stubs before compiling Solidity targets", async () => {
        (mockDetect as any).mockReturnValue(makeOrder([]));
        (mockDetectSolidity as any).mockReturnValue([
            {
                name: "@example/counter-a",
                displayName: "@example/counter-a",
                toolchain: "foundry",
                cdmPackage: "@example/counter-a",
                description: null,
                authors: [],
                homepage: null,
                repository: null,
                readmePath: null,
                path: "/fake/contracts",
                dependsOnCrates: [],
                sourcePath: "/fake/contracts/CounterA.sol",
                contractName: "CounterA",
            },
        ]);
        (mockBuildSolidity as any).mockResolvedValue({
            result: { success: true, stdout: "", stderr: "", durationMs: 10 },
            artifacts: [
                {
                    target: {
                        name: "@example/counter-a",
                        displayName: "@example/counter-a",
                        toolchain: "foundry",
                        cdmPackage: "@example/counter-a",
                        sourcePath: "/fake/contracts/CounterA.sol",
                        contractName: "CounterA",
                    },
                    bytecodePath: "/fake/target/cdm/foundry/counter-a.polkavm",
                    artifactPath: "/fake/out/CounterA.sol/CounterA.json",
                    abiPath: "/fake/out/CounterA.sol/CounterA.json",
                    bytecodeSize: 42,
                    durationMs: 10,
                },
            ],
            missing: [],
        });

        await buildContracts({ rootDir: "/fake" });

        expect(mockWriteFileSync).toHaveBeenCalledWith(
            "/fake/.cdm/solidity/example/counter-a.sol",
            expect.stringContaining('import "../../../contracts/CounterA.sol";'),
        );
        expect(mockBuildSolidity).toHaveBeenCalledWith(
            "/fake",
            "foundry",
            expect.any(Array),
            expect.any(Object),
        );
    });
});

describe("deployContracts", () => {
    test("deploys each layer before building its dependents", async () => {
        (mockDetect as any).mockReturnValue(
            makeOrder([["a"], ["b"]], { b: ["a"] }, { a: "@example/a", b: "@example/b" }),
        );

        const events: string[] = [];
        const deploySigner = makePolkadotSigner(1);
        const metadataSigner = makePolkadotSigner(2);
        await deployContracts({
            rootDir: "/fake",
            client: {
                assetHub: {
                    apis: {
                        ReviveApi: {
                            instantiate: vi.fn(async () => ({
                                result: {
                                    success: true,
                                    value: {
                                        addr: "0x0000000000000000000000000000000000000001",
                                    },
                                },
                            })),
                        },
                    },
                },
                bulletin: {},
                raw: { assetHub: {}, bulletin: {} },
                descriptors: { assetHub: {} },
            } as any,
            signer: deploySigner,
            origin: "5GrwvaEF5zXb26Fz9rcQpDWSJm8VAz5tK7gU3QF8JKpt5M7" as SS58String,
            registryAddress: "0xf62c2ece29cd8df2e10040ecfa5a894a5c5d9cb0",
            metadataSigner,
            onEvent: (event) => {
                if (event.type === "build-start") events.push(`build-start:${event.crate}`);
                if (event.type === "deploy-register-start") {
                    events.push(`deploy-start:${event.crates.join(",")}`);
                }
                if (event.type === "deploy-register-done") {
                    events.push(`deploy-done:${Object.keys(event.addresses).join(",")}`);
                }
            },
        });

        expect(events.indexOf("deploy-done:a")).toBeLessThan(events.indexOf("build-start:b"));
        expect(mockMetadataPublisher).toHaveBeenCalledWith(
            metadataSigner,
            expect.anything(),
            expect.anything(),
        );
    });
});
