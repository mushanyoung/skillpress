import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { DiagnosticCollector } from "../src/validate/diagnostics.js";
import { parseAgentSkillFrontmatter } from "../src/validate/frontmatter.js";
import { validateSupplementalMetadata } from "../src/validate/metadata-rules.js";
import type {
  AgentSkillMetadata,
  MutableAgentSkillMetadata,
  ParsedAgentSkillFrontmatter,
  ParsedFrontmatterField,
} from "../src/validate/types.js";
import { skillDocument } from "./helpers/skill-fixtures.js";

const repositoryRoot = new URL("../", import.meta.url);

const ecmaScriptWhitespace = [
  0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x20, 0xa0, 0x1680, 0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005,
  0x2006, 0x2007, 0x2008, 0x2009, 0x200a, 0x2028, 0x2029, 0x202f, 0x205f, 0x3000, 0xfeff,
] as const;

function legacyRegExpState(): readonly string[] {
  const aliases = RegExp as unknown as Readonly<Record<string, string>>;
  return [
    RegExp.input,
    RegExp.$_,
    RegExp.lastMatch,
    aliases["$&"],
    RegExp.lastParen,
    aliases["$+"],
    RegExp.leftContext,
    aliases["$`"],
    RegExp.rightContext,
    aliases["$'"],
    RegExp.$1,
    RegExp.$2,
    RegExp.$3,
    RegExp.$4,
    RegExp.$5,
    RegExp.$6,
    RegExp.$7,
    RegExp.$8,
    RegExp.$9,
  ];
}

function stringField(value: string): ParsedFrontmatterField {
  return { value: { kind: "string", value }, location: { line: 1, column: 1 } };
}

function directParsed(allowedTools: string | undefined, body: string): ParsedAgentSkillFrontmatter {
  const fields = new Map<string, ParsedFrontmatterField>([["license", stringField("MIT")]]);
  if (allowedTools !== undefined) fields.set("allowed-tools", stringField(allowedTools));
  return { fields, body, bodyStartLine: 1, bodyStartOffset: 0 };
}

function direct(allowedTools: string | undefined, body = "body") {
  const diagnostics = new DiagnosticCollector();
  const metadata: MutableAgentSkillMetadata = { name: "example", description: "example" };
  validateSupplementalMetadata(directParsed(allowedTools, body), metadata, diagnostics);
  const report = diagnostics.finish(metadata as AgentSkillMetadata);
  return { metadata, report, codes: report.diagnostics.map((entry) => entry.code) };
}

function validate(frontmatter: string, body?: string) {
  const diagnostics = new DiagnosticCollector();
  const parsed = parseAgentSkillFrontmatter(skillDocument(frontmatter, body), diagnostics);
  expect(parsed).toBeDefined();
  const metadata: MutableAgentSkillMetadata = { name: "example", description: "example" };
  if (parsed !== undefined) validateSupplementalMetadata(parsed, metadata, diagnostics);
  const report = diagnostics.finish(metadata as AgentSkillMetadata);
  return { metadata, report, codes: report.diagnostics.map((entry) => entry.code) };
}

describe("supplemental Agent Skill metadata", () => {
  it("copies valid optional strings and a prototype-safe metadata map", () => {
    const result = validate(
      [
        "name: example",
        "description: Example.",
        "license: MIT",
        "compatibility: Any portable client.",
        "allowed-tools: Read Grep",
        "metadata:",
        "  author: example",
        "  __proto__: inert",
      ].join("\n"),
    );

    expect(result.codes).toEqual(["skill.allowed_tools.experimental"]);
    expect(result.metadata).toMatchObject({
      license: "MIT",
      compatibility: "Any portable client.",
      allowedTools: "Read Grep",
    });
    expect(Object.entries(result.metadata.metadata ?? {})).toEqual([
      ["author", "example"],
      ["__proto__", "inert"],
    ]);
    expect(Object.getPrototypeOf(result.metadata.metadata)).toBeNull();
    expect(Object.isFrozen(result.metadata.metadata)).toBe(true);
  });

  it("warns for missing license, empty body, and long bodies", () => {
    expect(validate("name: example\ndescription: Example.", " \n\t").codes).toEqual(
      expect.arrayContaining(["skill.body.empty", "skill.license.missing"]),
    );
    const body = Array.from({ length: 501 }, (_, index) => `line ${index}`).join("\n");
    expect(validate("name: example\ndescription: Example.\nlicense: MIT", body).codes).toContain(
      "skill.body.recommended_length",
    );
  });

  it("rejects optional scalar types, lengths, and non-space tool delimiters", () => {
    const types = validate(
      [
        "name: example",
        "description: Example.",
        "license: 7",
        "compatibility: false",
        "allowed-tools: [Read]",
      ].join("\n"),
    );
    expect(types.codes).toEqual(
      expect.arrayContaining([
        "skill.license.type",
        "skill.compatibility.type",
        "skill.allowed_tools.type",
      ]),
    );

    for (const tools of ['""', '"Read  Grep"', '"Read\\tGrep"', '"Read\\nGrep"']) {
      expect(
        validate(`name: example\ndescription: Example.\nlicense: MIT\nallowed-tools: ${tools}`)
          .codes,
      ).toContain("skill.allowed_tools.format");
    }
    const lengths = validate(
      `name: example\ndescription: Example.\nlicense: " "\ncompatibility: ${"x".repeat(501)}`,
    );
    expect(lengths.codes).toEqual(
      expect.arrayContaining(["skill.license.empty", "skill.compatibility.length"]),
    );
  });

  it("matches the exact former allowed-tools whitespace language", () => {
    const reference = /^\S+(?: \S+)*$/u;
    const corpus = [
      "",
      "Read",
      "Read Grep",
      " Read",
      "Read ",
      "Read  Grep",
      "Read\u0085Grep",
      "Read\u180eGrep",
      "Read\u200bGrep",
      "Read\ud800Grep",
      "Read😀Grep",
    ];
    for (const codeUnit of ecmaScriptWhitespace) {
      const whitespace = String.fromCharCode(codeUnit);
      corpus.push(whitespace, `Read${whitespace}Grep`);
    }
    expect(ecmaScriptWhitespace).toHaveLength(25);
    for (const value of corpus) {
      const accepted = !direct(value).codes.includes("skill.allowed_tools.format");
      expect(accepted).toBe(reference.test(value));
    }
    const large = direct("x".repeat(512 * 1024)).codes;
    expect(large).not.toContain("skill.allowed_tools.format");
    expect(large).toContain("skill.allowed_tools.experimental");
  });

  it("counts CR, LF, and CRLF logical lines without changing blank priority", () => {
    for (const separator of ["\n", "\r", "\r\n"]) {
      const exact = `x${`${separator}x`.repeat(499)}`;
      expect(direct(undefined, exact).codes).not.toContain("skill.body.recommended_length");
      expect(direct(undefined, `${exact}${separator}`).codes).toContain(
        "skill.body.recommended_length",
      );
    }
    for (const exact of [`x${"\r\r\nx".repeat(249)}\nx`, `x${"\n\rx".repeat(249)}\nx`]) {
      expect(direct(undefined, exact).codes).not.toContain("skill.body.recommended_length");
      expect(direct(undefined, `${exact}\n`).codes).toContain("skill.body.recommended_length");
    }
    const blank = direct(undefined, "\r\n".repeat(501)).codes;
    expect(blank).toContain("skill.body.empty");
    expect(blank).not.toContain("skill.body.recommended_length");
    expect(direct(undefined, `x${"\u2028\u0085x".repeat(501)}`).codes).not.toContain(
      "skill.body.recommended_length",
    );
  });

  it("leaves all legacy RegExp aliases unchanged on former execution paths", () => {
    const secret = "retention-sentinel-metadata";
    const allowedRaw = secret;
    const allowedParsed = directParsed(allowedRaw, " \n\t");
    const allowedResult: MutableAgentSkillMetadata = { name: "example", description: "example" };
    const allowedDiagnostics = new DiagnosticCollector();
    const bodyRaw = `${secret}\n${"line\n".repeat(499)}last`;
    const bodyParsed = directParsed(undefined, bodyRaw);
    const bodyResult: MutableAgentSkillMetadata = { name: "example", description: "example" };
    const bodyDiagnostics = new DiagnosticCollector();
    const cases = [
      { parsed: allowedParsed, result: allowedResult, diagnostics: allowedDiagnostics },
      { parsed: bodyParsed, result: bodyResult, diagnostics: bodyDiagnostics },
    ] as const;

    for (let index = 0; index < cases.length; index += 1) {
      const { parsed, result, diagnostics } = cases[index];
      /(b)(e)(n)(i)(g)(n)(-)(o)(k)/u.exec("known-benign-leftbenign-okknown-benign-tail");
      const before = legacyRegExpState();
      validateSupplementalMetadata(parsed, result, diagnostics);
      const after = legacyRegExpState();
      expect(before[0]).toBe("known-benign-leftbenign-okknown-benign-tail");
      expect(after).toEqual(before);
    }
    expect(allowedResult.allowedTools).toBe(secret);
    expect(allowedDiagnostics.finish(allowedResult as AgentSkillMetadata).diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "skill.body.empty" })]),
    );
    const bodyReport = bodyDiagnostics.finish(bodyResult as AgentSkillMetadata);
    expect(bodyReport.diagnostics.map((entry) => entry.code)).toContain(
      "skill.body.recommended_length",
    );
    expect(JSON.stringify({ bodyResult, bodyReport })).not.toContain(secret);
  });

  it("uses captured scanners after live RegExp and split entries are poisoned", () => {
    const parsed = directParsed("Read Grep", `x${"\r\nx".repeat(500)}`);
    const metadata: MutableAgentSkillMetadata = { name: "example", description: "example" };
    const diagnostics = new DiagnosticCollector();
    const targets = [
      [Reflect, "apply"],
      [String.prototype, "charCodeAt"],
      [RegExp.prototype, "exec"],
      [RegExp.prototype, "test"],
      [RegExp.prototype, Symbol.split],
      [String.prototype, "split"],
    ] as const;
    const descriptors = targets.map(([target, key]) =>
      Object.getOwnPropertyDescriptor(target, key),
    );
    let calls = 0;
    const poison = () => {
      calls += 1;
      throw new Error("live scanner intrinsic used");
    };
    try {
      for (const [target, key] of targets) {
        Object.defineProperty(target, key, { configurable: true, value: poison, writable: true });
      }
      validateSupplementalMetadata(parsed, metadata, diagnostics);
    } finally {
      for (let index = targets.length - 1; index >= 0; index -= 1) {
        Object.defineProperty(targets[index][0], targets[index][1], descriptors[index]);
      }
    }
    expect(calls).toBe(0);
    expect(diagnostics.finish(metadata as AgentSkillMetadata).diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "skill.allowed_tools.experimental" }),
        expect.objectContaining({ code: "skill.body.recommended_length" }),
      ]),
    );
  });

  it("contains no per-input RegExp or String RegExp-entry path", async () => {
    const source = await readFile(
      new URL("src/validate/metadata-rules.ts", repositoryRoot),
      "utf8",
    );
    for (const fragment of [
      "RegExp",
      ".exec(",
      ".test(",
      ".match(",
      ".search(",
      ".replace(",
      ".replaceAll(",
      ".split(",
      "Symbol.split",
    ]) {
      expect(source).not.toContain(fragment);
    }
  });

  it("requires metadata string keys and values", () => {
    expect(
      validate("name: example\ndescription: Example.\nlicense: MIT\nmetadata: []").codes,
    ).toContain("skill.metadata.type");
    expect(
      validate("name: example\ndescription: Example.\nlicense: MIT\nmetadata:\n  okay: true").codes,
    ).toContain("skill.metadata.value_type");
    expect(
      validate(
        "name: example\ndescription: Example.\nlicense: MIT\nmetadata:\n  ? [complex]\n  : value",
      ).codes,
    ).toContain("skill.metadata.key_type");
  });
});
