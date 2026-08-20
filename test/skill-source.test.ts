import { describe, expect, it } from "vitest";

import { DiagnosticCollector } from "../src/validate/diagnostics.js";
import {
  parseSkillDocumentEnvelope,
  projectSkillDocumentEnvelope,
} from "../src/validate/skill-source.js";
import { MAX_SKILL_FRONTMATTER_BYTES } from "../src/validate/types.js";

function envelope(text: string) {
  const diagnostics = new DiagnosticCollector();
  const result = parseSkillDocumentEnvelope(text, diagnostics);
  return { result, report: diagnostics.finish() };
}

function projected(text: unknown) {
  return projectSkillDocumentEnvelope(text);
}

describe("Agent Skill document envelopes", () => {
  it("extracts LF, CRLF, and CR frontmatter without changing bytes", () => {
    expect(envelope("---\nname: lf\n---\nbody\n").result).toEqual({
      yaml: "name: lf\n",
      body: "body\n",
      bodyStartLine: 4,
      bodyStartOffset: 17,
    });
    expect(envelope("---\r\nname: crlf\r\n---\r\nbody\r\n").result).toEqual({
      yaml: "name: crlf\r\n",
      body: "body\r\n",
      bodyStartLine: 4,
      bodyStartOffset: 22,
    });
    expect(envelope("---\rname: cr\r---\rbody\r").result).toEqual({
      yaml: "name: cr\r",
      body: "body\r",
      bodyStartLine: 4,
      bodyStartOffset: 17,
    });
    for (const text of [
      "---\nname: lf\n---\nbody\n",
      "---\r\nname: crlf\r\n---\r\nbody\r\n",
      "---\rname: cr\r---\rbody\r",
    ]) {
      const result = projected(text);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.envelope).toEqual(envelope(text).result);
        expect(Object.isFrozen(result)).toBe(true);
        expect(Object.isFrozen(result.envelope)).toBe(true);
      }
    }
  });

  it("reports UTF-16 body offsets and hypothetical empty-body lines", () => {
    const astral = "---\nname: 😀\n---\nbody";
    expect(envelope(astral).result).toMatchObject({
      body: "body",
      bodyStartLine: 4,
      bodyStartOffset: astral.indexOf("body"),
    });
    expect(Buffer.byteLength(astral.slice(0, astral.indexOf("body")), "utf8")).not.toBe(
      astral.indexOf("body"),
    );
    expect(envelope("---\r\nname: empty\r\n---").result).toMatchObject({
      body: "",
      bodyStartLine: 4,
      bodyStartOffset: 21,
    });
    expect(envelope("---\n---").result).toMatchObject({
      body: "",
      bodyStartLine: 3,
      bodyStartOffset: 7,
    });
    expect(envelope("---\n---\n").result).toMatchObject({
      body: "",
      bodyStartLine: 3,
      bodyStartOffset: 8,
    });
    const mixed = "---\r\nname: mixed\r---\n\nbody";
    expect(envelope(mixed).result).toMatchObject({
      body: "\nbody",
      bodyStartLine: 4,
      bodyStartOffset: mixed.indexOf("\nbody"),
    });
    for (const text of [astral, "---\r\nname: empty\r\n---", "---\n---", "---\n---\n", mixed]) {
      const result = projected(text);
      expect(result.ok && result.envelope).toEqual(envelope(text).result);
    }
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
    const exactDocument = `---\n${exact}\n---\nbody`;
    expect(envelope(exactDocument).result?.yaml).toHaveLength(MAX_SKILL_FRONTMATTER_BYTES);
    expect(projected(exactDocument).ok).toBe(true);
    const tooLarge = envelope(`---\n${exact}x\n---\nbody`);
    expect(tooLarge.result).toBeUndefined();
    expect(tooLarge.report.diagnostics[0]?.code).toBe("skill.frontmatter.too_large");
    expect(projected(`---\n${exact}x\n---\nbody`)).toEqual({
      ok: false,
      reason: "frontmatter_too_large",
    });
    expect(projected(`---\n---\n${"x".repeat(512 * 1024 + 1)}`).ok).toBe(true);
  });

  it("counts multibyte frontmatter by UTF-8 bytes", () => {
    const emojiBytes = MAX_SKILL_FRONTMATTER_BYTES - 4;
    const text = `${"😀".repeat(emojiBytes / 4)}xxx`;
    expect(envelope(`---\n${text}\n---\n`).result).toBeDefined();
    expect(envelope(`---\n${text}x\n---\n`).report.diagnostics[0]?.code).toBe(
      "skill.frontmatter.too_large",
    );
  });

  it("returns fixed frozen projection failures in lexical priority order", () => {
    const tooLarge = `---\n${"x".repeat(MAX_SKILL_FRONTMATTER_BYTES)}\n---\nbody`;
    const cases = [
      [7, "invalid_input"],
      ["\ufeff\u0001", "byte_order_mark"],
      ["not-frontmatter\u0001", "control_character"],
      ["not-frontmatter", "missing_frontmatter"],
      ["---\nnot-closed", "unclosed_frontmatter"],
      [tooLarge, "frontmatter_too_large"],
    ] as const;
    for (const [value, reason] of cases) {
      const first = projected(value);
      const second = projected(value);
      expect(first).toEqual({ ok: false, reason });
      expect(first).toBe(second);
      expect(Object.isFrozen(first)).toBe(true);
      expect(Object.keys(first)).toEqual(["ok", "reason"]);
    }
    const secret = "SECRET_CONTROL_DETAIL_9cd8";
    expect(JSON.stringify(projected(`---\n---\n${secret}\u0001`))).not.toContain(secret);
  });

  it("preserves every legacy control location through the diagnostic cap", () => {
    const text = `---\r\n---\r${"\u0001".repeat(300)}`;
    const diagnostics = envelope(text).report.diagnostics;
    const controls = diagnostics.filter(
      (diagnostic) => diagnostic.code === "skill.document.control_character",
    );
    expect(controls).toHaveLength(255);
    expect(controls[0]).toMatchObject({ line: 3, column: 1 });
    expect(controls[254]).toMatchObject({ line: 3, column: 255 });
    expect(diagnostics.filter((item) => item.code === "skill.diagnostics.truncated")).toHaveLength(
      1,
    );
    expect(projected(text)).toEqual({ ok: false, reason: "control_character" });
  });

  it("rejects boxed, proxy, and revoked inputs without observing properties", () => {
    let traps = 0;
    const proxy = new Proxy(new String("---\n---\n"), {
      get() {
        traps += 1;
        throw new Error("input getter used");
      },
    });
    const revoked = Proxy.revocable(new String("---\n---\n"), {
      get() {
        traps += 1;
        throw new Error("revoked getter used");
      },
    });
    revoked.revoke();
    for (const value of [new String("---\n---\n"), proxy, revoked.proxy, {}, [], null]) {
      expect(projected(value)).toEqual({ ok: false, reason: "invalid_input" });
    }
    expect(traps).toBe(0);
  });

  it("uses only module-initialization lexical and result intrinsics", () => {
    const objectConstructor = Object;
    const defineProperty = Object.defineProperty;
    const reflectDefineProperty = Reflect.defineProperty;
    const targets = [
      [Reflect, "apply"],
      [Buffer, "byteLength"],
      [String.prototype, "charCodeAt"],
      [String.prototype, "slice"],
      [objectConstructor, "defineProperty"],
      [objectConstructor, "freeze"],
      [Array.prototype, Symbol.iterator],
    ] as const;
    const descriptors = targets.map(([target, key]) =>
      objectConstructor.getOwnPropertyDescriptor(target, key),
    );
    let poisonCalls = 0;
    const poison = () => {
      poisonCalls += 1;
      throw new Error("live intrinsic used");
    };
    let success: ReturnType<typeof projectSkillDocumentEnvelope> | undefined;
    let control: ReturnType<typeof projectSkillDocumentEnvelope> | undefined;
    try {
      for (let index = 0; index < targets.length; index += 1) {
        const target = targets[index] as (typeof targets)[number];
        reflectDefineProperty(target[0], target[1], {
          configurable: true,
          value: poison,
          writable: true,
        });
      }
      globalThis.Object = poison as unknown as ObjectConstructor;
      success = projected("---\r\nname: safe\r\n---\r\nbody");
      control = projected("---\n---\nbody\u0001");
    } finally {
      globalThis.Object = objectConstructor;
      for (let index = targets.length - 1; index >= 0; index -= 1) {
        const target = targets[index] as (typeof targets)[number];
        reflectDefineProperty(target[0], target[1], descriptors[index] as PropertyDescriptor);
      }
      objectConstructor.defineProperty = defineProperty;
    }
    expect(success).toMatchObject({
      ok: true,
      envelope: { yaml: "name: safe\r\n", body: "body", bodyStartLine: 4 },
    });
    expect(control).toEqual({ ok: false, reason: "control_character" });
    expect(poisonCalls).toBe(0);
  });
});
