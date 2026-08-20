import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { validateAgentSkill } from "../src/validate/agent-skill.js";
import { createSkillFixtures, skillDocument } from "./helpers/skill-fixtures.js";
import { diagnosticCodes, expectDiagnosticCodes } from "./helpers/validation.js";

const fixtures = createSkillFixtures();
afterEach(() => fixtures.cleanup());

describe("Agent Skill metadata validation", () => {
  it("returns frozen metadata for a complete portable skill", async () => {
    const fixture = await fixtures.skill(
      "incident-summary",
      skillDocument(
        [
          "name: incident-summary",
          "description: Summarize an incident with evidence and clear follow-up actions.",
          "license: MIT",
          "compatibility: Requires a POSIX shell and read-only access to incident artifacts.",
          "metadata:",
          "  author: example",
          "  __proto__: inert",
        ].join("\n"),
      ),
    );
    const report = await validateAgentSkill(fixture.directory, {
      expectedName: "incident-summary",
    });

    expect(report).toMatchObject({
      schemaVersion: 1,
      ok: true,
      diagnostics: [],
      metadata: {
        name: "incident-summary",
        description: "Summarize an incident with evidence and clear follow-up actions.",
        license: "MIT",
        compatibility: "Requires a POSIX shell and read-only access to incident artifacts.",
        metadata: { author: "example" },
      },
    });
    expect(Object.entries(report.metadata?.metadata ?? {})).toEqual([
      ["author", "example"],
      ["__proto__", "inert"],
    ]);
    expect(Object.getPrototypeOf(report.metadata?.metadata)).toBeNull();
    expect(Object.isFrozen(report)).toBe(true);
    expect(Object.isFrozen(report.diagnostics)).toBe(true);
    expect(Object.isFrozen(report.metadata)).toBe(true);
    expect(Object.isFrozen(report.metadata?.metadata)).toBe(true);
    expect(JSON.stringify(report)).not.toContain("inspection");
    expect(JSON.stringify(report)).not.toContain(fixture.directory);
  });

  it("reports portability and Anthropic warnings without failing valid metadata", async () => {
    const body = Array.from({ length: 501 }, (_, index) => `line ${index}`).join("\n");
    const fixture = await fixtures.skill(
      "claude-helper",
      skillDocument(
        [
          "name: claude-helper",
          'description: "Use <records> to produce a concise result."',
          "allowed-tools: Read Grep",
        ].join("\n"),
        body,
      ),
    );
    const report = await expectDiagnosticCodes(
      fixture.directory,
      "skill.license.missing",
      "skill.allowed_tools.experimental",
      "skill.body.recommended_length",
      "skill.target.anthropic.reserved_name",
      "skill.target.anthropic.xml_description",
    );

    expect(report.ok).toBe(true);
    expect(report.metadata?.allowedTools).toBe("Read Grep");
    expect(report.diagnostics.every((entry) => entry.severity === "warning")).toBe(true);
  });

  it("warns for an empty body and a missing license", async () => {
    const fixture = await fixtures.skill(
      "minimal",
      skillDocument("name: minimal\ndescription: A useful minimal skill.", " \n\t"),
    );
    const report = await expectDiagnosticCodes(
      fixture.directory,
      "skill.body.empty",
      "skill.license.missing",
    );
    expect(report.ok).toBe(true);
  });

  it("validates required fields, scalar types, lengths, and name matches", async () => {
    const missing = await fixtures.skill("missing", skillDocument("license: MIT"));
    await expectDiagnosticCodes(
      missing.directory,
      "skill.name.required",
      "skill.description.required",
    );

    const wrongTypes = await fixtures.skill(
      "typed",
      skillDocument(
        [
          "name: true",
          "description: [not, a, string]",
          "license: 7",
          "compatibility: false",
          "allowed-tools: [Read]",
        ].join("\n"),
      ),
    );
    await expectDiagnosticCodes(
      wrongTypes.directory,
      "skill.name.type",
      "skill.description.type",
      "skill.license.type",
      "skill.compatibility.type",
      "skill.allowed_tools.type",
    );

    const invalid = await fixtures.skill(
      "actual-directory",
      skillDocument(
        [
          `name: ${"a".repeat(65)}`,
          `description: ${"😀".repeat(1025)}`,
          'license: " "',
          `compatibility: ${"x".repeat(501)}`,
          'allowed-tools: ""',
        ].join("\n"),
      ),
    );
    const report = await validateAgentSkill(invalid.directory, { expectedName: "project-name" });
    expect(diagnosticCodes(report)).toEqual(
      expect.arrayContaining([
        "skill.name.length",
        "skill.name.directory_mismatch",
        "skill.name.project_mismatch",
        "skill.description.length",
        "skill.license.empty",
        "skill.compatibility.length",
        "skill.allowed_tools.format",
      ]),
    );

    const empty = await fixtures.skill(
      "empty",
      skillDocument('name: ""\ndescription: " \t"\nlicense: MIT\ncompatibility: ""'),
    );
    await expectDiagnosticCodes(
      empty.directory,
      "skill.name.length",
      "skill.name.portable_format",
      "skill.description.required",
      "skill.compatibility.length",
    );
  });

  it("requires portable ASCII name syntax", async () => {
    const fixture = await fixtures.skill(
      "Bad_Name",
      skillDocument("name: Bad_Name\ndescription: A description.\nlicense: MIT"),
    );
    await expectDiagnosticCodes(fixture.directory, "skill.name.portable_format");
  });

  it("validates metadata as a safe string-to-string map", async () => {
    const wrongType = await fixtures.skill(
      "wrong-map",
      skillDocument("name: wrong-map\ndescription: A description.\nlicense: MIT\nmetadata: []"),
    );
    await expectDiagnosticCodes(wrongType.directory, "skill.metadata.type");

    const wrongValue = await fixtures.skill(
      "wrong-value",
      skillDocument(
        "name: wrong-value\ndescription: A description.\nlicense: MIT\nmetadata:\n  okay: true",
      ),
    );
    await expectDiagnosticCodes(wrongValue.directory, "skill.metadata.value_type");

    const wrongKey = await fixtures.skill(
      "wrong-key",
      skillDocument(
        "name: wrong-key\ndescription: A description.\nlicense: MIT\nmetadata:\n  ? [complex]\n  : value",
      ),
    );
    await expectDiagnosticCodes(wrongKey.directory, "skill.metadata.key_type");
  });

  it("rejects invalid runtime API inputs", async () => {
    await expect(validateAgentSkill("" as string)).rejects.toBeInstanceOf(TypeError);
    await expect(validateAgentSkill(7 as unknown as string)).rejects.toBeInstanceOf(TypeError);
    await expect(
      validateAgentSkill("unused", null as unknown as { expectedName?: string }),
    ).rejects.toBeInstanceOf(TypeError);
    await expect(
      validateAgentSkill("unused", [] as unknown as { expectedName?: string }),
    ).rejects.toBeInstanceOf(TypeError);
    await expect(
      validateAgentSkill("unused", { expectedName: 7 as unknown as string }),
    ).rejects.toBeInstanceOf(TypeError);
    const hostile = new Proxy(
      {},
      {
        get() {
          throw new Error("poison getter");
        },
      },
    );
    await expect(validateAgentSkill("unused", hostile)).rejects.toBeInstanceOf(TypeError);
    for (const expectedName of ["", "Bad_Name", "a".repeat(65)]) {
      await expect(validateAgentSkill("unused", { expectedName })).rejects.toBeInstanceOf(
        TypeError,
      );
    }
  });

  it("rejects ambiguous path text before it can alias a filesystem object", async () => {
    const parent = await fixtures.parent();
    const replacementParent = join(parent, "�");
    const actual = join(replacementParent, "safe");
    await mkdir(actual, { recursive: true });
    await writeFile(
      join(actual, "SKILL.md"),
      skillDocument("name: safe\ndescription: A description.\nlicense: MIT"),
    );
    await expect(validateAgentSkill(join(parent, "\ud800", "safe"))).rejects.toBeInstanceOf(
      TypeError,
    );

    await expect(validateAgentSkill("   ")).rejects.toBeInstanceOf(TypeError);
    const invalid = ["bad\0path", "bad\u0085path", "bad\u2060path"];
    for (let plane = 0; plane <= 0x10; plane += 1) {
      invalid.push(String.fromCodePoint(plane * 0x10000 + 0xfffe));
      invalid.push(String.fromCodePoint(plane * 0x10000 + 0xffff));
    }
    for (let codePoint = 0xfdd0; codePoint <= 0xfdef; codePoint += 1) {
      invalid.push(String.fromCodePoint(codePoint));
    }
    for (const value of invalid) {
      await expect(validateAgentSkill(join(parent, value, "safe"))).rejects.toBeInstanceOf(
        TypeError,
      );
    }
  });
});
