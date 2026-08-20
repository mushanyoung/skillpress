import { describe, expect, it } from "vitest";

import { DiagnosticCollector } from "../src/validate/diagnostics.js";
import { parseSkillDocumentEnvelope } from "../src/validate/skill-source.js";
import { MAX_SKILL_FRONTMATTER_BYTES } from "../src/validate/types.js";

function envelope(text: string) {
  const diagnostics = new DiagnosticCollector();
  const result = parseSkillDocumentEnvelope(text, diagnostics);
  return { result, report: diagnostics.finish() };
}

describe("Agent Skill document envelopes", () => {
  it("extracts LF, CRLF, and CR frontmatter without changing bytes", () => {
    expect(envelope("---\nname: lf\n---\nbody\n").result).toEqual({
      yaml: "name: lf\n",
      body: "body\n",
    });
    expect(envelope("---\r\nname: crlf\r\n---\r\nbody\r\n").result).toEqual({
      yaml: "name: crlf\r\n",
      body: "body\r\n",
    });
    expect(envelope("---\rname: cr\r---\rbody\r").result).toEqual({
      yaml: "name: cr\r",
      body: "body\r",
    });
  });

  it("requires exact opening and closing delimiter lines", () => {
    for (const text of ["", " ---\nname: bad\n---\n", "----\nname: bad\n---\n"]) {
      expect(envelope(text).report.diagnostics[0]?.code).toBe("skill.frontmatter.missing");
    }
    expect(envelope("---\nname: bad\n--- # comment\n").report.diagnostics[0]?.code).toBe(
      "skill.frontmatter.unclosed",
    );
  });

  it("rejects a Unicode BOM and forbidden C0 or C1 source characters", () => {
    expect(envelope("\ufeff---\n---\n").report.diagnostics[0]).toMatchObject({
      code: "skill.document.encoding",
      line: 1,
      column: 1,
    });
    const controls = envelope("---\nname: okay\n---\rbody\u0001\rnext\u0085");
    expect(controls.report.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "skill.document.control_character",
          line: 4,
          column: 5,
        }),
        expect.objectContaining({
          code: "skill.document.control_character",
          line: 5,
          column: 5,
        }),
      ]),
    );
  });

  it("accepts the exact frontmatter byte boundary and rejects one byte more", () => {
    const exact = "x".repeat(MAX_SKILL_FRONTMATTER_BYTES - 1);
    expect(envelope(`---\n${exact}\n---\nbody`).result?.yaml).toHaveLength(
      MAX_SKILL_FRONTMATTER_BYTES,
    );
    const tooLarge = envelope(`---\n${exact}x\n---\nbody`);
    expect(tooLarge.result).toBeUndefined();
    expect(tooLarge.report.diagnostics[0]?.code).toBe("skill.frontmatter.too_large");
  });

  it("counts multibyte frontmatter by UTF-8 bytes", () => {
    const emojiBytes = MAX_SKILL_FRONTMATTER_BYTES - 4;
    const text = `${"😀".repeat(emojiBytes / 4)}xxx`;
    expect(envelope(`---\n${text}\n---\n`).result).toBeDefined();
    expect(envelope(`---\n${text}x\n---\n`).report.diagnostics[0]?.code).toBe(
      "skill.frontmatter.too_large",
    );
  });
});
