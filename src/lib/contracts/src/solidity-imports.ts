import type { AbiEntry, AbiParam } from "./deployer";

const SOLIDITY_IMPORT_ROOT = ".cdm/solidity";
const CDM_PACKAGE_RE = /^@[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)+$/;

const SOLIDITY_KEYWORDS = new Set([
    "after",
    "alias",
    "anonymous",
    "apply",
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
    "event",
    "external",
    "false",
    "final",
    "for",
    "function",
    "immutable",
    "implements",
    "import",
    "indexed",
    "in",
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
    "var",
    "view",
    "virtual",
    "while",
]);

export interface SolidityImportContract {
    library: string;
    address: string;
    abi: AbiEntry[];
    version?: number;
}

export interface GeneratedSolidityImport {
    library: string;
    path: string;
    interfaceName: string;
    libraryName: string;
    content: string;
}

interface SolidityTypeResult {
    type: string;
    needsLocation: boolean;
}

interface StructDefinition {
    name: string;
    fields: string[];
}

interface StructContext {
    structs: StructDefinition[];
    names: Set<string>;
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

function toPascalCase(input: string): string {
    const parts = input.split(/[^A-Za-z0-9]+/).filter(Boolean);
    const value = parts.map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join("");
    if (!value) return "CdmContract";
    return /^[0-9]/.test(value) ? `Cdm${value}` : value;
}

function namesForLibrary(library: string): { interfaceName: string; libraryName: string } {
    const base = packageSegments(library).map(toPascalCase).join("");
    return { interfaceName: `I${base}`, libraryName: base };
}

function isValidIdentifier(name: string): boolean {
    return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name) && !SOLIDITY_KEYWORDS.has(name);
}

function identifier(name: string | undefined, fallback: string): string {
    const candidate = name?.trim();
    if (!candidate) return fallback;
    const normalized = candidate.replace(/[^A-Za-z0-9_]/g, "_");
    if (!normalized) return fallback;
    const prefixed = /^[0-9]/.test(normalized) ? `_${normalized}` : normalized;
    return isValidIdentifier(prefixed) ? prefixed : `${prefixed}_`;
}

function parseType(type: string): { base: string; suffix: string } {
    const match = type.match(/((?:\[[0-9]*\])+)$/);
    const suffix = match?.[1] ?? "";
    return {
        base: suffix ? type.slice(0, -suffix.length) : type,
        suffix,
    };
}

function uniqueStructName(ctx: StructContext, preferred: string): string {
    let name = toPascalCase(preferred);
    if (!/^[A-Za-z_]/.test(name)) name = `Cdm${name}`;
    let unique = name;
    let i = 2;
    while (ctx.names.has(unique)) {
        unique = `${name}${i}`;
        i += 1;
    }
    ctx.names.add(unique);
    return unique;
}

function solidityType(
    param: AbiParam,
    ctx: StructContext,
    contextName: string,
): SolidityTypeResult {
    const { base, suffix } = parseType(param.type);
    if (base !== "tuple") {
        return {
            type: `${base}${suffix}`,
            needsLocation: suffix.length > 0 || base === "string" || base === "bytes",
        };
    }

    if (!param.components || param.components.length === 0) {
        throw new Error(`Cannot generate Solidity interface for empty tuple ${contextName}`);
    }

    const structName = uniqueStructName(ctx, contextName);
    const fields = param.components.map((component, index) => {
        const fieldType = solidityType(component, ctx, `${structName}Field${index}`).type;
        return `        ${fieldType} ${identifier(component.name, `field${index}`)};`;
    });
    ctx.structs.push({ name: structName, fields });

    return {
        type: `${structName}${suffix}`,
        needsLocation: true,
    };
}

function parameter(
    param: AbiParam,
    index: number,
    ctx: StructContext,
    contextName: string,
    location: "calldata" | "memory",
): string {
    const result = solidityType(param, ctx, contextName);
    const dataLocation = result.needsLocation ? ` ${location}` : "";
    return `${result.type}${dataLocation} ${identifier(param.name, `arg${index}`)}`;
}

function returnParameter(
    param: AbiParam,
    index: number,
    ctx: StructContext,
    contextName: string,
): string {
    const result = solidityType(param, ctx, contextName);
    const dataLocation = result.needsLocation ? " memory" : "";
    return `${result.type}${dataLocation}`;
}

function stateMutability(entry: AbiEntry): string {
    if (entry.stateMutability === "view" || entry.stateMutability === "pure") {
        return ` ${entry.stateMutability}`;
    }
    if (entry.stateMutability === "payable") return " payable";
    return "";
}

function functionSignature(entry: AbiEntry, ctx: StructContext): string | null {
    if (entry.type !== "function" || !entry.name) return null;

    const inputs = (entry.inputs ?? []).map((input, index) =>
        parameter(input, index, ctx, `${entry.name}Arg${index}`, "calldata"),
    );
    const outputs = (entry.outputs ?? []).map((output, index) =>
        returnParameter(output, index, ctx, `${entry.name}Return${index}`),
    );
    const returns = outputs.length > 0 ? ` returns (${outputs.join(", ")})` : "";
    return `    function ${identifier(entry.name, "method")}(${inputs.join(", ")}) external${stateMutability(entry)}${returns};`;
}

function validateAddress(address: string): string {
    if (!/^0x[0-9a-fA-F]{40}$/.test(address)) {
        throw new Error(`Invalid contract address for Solidity import generation: ${address}`);
    }
    return address;
}

export function generateSolidityImport(contract: SolidityImportContract): GeneratedSolidityImport {
    const { interfaceName, libraryName } = namesForLibrary(contract.library);
    const ctx: StructContext = { structs: [], names: new Set() };
    const functions = contract.abi
        .map((entry) => functionSignature(entry, ctx))
        .filter((line): line is string => line !== null);
    const structLines = ctx.structs.flatMap((struct) => [
        `    struct ${struct.name} {`,
        ...struct.fields,
        "    }",
        "",
    ]);

    const version = contract.version === undefined ? "" : `// CDM version: ${contract.version}\n`;
    const content = `// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.28;

// Auto-generated by cdm install. Do not edit by hand.
// CDM package: ${contract.library}
${version}
interface ${interfaceName} {
${structLines.join("\n")}${functions.join("\n")}
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

if (import.meta.vitest) {
    const { describe, expect, test } = import.meta.vitest;

    describe("solidity import codegen", () => {
        test("generates stable import paths and address-backed helpers", () => {
            const generated = generateSolidityImport({
                library: "@example/counter-a",
                address: "0x1111111111111111111111111111111111111111",
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
                "address internal constant ADDRESS = 0x1111111111111111111111111111111111111111;",
            );
            expect(generated.content).toContain(
                "function count() external view returns (uint256);",
            );
            expect(generated.content).toContain(
                "function add(uint256 amount) external returns (uint256);",
            );
        });

        test("generates structs and data locations for tuple and dynamic types", () => {
            const generated = generateSolidityImport({
                library: "@org/profile",
                address: "0x2222222222222222222222222222222222222222",
                abi: [
                    {
                        type: "function",
                        name: "setProfile",
                        stateMutability: "nonpayable",
                        inputs: [
                            {
                                name: "profile",
                                type: "tuple",
                                components: [
                                    { name: "name", type: "string" },
                                    { name: "scores", type: "uint256[]" },
                                ],
                            },
                        ],
                        outputs: [{ name: "", type: "bytes" }],
                    },
                ],
            });

            expect(generated.content).toContain("struct SetProfileArg0");
            expect(generated.content).toContain("string name;");
            expect(generated.content).toContain("uint256[] scores;");
            expect(generated.content).toContain(
                "function setProfile(SetProfileArg0 calldata profile) external returns (bytes memory);",
            );
        });
    });
}
