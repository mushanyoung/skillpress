import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { validateAgentSkill } from "../src/validate/agent-skill.js";
import { DiagnosticCollector } from "../src/validate/diagnostics.js";
import { buildInspectedMarkdownResourceGraph } from "../src/validate/markdown-resource-graph.js";
import { inspectAgentSkillDocument } from "../src/validate/skill-document.js";
import { inspectAgentSkillRoot } from "../src/validate/skill-root.js";
import { MAX_SKILL_DIAGNOSTICS, MAX_SKILL_DOCUMENT_BYTES } from "../src/validate/types.js";
import { createSkillFixtures, skillDocument } from "./helpers/skill-fixtures.js";
import { diagnosticCodes, expectDiagnosticCodes } from "./helpers/validation.js";

const fixtures = createSkillFixtures();
afterEach(() => fixtures.cleanup());

async function resourceGraph(directory: string) {
  const diagnostics = new DiagnosticCollector();
  const root = await inspectAgentSkillRoot(directory, diagnostics);
  const document =
    root === undefined ? undefined : await inspectAgentSkillDocument(root, diagnostics);
  expect(diagnostics.finish().diagnostics).toEqual([]);
  if (document === undefined) throw new Error("expected an inspected skill document");
  const result = await buildInspectedMarkdownResourceGraph(document);
  if (!result.ok || !("graph" in result)) throw new Error("expected a Markdown resource graph");
  return result.graph;
}

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

  it("validates the property-tax resource shape while leaving code-span paths inert", async () => {
    const body = `${[
      "Read [methodology](references/methodology.md), [routes](references/appeal-routes.md), and [schema](references/case-schema.md).",
      "",
      "Use `assets/case-template.json`, `assets/case-example.json`, `scripts/lookup_jurisdiction.py`,",
      "`scripts/build_appeal_packet.py`, `scripts/url_safety.py`, and `scripts/requirements.lock`.",
    ].join("\n")}\n`;
    const fixture = await fixtures.skill(
      "property-tax-shape",
      skillDocument("name: property-tax-shape\ndescription: A useful property tax skill.", body),
    );
    const references = join(fixture.directory, "references");
    await mkdir(references);
    await Promise.all([
      writeFile(join(references, "methodology.md"), "# Methodology\n\nMethodology details.\n"),
      writeFile(join(references, "appeal-routes.md"), "# Appeal routes\n\nAppeal details.\n"),
      writeFile(join(references, "case-schema.md"), "# Case schema\n\nSchema details.\n"),
    ]);

    const graph = await resourceGraph(fixture.directory);
    expect(graph).toEqual({
      surface: "commonmark-links-images-v1",
      complete: true,
      documents: [
        { file: "SKILL.md", depth: 0, byteLength: 390, nodeCount: 26, targetCount: 3 },
        {
          file: "references/methodology.md",
          depth: 1,
          byteLength: 36,
          nodeCount: 5,
          targetCount: 0,
        },
        {
          file: "references/appeal-routes.md",
          depth: 1,
          byteLength: 33,
          nodeCount: 5,
          targetCount: 0,
        },
        {
          file: "references/case-schema.md",
          depth: 1,
          byteLength: 31,
          nodeCount: 5,
          targetCount: 0,
        },
      ],
      edges: [
        {
          from: "SKILL.md",
          to: "references/methodology.md",
          kind: "link",
          form: "inline",
          location: { line: 5, column: 6 },
          destinationLocation: { line: 5, column: 6 },
        },
        {
          from: "SKILL.md",
          to: "references/appeal-routes.md",
          kind: "link",
          form: "inline",
          location: { line: 5, column: 48 },
          destinationLocation: { line: 5, column: 48 },
        },
        {
          from: "SKILL.md",
          to: "references/case-schema.md",
          kind: "link",
          form: "inline",
          location: { line: 5, column: 91 },
          destinationLocation: { line: 5, column: 91 },
        },
      ],
      reachableFiles: [
        "SKILL.md",
        "references/methodology.md",
        "references/appeal-routes.md",
        "references/case-schema.md",
      ],
      findings: [],
      totals: {
        files: 4,
        bytes: 490,
        nodes: 41,
        targets: 3,
        work: 20,
        components: 6,
        aliasCandidates: 0,
      },
    });

    expect(await validateAgentSkill(fixture.directory)).toEqual({
      schemaVersion: 1,
      ok: true,
      diagnostics: [
        {
          code: "skill.license.missing",
          severity: "warning",
          scope: "portable",
          file: "SKILL.md",
          message: "a license is recommended for publish-ready skills",
          line: 2,
          column: 1,
        },
      ],
      metadata: {
        name: "property-tax-shape",
        description: "A useful property tax skill.",
      },
    });
  });

  it("reports safe fixed diagnostics for broken local Markdown resources", async () => {
    const body = `${[
      "# Broken resources",
      "",
      "",
      "[missing](references/missing.md)",
      "[dot](../escape.md)",
      "[case](references/METHOD.md)",
      "[bad](references/bad.md)",
    ].join("\n")}\n`;
    const fixture = await fixtures.skill(
      "broken-resources",
      skillDocument(
        "name: broken-resources\ndescription: A useful broken-resource fixture.\nlicense: MIT",
        body,
      ),
    );
    const references = join(fixture.directory, "references");
    await mkdir(references);
    await writeFile(join(references, "method.md"), "# Method\n");
    await writeFile(join(references, "bad.md"), Uint8Array.from([0xc3, 0x28]));

    const graph = await resourceGraph(fixture.directory);
    expect(graph.complete).toBe(false);
    expect(graph.edges).toMatchObject([
      { from: "SKILL.md", to: "references/bad.md", kind: "link" },
    ]);
    expect(graph.findings.map(({ kind, ...finding }) => [kind, finding])).toMatchObject([
      ["resolution", { reason: "missing", file: "SKILL.md", location: { line: 9, column: 1 } }],
      [
        "destination",
        { reason: "dot_component", file: "SKILL.md", location: { line: 10, column: 1 } },
      ],
      [
        "resolution",
        { reason: "noncanonical", file: "SKILL.md", location: { line: 11, column: 1 } },
      ],
      ["read", { reason: "invalid_utf8", file: "SKILL.md", location: { line: 12, column: 1 } }],
    ]);

    const report = await validateAgentSkill(fixture.directory);
    expect(report).toEqual({
      schemaVersion: 1,
      ok: false,
      diagnostics: [
        {
          code: "skill.reference.missing",
          severity: "error",
          scope: "skillpress",
          file: "SKILL.md",
          message: "local Markdown destination does not exist",
          line: 9,
          column: 1,
        },
        {
          code: "skill.reference.destination.dot_component",
          severity: "error",
          scope: "skillpress",
          file: "SKILL.md",
          message: "Markdown destinations must not contain dot path components",
          line: 10,
          column: 1,
        },
        {
          code: "skill.reference.noncanonical",
          severity: "error",
          scope: "skillpress",
          file: "SKILL.md",
          message: "local Markdown destination must use exact canonical path spelling",
          line: 11,
          column: 1,
        },
        {
          code: "skill.reference.read.invalid_utf8",
          severity: "error",
          scope: "skillpress",
          file: "SKILL.md",
          message: "referenced Markdown file must contain valid UTF-8",
          line: 12,
          column: 1,
        },
      ],
    });
    const serialized = JSON.stringify(report);
    expect(serialized).not.toContain("references/METHOD.md");
    expect(serialized).not.toContain("method.md");
    expect(serialized).not.toContain(fixture.directory);
  });

  it("treats complete missing-target observations as validation errors", async () => {
    const fixture = await fixtures.skill(
      "missing-resource",
      skillDocument(
        "name: missing-resource\ndescription: A missing-resource fixture.\nlicense: MIT",
        "[missing](references/missing.md)\n",
      ),
    );
    const graph = await resourceGraph(fixture.directory);
    expect(graph).toMatchObject({
      complete: true,
      findings: [{ kind: "resolution", reason: "missing", file: "SKILL.md" }],
    });
    expect(await validateAgentSkill(fixture.directory)).toEqual({
      schemaVersion: 1,
      ok: false,
      diagnostics: [
        {
          code: "skill.reference.missing",
          severity: "error",
          scope: "skillpress",
          file: "SKILL.md",
          message: "local Markdown destination does not exist",
          line: 6,
          column: 1,
        },
      ],
    });
  });

  it("diagnoses graphless envelopes once and preserves graph findings after YAML failure", async () => {
    const plain = await fixtures.skill("plain-document", "plain Markdown\n");
    const descriptor = Object.getOwnPropertyDescriptor(Object.prototype, "graph");
    let inheritedReads = 0;
    let plainReport: Awaited<ReturnType<typeof validateAgentSkill>> | undefined;
    try {
      Object.defineProperty(Object.prototype, "graph", {
        configurable: true,
        get() {
          inheritedReads += 1;
          throw new Error("inherited graph was read");
        },
      });
      plainReport = await validateAgentSkill(plain.directory);
    } finally {
      if (descriptor === undefined) Reflect.deleteProperty(Object.prototype, "graph");
      else Object.defineProperty(Object.prototype, "graph", descriptor);
    }
    expect(inheritedReads).toBe(0);
    expect(plainReport).toEqual({
      schemaVersion: 1,
      ok: false,
      diagnostics: [
        {
          code: "skill.frontmatter.missing",
          severity: "error",
          scope: "agent-skills",
          file: "SKILL.md",
          message: "SKILL.md must begin with a YAML frontmatter delimiter",
          line: 1,
          column: 1,
        },
      ],
    });

    const malformed = await fixtures.skill(
      "yaml-and-resource",
      "---\nname: [unterminated\n---\n[missing](missing.md)\n",
    );
    const report = await validateAgentSkill(malformed.directory);
    const codes = diagnosticCodes(report);
    expect(codes.filter((code) => code === "skill.frontmatter.yaml")).toHaveLength(1);
    expect(codes.filter((code) => code === "skill.reference.missing")).toHaveLength(1);
  });

  it("admits root diagnostics before bounded graph findings", async () => {
    const links = Array.from(
      { length: MAX_SKILL_DIAGNOSTICS - 1 },
      (_, index) => `[missing ${index}](references/missing-${index}.md)`,
    ).join("\n");
    const fixture = await fixtures.skill(
      "diagnostic-priority",
      skillDocument("license: MIT", `${links}\n`),
    );
    const report = await validateAgentSkill(fixture.directory);
    const codes = diagnosticCodes(report);
    expect(report.diagnostics).toHaveLength(MAX_SKILL_DIAGNOSTICS);
    expect(codes).toContain("skill.name.required");
    expect(codes).toContain("skill.description.required");
    expect(codes).toContain("skill.diagnostics.truncated");
    expect(codes.filter((code) => code === "skill.reference.missing")).toHaveLength(253);
  });

  it("keeps legacy root and document failure codes on the graph-backed path", async () => {
    const parent = await fixtures.parent();
    expect(diagnosticCodes(await validateAgentSkill(join(parent, "absent")))).toEqual([
      "skill.root.missing",
    ]);

    const missingDocument = join(parent, "missing-document");
    await mkdir(missingDocument);
    expect(diagnosticCodes(await validateAgentSkill(missingDocument))).toEqual([
      "skill.document.missing",
    ]);

    const invalid = await fixtures.skill("invalid-resource-utf8", Uint8Array.from([0xc3, 0x28]));
    expect(diagnosticCodes(await validateAgentSkill(invalid.directory))).toEqual([
      "skill.document.encoding",
    ]);

    const large = await fixtures.skill(
      "large-resource-document",
      new Uint8Array(MAX_SKILL_DOCUMENT_BYTES + 1).fill(0x61),
    );
    expect(diagnosticCodes(await validateAgentSkill(large.directory))).toEqual([
      "skill.document.too_large",
    ]);
  });

  it("does not call the legacy document content reader", async () => {
    const fixture = await fixtures.skill(
      "single-read-path",
      skillDocument("name: single-read-path\ndescription: A description.\nlicense: MIT"),
    );
    let legacyReads = 0;
    vi.resetModules();
    vi.doMock("../src/validate/skill-document-read.js", async (importOriginal) => {
      const actual =
        await importOriginal<typeof import("../src/validate/skill-document-read.js")>();
      return {
        ...actual,
        readInspectedAgentSkillDocument() {
          legacyReads += 1;
          throw new Error("legacy content read was used");
        },
      };
    });
    try {
      const isolated = await import("../src/validate/agent-skill.js");
      expect(await isolated.validateAgentSkill(fixture.directory)).toMatchObject({
        ok: true,
        diagnostics: [],
        metadata: { name: "single-read-path" },
      });
      expect(legacyReads).toBe(0);
    } finally {
      vi.doUnmock("../src/validate/skill-document-read.js");
      vi.resetModules();
    }
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
