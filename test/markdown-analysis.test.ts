import { describe, expect, it } from "vitest";
import type { Root } from "mdast";

import {
  analyzeMarkdown,
  MAX_SKILL_MARKDOWN_AST_NODES,
  MAX_SKILL_MARKDOWN_DEFINITIONS_PER_FILE,
  MAX_SKILL_MARKDOWN_SOURCE_BYTES,
  MAX_SKILL_MARKDOWN_SYNTAX_MARKERS,
  MAX_SKILL_MARKDOWN_TARGETS_PER_FILE,
} from "../src/validate/markdown-analysis.js";

describe("bounded Markdown analysis", () => {
  it("extracts inline and definition-backed links and images in source order", () => {
    const report = analyzeMarkdown(
      [
        "# Read *carefully*",
        "",
        "Use [inline](references/inline.md) and ![asset](assets/icon.png).",
        "Then read [the guide][guide] and ![diagram][diagram].",
        "",
        "[guide]: references/guide.md",
        "[diagram]: assets/diagram.svg",
        "[unused]: references/unused.md",
      ].join("\n"),
    );

    expect(report.issues).toEqual([]);
    expect(report.targets).toEqual([
      {
        kind: "link",
        form: "inline",
        url: "references/inline.md",
        location: { line: 3, column: 5 },
        destinationLocation: { line: 3, column: 5 },
      },
      {
        kind: "image",
        form: "inline",
        url: "assets/icon.png",
        location: { line: 3, column: 40 },
        destinationLocation: { line: 3, column: 40 },
      },
      {
        kind: "link",
        form: "reference",
        url: "references/guide.md",
        location: { line: 4, column: 11 },
        destinationLocation: { line: 6, column: 1 },
        referenceType: "full",
        definition: {
          identifier: "guide",
          url: "references/guide.md",
          location: { line: 6, column: 1 },
        },
      },
      {
        kind: "image",
        form: "reference",
        url: "assets/diagram.svg",
        location: { line: 4, column: 34 },
        destinationLocation: { line: 7, column: 1 },
        referenceType: "full",
        definition: {
          identifier: "diagram",
          url: "assets/diagram.svg",
          location: { line: 7, column: 1 },
        },
      },
    ]);
    expect(report.headings).toEqual([
      { depth: 1, text: "Read carefully", location: { line: 1, column: 1 } },
    ]);
    expect(report.unusedDefinitions).toEqual([
      {
        identifier: "unused",
        url: "references/unused.md",
        location: { line: 8, column: 1 },
      },
    ]);
    expect(report.definitions).toHaveLength(3);
    expect(report.nodeCount).toBeGreaterThan(0);
    expect(report.lineCount).toBe(8);
  });

  it("ignores link-like text inside code and raw HTML", () => {
    const report = analyzeMarkdown(
      [
        "`[inline](ignored.md)`",
        "",
        "```md",
        "[flow](ignored.md)",
        "```",
        "",
        '<a href="ignored.md">raw</a>',
        "",
        "<https://example.com>",
      ].join("\n"),
    );
    expect(report.targets).toEqual([
      {
        kind: "link",
        form: "inline",
        url: "https://example.com",
        location: { line: 9, column: 1 },
        destinationLocation: { line: 9, column: 1 },
      },
    ]);
  });

  it("reports normalized duplicate definitions and keeps the first destination", () => {
    const report = analyzeMarkdown(
      "[guide][Some  ID]\n\n[some id]: references/first.md\n[SOME\tID]: references/second.md\n",
    );
    expect(report.targets).toEqual([
      {
        kind: "link",
        form: "reference",
        url: "references/first.md",
        location: { line: 1, column: 1 },
        destinationLocation: { line: 3, column: 1 },
        referenceType: "full",
        definition: {
          identifier: "some id",
          url: "references/first.md",
          location: { line: 3, column: 1 },
        },
      },
    ]);
    expect(report.issues).toEqual([
      {
        code: "skill.markdown.duplicate_definition",
        message: "Markdown reference definitions must be unique",
        location: { line: 4, column: 1 },
      },
    ]);
  });

  it("preserves source order when definition-backed and inline targets are interleaved", () => {
    const report = analyzeMarkdown(
      "[first][guide] then [second](references/second.md)\n\n[guide]: references/first.md\n",
    );
    expect(report.targets.map(({ url }) => url)).toEqual([
      "references/first.md",
      "references/second.md",
    ]);
  });

  it("preserves full, collapsed, shortcut, and image reference provenance", () => {
    const report = analyzeMarkdown(
      [
        "[full][id] [collapsed][] [shortcut] ![image][picture]",
        "",
        "[id]: references/full.md",
        "[collapsed]: references/collapsed.md",
        "[shortcut]: references/shortcut.md",
        "[picture]: assets/picture.png",
      ].join("\n"),
    );
    expect(
      report.targets.map(({ kind, referenceType, definition }) => ({
        kind,
        referenceType,
        identifier: definition?.identifier,
      })),
    ).toEqual([
      { kind: "link", referenceType: "full", identifier: "id" },
      { kind: "link", referenceType: "collapsed", identifier: "collapsed" },
      { kind: "link", referenceType: "shortcut", identifier: "shortcut" },
      { kind: "image", referenceType: "full", identifier: "picture" },
    ]);
    for (const item of report.targets) {
      expect(item.definition).toBe(
        report.definitions.find(({ identifier }) => identifier === item.definition?.identifier),
      );
    }
  });

  it("returns destinations after CommonMark escape and character-reference decoding", () => {
    const report = analyzeMarkdown(
      [
        String.raw`[escaped](references/a\(b\).md)`,
        "[entity](references/a&amp;b.md)",
        "[space](<references/with space.md>)",
      ].join("\n"),
    );
    expect(report.targets.map(({ url }) => url)).toEqual([
      "references/a(b).md",
      "references/a&b.md",
      "references/with space.md",
    ]);
  });

  it("leaves unresolved and malformed reference syntax as inert text", () => {
    const report = analyzeMarkdown("[missing][definition] [broken](\n");
    expect(report.targets).toEqual([]);
    expect(report.definitions).toEqual([]);
    expect(report.issues).toEqual([]);
  });

  it("counts CRLF and lone CR line endings exactly", () => {
    const report = analyzeMarkdown("# One\r\n\r# Two\n");
    expect(report.lineCount).toBe(4);
    expect(report.headings.map(({ text, location }) => ({ text, location }))).toEqual([
      { text: "One", location: { line: 1, column: 1 } },
      { text: "Two", location: { line: 3, column: 1 } },
    ]);
    expect(analyzeMarkdown("").lineCount).toBe(0);
    expect(analyzeMarkdown("plain").nodeCount).toBe(3);
  });

  it("uses visible heading text without copying raw HTML and preserves image alt text", () => {
    const report = analyzeMarkdown(
      "# A <em>B</em> ![diagram](assets/diagram.png) `code` [label](https://example.com)\n",
    );
    expect(report.headings).toEqual([
      {
        depth: 1,
        text: "A B diagram code label",
        location: { line: 1, column: 1 },
      },
    ]);
  });

  it("accepts the exact target budget and fails closed at plus one", () => {
    const exactSource = Array.from(
      { length: MAX_SKILL_MARKDOWN_TARGETS_PER_FILE },
      (_, index) => `[${index}](references/${index}.md)`,
    ).join(" ");
    const exact = analyzeMarkdown(exactSource);
    const overflow = analyzeMarkdown(`${exactSource} [overflow](references/overflow.md)`);
    expect(exact.targets).toHaveLength(MAX_SKILL_MARKDOWN_TARGETS_PER_FILE);
    expect(exact.issues).toEqual([]);
    expect(overflow.targets).toEqual([]);
    expect(overflow.issues[0]).toMatchObject({ code: "skill.markdown.too_many_targets" });
  });

  it("accepts the exact definition budget and fails closed at plus one", () => {
    const exactSource = Array.from(
      { length: MAX_SKILL_MARKDOWN_DEFINITIONS_PER_FILE },
      (_, index) => `[definition-${index}]: a`,
    ).join("\n");
    const exact = analyzeMarkdown(exactSource);
    const overflow = analyzeMarkdown(`${exactSource}\n[overflow]: a`);
    expect(exact.definitions).toHaveLength(MAX_SKILL_MARKDOWN_DEFINITIONS_PER_FILE);
    expect(exact.issues).toEqual([]);
    expect(overflow.definitions).toEqual([]);
    expect(overflow.issues[0]).toMatchObject({ code: "skill.markdown.too_many_definitions" });
  });

  it("fails closed when the post-parse node budget is exceeded", () => {
    const oversizedTree: Root = {
      type: "root",
      children: Array.from({ length: MAX_SKILL_MARKDOWN_AST_NODES }, () => ({
        type: "thematicBreak" as const,
      })),
    };
    const report = analyzeMarkdown("inert", () => oversizedTree);
    expect(report.targets).toEqual([]);
    expect(report.issues).toHaveLength(1);
    expect(report.issues[0]).toMatchObject({ code: "skill.markdown.complexity" });
    expect(report.nodeCount).toBe(0);
  });

  it("rejects source and syntax budgets before invoking the CommonMark parser", () => {
    let calls = 0;
    const parse = (): Root => {
      calls += 1;
      return { type: "root", children: [] };
    };
    const exactAscii = analyzeMarkdown("x".repeat(MAX_SKILL_MARKDOWN_SOURCE_BYTES), parse);
    const exactUtf8 = analyzeMarkdown("😀".repeat(MAX_SKILL_MARKDOWN_SOURCE_BYTES / 4), parse);
    const exactMarkers = analyzeMarkdown("[".repeat(MAX_SKILL_MARKDOWN_SYNTAX_MARKERS), parse);
    const tooLarge = analyzeMarkdown("x".repeat(MAX_SKILL_MARKDOWN_SOURCE_BYTES + 1), parse);
    const tooManyUtf8Bytes = analyzeMarkdown(
      "😀".repeat(MAX_SKILL_MARKDOWN_SOURCE_BYTES / 4 + 1),
      parse,
    );
    const tooComplex = analyzeMarkdown("[".repeat(MAX_SKILL_MARKDOWN_SYNTAX_MARKERS + 1), parse);
    expect(calls).toBe(3);
    expect(exactAscii.issues).toEqual([]);
    expect(exactUtf8.issues).toEqual([]);
    expect(exactMarkers.issues).toEqual([]);
    for (const report of [tooLarge, tooManyUtf8Bytes]) {
      expect(report.issues[0]?.code).toBe("skill.markdown.too_large");
      expect(report.lineCount).toBe(0);
      expect(report.nodeCount).toBe(0);
    }
    expect(tooComplex.issues[0]?.code).toBe("skill.markdown.complexity");
    expect(tooComplex.nodeCount).toBe(0);
  });

  it("normalizes parser failures without reflecting their errors", () => {
    const report = analyzeMarkdown("safe", () => {
      throw new Error("attacker-controlled parser detail");
    });
    expect(report.issues).toEqual([
      { code: "skill.markdown.parse", message: "Markdown could not be parsed safely" },
    ]);
  });

  it("returns a deeply frozen inert summary", () => {
    const report = analyzeMarkdown(
      [
        "# Heading ![diagram](assets/diagram.png)",
        "",
        "[used][definition]",
        "",
        "[definition]: references/used.md",
        "[unused]: references/unused.md",
        "[DEFINITION]: references/duplicate.md",
      ].join("\n"),
    );
    expect(Object.isFrozen(report)).toBe(true);
    expect(Object.isFrozen(report.targets)).toBe(true);
    expect(Object.isFrozen(report.targets[0])).toBe(true);
    expect(Object.isFrozen(report.targets[0]?.location)).toBe(true);
    expect(Object.isFrozen(report.targets[0]?.destinationLocation)).toBe(true);
    expect(Object.isFrozen(report.targets[1]?.definition)).toBe(true);
    expect(Object.isFrozen(report.headings)).toBe(true);
    expect(Object.isFrozen(report.headings[0])).toBe(true);
    expect(Object.isFrozen(report.headings[0]?.location)).toBe(true);
    expect(Object.isFrozen(report.definitions)).toBe(true);
    expect(Object.isFrozen(report.definitions[0])).toBe(true);
    expect(Object.isFrozen(report.definitions[0]?.location)).toBe(true);
    expect(Object.isFrozen(report.unusedDefinitions)).toBe(true);
    expect(Object.isFrozen(report.unusedDefinitions[0])).toBe(true);
    expect(Object.isFrozen(report.unusedDefinitions[0]?.location)).toBe(true);
    expect(Object.isFrozen(report.issues)).toBe(true);
    expect(Object.isFrozen(report.issues[0])).toBe(true);
    expect(Object.isFrozen(report.issues[0]?.location)).toBe(true);
    expect(report.nodeCount).toBeGreaterThan(0);
  });
});
