import { describe, expect, it } from "vitest";

import { DiagnosticCollector } from "../src/validate/diagnostics.js";
import { parseAgentSkillFrontmatter } from "../src/validate/frontmatter.js";
import { MAX_SKILL_DIAGNOSTICS, MAX_SKILL_FRONTMATTER_BYTES } from "../src/validate/types.js";
import { skillDocument } from "./helpers/skill-fixtures.js";

function parse(text: string) {
  const diagnostics = new DiagnosticCollector();
  const parsed = parseAgentSkillFrontmatter(text, diagnostics);
  const report = diagnostics.finish();
  return { parsed, report, codes: report.diagnostics.map((entry) => entry.code) };
}

function expectCodes(text: string, ...expected: string[]) {
  const result = parse(text);
  for (const code of expected) expect(result.codes).toContain(code);
  return result;
}

describe("strict Agent Skills frontmatter parsing", () => {
  it("extracts allowed scalar and metadata fields without evaluating YAML objects", () => {
    const result = parse(
      skillDocument(
        [
          "name: portable-skill",
          "description: A useful skill.",
          "license: MIT",
          "compatibility: Any Agent Skills client.",
          "metadata:",
          "  __proto__: inert",
          "allowed-tools: Read Grep",
        ].join("\n"),
      ),
    );

    expect(result.report.diagnostics).toEqual([]);
    expect(result.parsed?.fields.get("name")?.value).toEqual({
      kind: "string",
      value: "portable-skill",
    });
    expect(result.parsed?.fields.get("metadata")?.value).toEqual({
      kind: "map",
      entries: [{ key: "__proto__", value: "inert" }],
    });
    expect(result.parsed?.body).toContain("Do the work safely.");
    expect(result.parsed).toMatchObject({ bodyStartLine: 10 });
    expect(result.parsed?.bodyStartOffset).toBe(
      skillDocument(
        [
          "name: portable-skill",
          "description: A useful skill.",
          "license: MIT",
          "compatibility: Any Agent Skills client.",
          "metadata:",
          "  __proto__: inert",
          "allowed-tools: Read Grep",
        ].join("\n"),
      ).indexOf("# Instructions"),
    );
  });

  it("rejects unknown fields without reflecting their content", () => {
    const result = expectCodes(
      skillDocument("name: safe\ndescription: A description.\nsecret-value: present"),
      "skill.frontmatter.unknown_field",
    );
    expect(result.report.diagnostics.map((entry) => entry.message).join(" ")).not.toContain(
      "secret-value",
    );
  });

  it("rejects duplicates, aliases, anchors, tags, and plain merge keys", () => {
    const duplicate = expectCodes(
      skillDocument("name: duplicate\nname: duplicate\ndescription: A description."),
      "skill.frontmatter.duplicate_key",
    );
    expect(
      duplicate.codes.filter((code) => code === "skill.frontmatter.duplicate_key"),
    ).toHaveLength(1);

    expectCodes(
      skillDocument("name: &name alias\ndescription: *name"),
      "skill.frontmatter.anchor",
      "skill.frontmatter.alias",
    );
    expectCodes(
      skillDocument("name: !!str tagged\ndescription: A description."),
      "skill.frontmatter.tag",
    );
    expectCodes(
      skillDocument("!example\nname: tagged\ndescription: A description."),
      "skill.frontmatter.tag",
      "skill.frontmatter.yaml",
    );
    expectCodes(
      skillDocument("name: merge\ndescription: A description.\n<<: value"),
      "skill.frontmatter.merge_key",
    );
    const quoted = expectCodes(
      skillDocument('name: merge\ndescription: A description.\n"<<": value'),
      "skill.frontmatter.unknown_field",
    );
    expect(quoted.codes).not.toContain("skill.frontmatter.merge_key");
  });

  it("rejects malformed, non-mapping, complex-key, and multi-document YAML", () => {
    expectCodes(skillDocument("name: [unterminated"), "skill.frontmatter.yaml");
    expectCodes(skillDocument("- name\n- description"), "skill.frontmatter.mapping");
    expectCodes(
      skillDocument("? [complex]\n: value\nname: safe\ndescription: A description."),
      "skill.frontmatter.yaml",
    );
    expectCodes("---\nname: multiple\n...\nname: again\n---\nbody\n", "skill.frontmatter.yaml");
  });

  it("preserves stable syntax and AST locations without source reflection", () => {
    const syntax = expectCodes(
      "---\r\nname: syntax\r\ndescription: Use when: parsing\r\n---\r\nbody\r\n",
      "skill.frontmatter.yaml",
    );
    expect(syntax.report.diagnostics[0]).toMatchObject({ line: 3, column: 14 });
    expect(syntax.report.diagnostics[0]?.message).not.toContain("Use when");

    const unknown = expectCodes(
      '---\r\nname: location\r\ndescription: "😀"\r\nunknown: value\r\n---\r\nbody\r\n',
      "skill.frontmatter.unknown_field",
    );
    expect(
      unknown.report.diagnostics.find((entry) => entry.code === "skill.frontmatter.unknown_field"),
    ).toMatchObject({ line: 4, column: 1 });
  });

  it("propagates exact body coordinates across CRLF and astral frontmatter", () => {
    const text = '---\r\nname: astral\r\ndescription: "Valid 😀 text"\r\n---\r\n# Body\r\n';
    const result = parse(text);
    expect(result.report.diagnostics).toEqual([]);
    expect(result.parsed).toMatchObject({
      body: "# Body\r\n",
      bodyStartLine: 5,
      bodyStartOffset: text.indexOf("# Body"),
    });
    expect(text.slice(result.parsed?.bodyStartOffset)).toBe(result.parsed?.body);
  });

  it("rejects controls, noncharacters, and unpaired surrogates decoded from YAML", () => {
    for (const escaped of ["\\0", "\\e", "\\x85", "\\uFDD0", "\\U0010FFFF"]) {
      expectCodes(
        skillDocument(`name: safe\ndescription: "${escaped}"`),
        "skill.frontmatter.control_character",
      );
    }
    expectCodes(
      skillDocument('name: safe\ndescription: "\\uD800"'),
      "skill.frontmatter.invalid_unicode",
    );
    expectCodes(
      skillDocument('name: safe\ndescription: safe\nmetadata:\n  "\\0": "\\e"'),
      "skill.frontmatter.control_character",
    );
    const valid = parse(skillDocument('name: safe\ndescription: "Valid 😀 text"'));
    expect(valid.report.diagnostics).toEqual([]);
  });

  it("enforces parser complexity budgets", () => {
    expectCodes(
      skillDocument(`name: indentation\n${" ".repeat(65)}description: too deep`),
      "skill.frontmatter.complexity",
    );
    expectCodes(
      skillDocument(`${"[".repeat(33)}value${"]".repeat(33)}`),
      "skill.frontmatter.complexity",
    );
    expectCodes(
      skillDocument(
        `name: tokens\ndescription: A description.\nvalues:\n${"- value\n".repeat(2800)}`,
      ),
      "skill.frontmatter.complexity",
    );
  });

  it("requires exact delimiters and rejects source BOMs and controls", () => {
    expectCodes(" ---\nname: missing\n---\nbody\n", "skill.frontmatter.missing");
    expectCodes("---\nname: unclosed\n", "skill.frontmatter.unclosed");
    expectCodes(
      `\ufeff${skillDocument("name: bom\ndescription: A description.")}`,
      "skill.document.encoding",
    );
    const control = expectCodes(
      `${skillDocument("name: control\ndescription: A description.")}\u0001`,
      "skill.document.control_character",
    );
    expect(control.report.diagnostics[0]).toMatchObject({ line: 8, column: 1 });
  });

  it("enforces the frontmatter byte and diagnostic budgets", () => {
    expectCodes(
      `---\n${"x".repeat(MAX_SKILL_FRONTMATTER_BYTES + 1)}\n---\nbody\n`,
      "skill.frontmatter.too_large",
    );
    const first = parse(
      `${skillDocument("name: many\ndescription: A description.")}${"\u0001".repeat(
        MAX_SKILL_DIAGNOSTICS + 20,
      )}`,
    ).report;
    const second = parse(
      `${skillDocument("name: many\ndescription: A description.")}${"\u0001".repeat(
        MAX_SKILL_DIAGNOSTICS + 20,
      )}`,
    ).report;
    expect(first.diagnostics).toHaveLength(MAX_SKILL_DIAGNOSTICS);
    expect(first).toEqual(second);
    expect(first.diagnostics.map((entry) => entry.code)).toContain("skill.diagnostics.truncated");
  });
});
