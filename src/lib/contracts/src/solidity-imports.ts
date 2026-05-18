import { keccak_256 } from "@noble/hashes/sha3.js";

const SOLIDITY_IMPORT_ROOT = ".cdm/solidity";
const CDM_PACKAGE_RE = /^@[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)+$/;
const ARRAY_SUFFIX_RE = /(\[[0-9]*\])+$/;
const ARRAY_DIMENSION_RE = /\[[0-9]*\]/g;

const RESERVED_IDENTIFIERS = new Set([
    "abstract",
    "after",
    "alias",
    "anonymous",
    "apply",
    "as",
    "assembly",
    "auto",
    "bool",
    "break",
    "byte",
    "bytes",
    "calldata",
    "case",
    "catch",
    "constant",
    "constructor",
    "continue",
    "contract",
    "copyof",
    "default",
    "delete",
    "do",
    "else",
    "emit",
    "enum",
    "error",
    "event",
    "external",
    "false",
    "final",
    "for",
    "from",
    "function",
    "global",
    "if",
    "immutable",
    "implements",
    "import",
    "in",
    "indexed",
    "inline",
    "interface",
    "internal",
    "is",
    "let",
    "library",
    "mapping",
    "memory",
    "modifier",
    "mutable",
    "new",
    "null",
    "of",
    "override",
    "partial",
    "payable",
    "pragma",
    "private",
    "promise",
    "public",
    "pure",
    "reference",
    "relocatable",
    "return",
    "returns",
    "sealed",
    "sizeof",
    "static",
    "storage",
    "struct",
    "supports",
    "switch",
    "this",
    "true",
    "try",
    "typedef",
    "typeof",
    "unchecked",
    "unicode",
    "using",
    "var",
    "view",
    "virtual",
    "while",
]);

type AbiStateMutability = "pure" | "view" | "nonpayable" | "payable";
type AbiItemType = "constructor" | "error" | "event" | "fallback" | "function" | "receive";

export interface SolidityAbiParam {
    name?: string;
    type: string;
    internalType?: string;
    indexed?: boolean;
    components?: SolidityAbiParam[];
}

export interface SolidityAbiEntry {
    type: AbiItemType | string;
    name?: string;
    inputs?: SolidityAbiParam[];
    outputs?: SolidityAbiParam[];
    stateMutability?: AbiStateMutability | string;
    anonymous?: boolean;
}

export interface SolidityImportContract {
    library: string;
    address: string;
    abi: SolidityAbiEntry[];
    version?: number;
}

export interface SolidityLocalBuildImportContract {
    library: string;
    contractName: string;
    sourceImportPath: string;
}

export interface GeneratedSolidityImport {
    library: string;
    path: string;
    interfaceName: string;
    libraryName: string;
    content: string;
}

interface SolidityType {
    source: string;
    reference: boolean;
}

interface StructDefinition {
    name: string;
    fields: string[];
}

function packageSegments(library: string): string[] {
    if (!CDM_PACKAGE_RE.test(library)) {
        throw new Error(`Invalid CDM package name for Solidity import generation: ${library}`);
    }
    return library.slice(1).split("/");
}

export function solidityImportPathForLibrary(library: string): string {
    const segments = packageSegments(library);
    const file = `${segments.at(-1)}.sol`;
    return [SOLIDITY_IMPORT_ROOT, ...segments.slice(0, -1), file].join("/");
}

export function solidityLibraryFromImportPath(importPath: string): string | null {
    const normalized = importPath.replace(/\\/g, "/").replace(/^\.\//, "");
    const marker = `${SOLIDITY_IMPORT_ROOT}/`;
    const markerIndex = normalized.lastIndexOf(marker);
    if (markerIndex < 0 || !normalized.endsWith(".sol")) return null;

    const relative = normalized.slice(markerIndex + marker.length, -".sol".length);
    const segments = relative.split("/").filter(Boolean);
    if (segments.length < 2) return null;

    const library = `@${segments.join("/")}`;
    return CDM_PACKAGE_RE.test(library) ? library : null;
}

function toPascalCase(input: string): string {
    const value = input
        .split(/[^A-Za-z0-9]+/)
        .filter(Boolean)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join("");
    if (!value) return "CdmContract";
    return /^[0-9]/.test(value) ? `Cdm${value}` : value;
}

function namesForLibrary(library: string): { interfaceName: string; libraryName: string } {
    const base = packageSegments(library).map(toPascalCase).join("");
    return { interfaceName: `I${base}`, libraryName: base };
}

function isValidIdentifier(name: string): boolean {
    return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name) && !RESERVED_IDENTIFIERS.has(name);
}

function requireIdentifier(name: string | undefined, kind: string): string {
    if (!name || !isValidIdentifier(name)) {
        throw new Error(
            `Cannot generate Solidity import: invalid ${kind} name ${JSON.stringify(name)}`,
        );
    }
    return name;
}

function safeIdentifier(name: string | undefined, fallback: string, used: Set<string>): string {
    const raw = name?.trim() || fallback;
    const normalized = raw.replace(/[^A-Za-z0-9_]/g, "_");
    const base = /^[A-Za-z_]/.test(normalized) ? normalized : `_${normalized}`;
    const preferred = isValidIdentifier(base) ? base : `${base}_`;

    let candidate = preferred;
    let i = 2;
    while (used.has(candidate) || !isValidIdentifier(candidate)) {
        candidate = `${preferred}_${i}`;
        i += 1;
    }
    used.add(candidate);
    return candidate;
}

function parseArraySuffix(type: string): { base: string; suffix: string } {
    const match = type.match(ARRAY_SUFFIX_RE);
    const suffix = match?.[0] ?? "";
    for (const dimension of suffix.match(ARRAY_DIMENSION_RE) ?? []) {
        const size = dimension.slice(1, -1);
        if (size !== "" && !/^(0|[1-9][0-9]*)$/.test(size)) {
            throw new Error(`Cannot generate Solidity import: invalid array suffix in ${type}`);
        }
    }
    return {
        base: suffix ? type.slice(0, -suffix.length) : type,
        suffix,
    };
}

function validateIntegerBase(base: string, prefix: "int" | "uint"): boolean {
    if (base === prefix) return true;
    const size = Number(base.slice(prefix.length));
    return Number.isInteger(size) && size >= 8 && size <= 256 && size % 8 === 0;
}

function validateFixedBase(base: string): boolean {
    const match = base.match(/^(u?fixed)(?:(\d+)x(\d+))?$/);
    if (!match) return false;
    if (!match[2] && !match[3]) return true;
    const bits = Number(match[2]);
    const decimals = Number(match[3]);
    return (
        Number.isInteger(bits) &&
        bits >= 8 &&
        bits <= 256 &&
        bits % 8 === 0 &&
        Number.isInteger(decimals) &&
        decimals >= 0 &&
        decimals <= 80
    );
}

function primitiveSolidityType(base: string): string {
    if (base === "address" || base === "bool" || base === "string" || base === "bytes") {
        return base;
    }
    if (/^bytes[0-9]+$/.test(base)) {
        const size = Number(base.slice("bytes".length));
        if (size >= 1 && size <= 32) return base;
    }
    if (base.startsWith("uint") && validateIntegerBase(base, "uint")) return base;
    if (base.startsWith("int") && validateIntegerBase(base, "int")) return base;
    if (validateFixedBase(base)) return base;

    throw new Error(`Cannot generate Solidity import: unsupported ABI type ${base}`);
}

function structNameFromInternalType(internalType: string | undefined): string | null {
    if (!internalType) return null;
    const { base } = parseArraySuffix(internalType.trim());
    if (!base.startsWith("struct ")) return null;
    return base.slice("struct ".length).split(".").map(toPascalCase).join("");
}

function tupleKey(param: SolidityAbiParam): string {
    const components = param.components ?? [];
    return JSON.stringify({
        internalType: param.internalType ? parseArraySuffix(param.internalType).base : null,
        components: components.map((component) => ({
            name: component.name ?? "",
            type: component.type,
            internalType: component.internalType ?? null,
            components:
                component.components && component.components.length > 0
                    ? tupleKey(component)
                    : null,
        })),
    });
}

class StructRegistry {
    readonly definitions: StructDefinition[] = [];
    private readonly namesByKey = new Map<string, string>();
    private readonly usedNames: Set<string>;

    constructor(reservedNames: string[]) {
        this.usedNames = new Set(reservedNames);
    }

    typeFor(param: SolidityAbiParam, fallbackName: string): SolidityType {
        const { base, suffix } = parseArraySuffix(param.type);
        if (base !== "tuple") {
            if (param.components && param.components.length > 0) {
                throw new Error(
                    `Cannot generate Solidity import: ABI components supplied for non-tuple type ${param.type}`,
                );
            }
            const primitive = primitiveSolidityType(base);
            return {
                source: `${primitive}${suffix}`,
                reference: suffix.length > 0 || primitive === "string" || primitive === "bytes",
            };
        }

        if (!param.components || param.components.length === 0) {
            throw new Error(
                "Cannot generate Solidity import: tuple ABI item is missing components",
            );
        }

        const name = this.registerTuple(param, fallbackName);
        return {
            source: `${name}${suffix}`,
            reference: true,
        };
    }

    private registerTuple(param: SolidityAbiParam, fallbackName: string): string {
        const key = tupleKey(param);
        const existing = this.namesByKey.get(key);
        if (existing) return existing;

        const preferred = structNameFromInternalType(param.internalType) ?? fallbackName;
        const name = this.uniqueStructName(preferred);
        this.namesByKey.set(key, name);

        const usedFields = new Set<string>();
        const fields = (param.components ?? []).map((component, index) => {
            const type = this.typeFor(component, `${name}Field${index}`);
            const fieldName = safeIdentifier(component.name, `field${index}`, usedFields);
            return `    ${type.source} ${fieldName};`;
        });
        this.definitions.push({ name, fields });
        return name;
    }

    private uniqueStructName(preferred: string): string {
        const base = toPascalCase(preferred);
        let candidate = base;
        let i = 2;
        while (this.usedNames.has(candidate) || !isValidIdentifier(candidate)) {
            candidate = `${base}${i}`;
            i += 1;
        }
        this.usedNames.add(candidate);
        return candidate;
    }
}

function withLocation(type: SolidityType, location: "calldata" | "memory"): string {
    return type.reference ? `${type.source} ${location}` : type.source;
}

function renderInputs(
    params: SolidityAbiParam[] | undefined,
    registry: StructRegistry,
    contextName: string,
    location: "calldata" | null,
): string {
    const used = new Set<string>();
    return (params ?? [])
        .map((param, index) => {
            const type = registry.typeFor(param, `${contextName}Arg${index}`);
            const sourceType = location ? withLocation(type, location) : type.source;
            const name = safeIdentifier(param.name, `arg${index}`, used);
            return `${sourceType} ${name}`;
        })
        .join(", ");
}

function renderOutputs(
    params: SolidityAbiParam[] | undefined,
    registry: StructRegistry,
    contextName: string,
): string {
    return (params ?? [])
        .map((param, index) => {
            const type = registry.typeFor(param, `${contextName}Return${index}`);
            return withLocation(type, "memory");
        })
        .join(", ");
}

function mutability(entry: SolidityAbiEntry): string {
    switch (entry.stateMutability) {
        case undefined:
        case "nonpayable":
            return "";
        case "payable":
        case "pure":
        case "view":
            return ` ${entry.stateMutability}`;
        default:
            throw new Error(
                `Cannot generate Solidity import: unsupported stateMutability ${entry.stateMutability}`,
            );
    }
}

function renderFunction(entry: SolidityAbiEntry, registry: StructRegistry): string {
    const name = requireIdentifier(entry.name, "function");
    const inputs = renderInputs(entry.inputs, registry, toPascalCase(name), "calldata");
    const outputs = renderOutputs(entry.outputs, registry, toPascalCase(name));
    const returns = outputs ? ` returns (${outputs})` : "";
    return `    function ${name}(${inputs}) external${mutability(entry)}${returns};`;
}

function renderEvent(entry: SolidityAbiEntry, registry: StructRegistry): string {
    const name = requireIdentifier(entry.name, "event");
    const used = new Set<string>();
    const inputs = (entry.inputs ?? [])
        .map((param, index) => {
            const type = registry.typeFor(param, `${toPascalCase(name)}EventArg${index}`);
            const indexed = param.indexed ? " indexed" : "";
            const paramName = safeIdentifier(param.name, `arg${index}`, used);
            return `${type.source}${indexed} ${paramName}`;
        })
        .join(", ");
    return `    event ${name}(${inputs})${entry.anonymous ? " anonymous" : ""};`;
}

function renderError(entry: SolidityAbiEntry, registry: StructRegistry): string {
    const name = requireIdentifier(entry.name, "error");
    const inputs = renderInputs(entry.inputs, registry, toPascalCase(name), null);
    return `    error ${name}(${inputs});`;
}

function renderFallback(entry: SolidityAbiEntry): string {
    if (entry.inputs?.length || entry.outputs?.length) {
        throw new Error(
            "Cannot generate Solidity import: fallback ABI item cannot have inputs/outputs",
        );
    }
    return `    fallback() external${mutability(entry)};`;
}

function renderReceive(entry: SolidityAbiEntry): string {
    if (entry.inputs?.length || entry.outputs?.length) {
        throw new Error(
            "Cannot generate Solidity import: receive ABI item cannot have inputs/outputs",
        );
    }
    if (entry.stateMutability !== "payable") {
        throw new Error("Cannot generate Solidity import: receive ABI item must be payable");
    }
    return "    receive() external payable;";
}

function renderInterfaceItems(
    abi: SolidityAbiEntry[],
    registry: StructRegistry,
): { functions: string[]; events: string[]; errors: string[]; fallback: string[] } {
    const functions: string[] = [];
    const events: string[] = [];
    const errors: string[] = [];
    const fallback: string[] = [];

    for (const entry of abi) {
        switch (entry.type) {
            case "constructor":
                break;
            case "error":
                errors.push(renderError(entry, registry));
                break;
            case "event":
                events.push(renderEvent(entry, registry));
                break;
            case "fallback":
                fallback.push(renderFallback(entry));
                break;
            case "function":
                functions.push(renderFunction(entry, registry));
                break;
            case "receive":
                fallback.push(renderReceive(entry));
                break;
            default:
                throw new Error(
                    `Cannot generate Solidity import: unsupported ABI item type ${entry.type}`,
                );
        }
    }

    return { functions, events, errors, fallback };
}

function renderStructs(definitions: StructDefinition[]): string {
    if (definitions.length === 0) return "";
    return `${definitions
        .map((definition) => [`struct ${definition.name} {`, ...definition.fields, "}"].join("\n"))
        .join("\n\n")}\n\n`;
}

function validateAddress(address: string): string {
    if (!/^0x[0-9a-fA-F]{40}$/.test(address)) {
        throw new Error(`Invalid contract address for Solidity import generation: ${address}`);
    }
    return checksumAddress(address);
}

function bytesToHex(bytes: Uint8Array): string {
    return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function checksumAddress(address: string): string {
    const hex = address.slice(2).toLowerCase();
    const hash = bytesToHex(keccak_256(new TextEncoder().encode(hex)));
    let result = "0x";
    for (let i = 0; i < hex.length; i++) {
        const char = hex[i];
        result += Number.parseInt(hash[i], 16) >= 8 ? char.toUpperCase() : char;
    }
    return result;
}

export function generateSolidityImport(contract: SolidityImportContract): GeneratedSolidityImport {
    const { interfaceName, libraryName } = namesForLibrary(contract.library);
    const registry = new StructRegistry([interfaceName, libraryName]);
    const items = renderInterfaceItems(contract.abi, registry);
    const interfaceSections = [
        ...items.errors,
        ...items.events,
        ...items.fallback,
        ...items.functions,
    ].join("\n");
    const version = contract.version === undefined ? "" : `// CDM version: ${contract.version}\n`;
    const content = `// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.28;

// Auto-generated by cdm install. Do not edit by hand.
// CDM package: ${contract.library}
${version}
${renderStructs(registry.definitions)}interface ${interfaceName} {
${interfaceSections}
}

library ${libraryName} {
    address internal constant ADDRESS = ${validateAddress(contract.address)};

    function ref() internal pure returns (${interfaceName}) {
        return ${interfaceName}(ADDRESS);
    }

    function cdm() internal pure returns (${interfaceName}) {
        return ref();
    }
}
`;

    return {
        library: contract.library,
        path: solidityImportPathForLibrary(contract.library),
        interfaceName,
        libraryName,
        content,
    };
}

export function generateSolidityLocalBuildImport(
    contract: SolidityLocalBuildImportContract,
): GeneratedSolidityImport {
    const contractName = requireIdentifier(contract.contractName, "contract");
    const { libraryName } = namesForLibrary(contract.library);
    const sourceImportPath = contract.sourceImportPath.replace(/\\/g, "/");
    if (!sourceImportPath || sourceImportPath.includes("\n") || sourceImportPath.includes("\r")) {
        throw new Error(
            `Invalid source import path for Solidity local build import: ${JSON.stringify(contract.sourceImportPath)}`,
        );
    }

    const content = `// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.28;

// Auto-generated by cdm build for local project compilation. Do not edit by hand.
// CDM package: ${contract.library}
// Local build stub only. cdm install/deploy replaces this file with an address-backed wrapper.

import ${JSON.stringify(sourceImportPath)};

library ${libraryName} {
    address internal constant ADDRESS = 0x0000000000000000000000000000000000000000;

    function ref() internal pure returns (${contractName}) {
        return ${contractName}(payable(ADDRESS));
    }

    function cdm() internal pure returns (${contractName}) {
        return ref();
    }
}
`;

    return {
        library: contract.library,
        path: solidityImportPathForLibrary(contract.library),
        interfaceName: contractName,
        libraryName,
        content,
    };
}

if (import.meta.vitest) {
    const { describe, expect, test } = import.meta.vitest;
    const { mkdtempSync, rmSync, writeFileSync } = await import("fs");
    const { tmpdir } = await import("os");
    const { join } = await import("path");
    const { spawnSync } = await import("child_process");

    function solcAvailable(): boolean {
        return spawnSync("solc", ["--version"], { stdio: "ignore" }).status === 0;
    }

    function compileWithSolc(source: string, interfaceName: string): SolidityAbiEntry[] {
        const dir = mkdtempSync(join(tmpdir(), "cdm-solidity-import-"));
        try {
            const file = join(dir, "Generated.sol");
            writeFileSync(file, source);
            const result = spawnSync("solc", ["--combined-json", "abi", file], {
                encoding: "utf-8",
            });
            if (result.status !== 0) {
                throw new Error(result.stderr || result.stdout);
            }
            const output = JSON.parse(result.stdout) as {
                contracts: Record<string, { abi: SolidityAbiEntry[] }>;
            };
            const match = Object.entries(output.contracts).find(([name]) =>
                name.endsWith(`:${interfaceName}`),
            );
            if (!match) {
                throw new Error(`solc output did not include ${interfaceName}`);
            }
            return match[1].abi;
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    }

    function stripInternalTypes(value: unknown): unknown {
        if (Array.isArray(value)) return value.map(stripInternalTypes);
        if (!value || typeof value !== "object") return value;
        return Object.fromEntries(
            Object.entries(value)
                .filter(([key]) => key !== "internalType")
                .map(([key, entry]) => [key, stripInternalTypes(entry)]),
        );
    }

    describe("solidity import codegen", () => {
        test("generates stable import paths and address-backed helpers", () => {
            const generated = generateSolidityImport({
                library: "@example/counter-a",
                address: "0xccf14cb491b47ee0391b2fefc6991ef9e68e8cba",
                version: 3,
                abi: [
                    {
                        type: "function",
                        name: "count",
                        inputs: [],
                        outputs: [{ name: "", type: "uint256" }],
                        stateMutability: "view",
                    },
                    {
                        type: "function",
                        name: "add",
                        inputs: [{ name: "amount", type: "uint256" }],
                        outputs: [{ name: "", type: "uint256" }],
                        stateMutability: "nonpayable",
                    },
                ],
            });

            expect(generated.path).toBe(".cdm/solidity/example/counter-a.sol");
            expect(generated.content).toContain("interface IExampleCounterA");
            expect(generated.content).toContain("library ExampleCounterA");
            expect(generated.content).toContain(
                "address internal constant ADDRESS = 0xcCF14Cb491b47ee0391b2fEFc6991eF9E68E8cbA;",
            );
            expect(generated.content).toContain(
                "function count() external view returns (uint256);",
            );
            expect(generated.content).toContain(
                "function add(uint256 amount) external returns (uint256);",
            );
        });

        test("generates local build stubs that reuse the package helper shape", () => {
            const generated = generateSolidityLocalBuildImport({
                library: "@example/counter-a",
                contractName: "CounterA",
                sourceImportPath: "../../../contracts/CounterA.sol",
            });

            expect(generated.path).toBe(".cdm/solidity/example/counter-a.sol");
            expect(generated.interfaceName).toBe("CounterA");
            expect(generated.libraryName).toBe("ExampleCounterA");
            expect(generated.content).toContain('import "../../../contracts/CounterA.sol";');
            expect(generated.content).toContain("library ExampleCounterA");
            expect(generated.content).toContain(
                "address internal constant ADDRESS = 0x0000000000000000000000000000000000000000;",
            );
            expect(generated.content).toContain("function ref() internal pure returns (CounterA)");
            expect(generated.content).toContain("return CounterA(payable(ADDRESS));");
        });

        test("generates nested structs, events, errors, fallback, and receive", () => {
            const generated = generateSolidityImport({
                library: "@org/profile",
                address: "0x2222222222222222222222222222222222222222",
                abi: [
                    {
                        type: "error",
                        name: "BadProfile",
                        inputs: [
                            {
                                name: "profile",
                                type: "tuple",
                                internalType: "struct Profile",
                                components: [
                                    { name: "name", type: "string" },
                                    {
                                        name: "scores",
                                        type: "tuple[]",
                                        internalType: "struct Score[]",
                                        components: [
                                            { name: "game", type: "bytes32" },
                                            { name: "value", type: "uint256" },
                                        ],
                                    },
                                ],
                            },
                        ],
                    },
                    {
                        type: "event",
                        name: "ProfileSet",
                        inputs: [
                            { name: "owner", type: "address", indexed: true },
                            { name: "name", type: "string" },
                        ],
                    },
                    { type: "fallback", stateMutability: "nonpayable" },
                    { type: "receive", stateMutability: "payable" },
                    {
                        type: "function",
                        name: "setProfile",
                        stateMutability: "payable",
                        inputs: [
                            {
                                name: "profile",
                                type: "tuple",
                                internalType: "struct Profile",
                                components: [
                                    { name: "name", type: "string" },
                                    {
                                        name: "scores",
                                        type: "tuple[]",
                                        internalType: "struct Score[]",
                                        components: [
                                            { name: "game", type: "bytes32" },
                                            { name: "value", type: "uint256" },
                                        ],
                                    },
                                ],
                            },
                        ],
                        outputs: [
                            {
                                name: "",
                                type: "tuple",
                                internalType: "struct Profile",
                                components: [
                                    { name: "name", type: "string" },
                                    {
                                        name: "scores",
                                        type: "tuple[]",
                                        internalType: "struct Score[]",
                                        components: [
                                            { name: "game", type: "bytes32" },
                                            { name: "value", type: "uint256" },
                                        ],
                                    },
                                ],
                            },
                        ],
                    },
                ],
            });

            expect(generated.content).toContain("struct Profile");
            expect(generated.content).toContain("struct Score");
            expect(generated.content).toContain("Score[] scores;");
            expect(generated.content).toContain("error BadProfile(Profile profile);");
            expect(generated.content).toContain(
                "event ProfileSet(address indexed owner, string name);",
            );
            expect(generated.content).toContain("fallback() external;");
            expect(generated.content).toContain("receive() external payable;");
            expect(generated.content).toContain(
                "function setProfile(Profile calldata profile) external payable returns (Profile memory);",
            );
        });

        test("fails loudly for unsupported function-typed parameters", () => {
            expect(() =>
                generateSolidityImport({
                    library: "@org/callbacks",
                    address: "0x3333333333333333333333333333333333333333",
                    abi: [
                        {
                            type: "function",
                            name: "register",
                            inputs: [{ name: "callback", type: "function" }],
                            outputs: [],
                        },
                    ],
                }),
            ).toThrow("unsupported ABI type function");
        });

        test("generated Solidity compiles and preserves callable ABI shape", () => {
            if (!solcAvailable()) return;

            const inputAbi: SolidityAbiEntry[] = [
                {
                    type: "function",
                    name: "setProfile",
                    stateMutability: "payable",
                    inputs: [
                        {
                            name: "profile",
                            type: "tuple",
                            internalType: "struct Profile",
                            components: [
                                { name: "name", type: "string" },
                                { name: "scores", type: "uint256[]" },
                            ],
                        },
                        { name: "ids", type: "bytes32[2][]" },
                    ],
                    outputs: [
                        {
                            name: "",
                            type: "tuple[]",
                            internalType: "struct Profile[]",
                            components: [
                                { name: "name", type: "string" },
                                { name: "scores", type: "uint256[]" },
                            ],
                        },
                    ],
                },
            ];
            const generated = generateSolidityImport({
                library: "@org/profile",
                address: "0x4444444444444444444444444444444444444444",
                abi: inputAbi,
            });

            const abi = compileWithSolc(generated.content, generated.interfaceName);
            expect(abi[0].outputs?.[0].internalType).toBe("struct Profile[]");
            expect(stripInternalTypes(abi)).toEqual(
                stripInternalTypes([
                    {
                        inputs: inputAbi[0].inputs,
                        name: "setProfile",
                        outputs: inputAbi[0].outputs,
                        stateMutability: "payable",
                        type: "function",
                    },
                ]),
            );
        });
    });
}
