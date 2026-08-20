import { describe, expect, it } from "vitest";

import { DiagnosticCollector } from "../src/validate/diagnostics.js";
import { parseAgentSkillFrontmatter } from "../src/validate/frontmatter.js";
import { validateSupplementalMetadata } from "../src/validate/metadata-rules.js";
import type { AgentSkillMetadata, MutableAgentSkillMetadata } from "../src/validate/types.js";
import { skillDocument } from "./helpers/skill-fixtures.js";

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
