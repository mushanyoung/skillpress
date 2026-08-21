import type { Root } from "mdast";
import { describe, expect, it, vi } from "vitest";

import {
  analyzeMarkdown,
  isGenuineMarkdownAnalysis,
  MAX_SKILL_MARKDOWN_AST_NODES,
} from "../src/validate/markdown-analysis.js";
import {
  classifySemanticTextPlaceholder,
  isGenuineSemanticTextPlaceholderClassification,
  MAX_SEMANTIC_TEXT_CODE_UNITS,
} from "../src/validate/semantic-text-placeholder.js";

const ANALYSIS_MODULE = "../src/validate/markdown-analysis.js";
const SEMANTIC_MODULE = "../src/validate/semantic-text-placeholder.js";
const defineProperty = Object.defineProperty;

function root(children: unknown[] = []): Root {
  return { type: "root", children } as Root;
}

function text(value: string): unknown {
  return { type: "text", value };
}

function paragraph(children: unknown[], line = 1): unknown {
  return { type: "paragraph", children, position: { start: { line, column: 1 } } };
}

function container(type: string, children: unknown[]): unknown {
  return { type, children };
}

function transparent(type: string): unknown {
  return { type, url: "x", identifier: "x", referenceType: "full", children: [text("DO")] };
}

function analyzeTree(children: unknown[], source = "x\n".repeat(32)) {
  return analyzeMarkdown(source, () => root(children));
}

function legacyRegExpState(): readonly string[] {
  const aliases = RegExp as unknown as Readonly<Record<string, string>>;
  return [
    RegExp.input,
    RegExp.$_,
    RegExp.lastMatch,
    RegExp.lastParen,
    RegExp.leftContext,
    RegExp.rightContext,
    aliases["$&"],
    aliases["$+"],
    aliases["$`"],
    aliases["$'"],
    ...Array.from({ length: 9 }, (_, index) => aliases[`$${index + 1}`] as string),
  ];
}

describe("Markdown semantic placeholder projection", () => {
  it("classifies real visible blocks once in source order", () => {
    const report = analyzeMarkdown(
      [
        "# TO*DO*",
        "",
        "[**TODO**](resource.md)",
        "",
        "![TODO](asset.png)",
        "",
        "ordinary  ",
        "TODO",
      ].join("\n"),
    );

    expect(report.issues).toEqual([]);
    expect(report.headings[0]?.text).toBe("TODO");
    expect(report.targets.map(({ kind }) => kind)).toEqual(["link", "image"]);
    expect(report.placeholderFindings).toEqual([
      { location: { line: 1, column: 1 } },
      { location: { line: 3, column: 1 } },
      { location: { line: 5, column: 1 } },
      { location: { line: 7, column: 1 } },
    ]);
  });

  it("honors transparent content, reachable outers, barriers, and segment authority", () => {
    const formats = ["emphasis", "strong", "delete", "link", "linkReference"].map((type, index) =>
      paragraph([text("TO"), transparent(type)], index + 1),
    );
    const table = container("table", [
      container("tableRow", [
        {
          type: "tableCell",
          children: [text("TODO")],
          position: { start: { line: 6, column: 1 } },
        },
      ]),
    ]);
    const outerChain = container("blockquote", [
      container("list", [
        container("listItem", [container("footnoteDefinition", [paragraph([text("TODO")], 7)])]),
      ]),
    ]);
    const report = analyzeTree([
      ...formats,
      table,
      outerChain,
      paragraph(
        [{ type: "imageReference", identifier: "img", referenceType: "full", alt: "TODO" }],
        8,
      ),
      paragraph([text("TO"), { type: "inlineCode", value: "DO" }, text("DO")], 9),
      paragraph([text("TO"), { type: "image", url: "TODO", alt: "" }, text("DO")], 10),
      paragraph([{ type: "heading", depth: 1, children: [text("TODO")] }], 11),
      { type: "code", children: [paragraph([text("TODO")], 12)] },
      { type: "html", children: [paragraph([text("TODO")], 13)] },
      { type: "yaml", children: [paragraph([text("TODO")], 14)] },
    ]);

    expect(report.issues).toEqual([]);
    expect(report.placeholderFindings.map(({ location }) => location.line)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8,
    ]);
  });

  it("keeps the frozen property-repository holdout text safe without a repository dependency", () => {
    const safe = [
      "REPLACE after parcel-source verification",
      "For this fictional template, the official rule source states that the assessed value directly equals the fair market comparison value. Replace this with the actual jurisdiction-specific transformation.",
      "Example fixed deadline for this fictional template; replace it with the current official rule for the actual locality.",
      "Example sale window for the fictional template; replace with the current official jurisdiction-specific rule.",
      "Describe the verified condition, notice, repair program, litigation, insurance issue, or other fact without making an unsupported legal conclusion.",
    ];
    for (const value of safe) {
      const report = analyzeTree([paragraph([text(value)])]);
      expect(report.issues).toEqual([]);
      expect(report.placeholderFindings).toEqual([]);
    }
  });

  it("enforces per-block UTF-16 bounds and reports the block start", () => {
    const exactAstral = analyzeTree([
      paragraph([text("😀".repeat(MAX_SEMANTIC_TEXT_CODE_UNITS / 2))], 1),
    ]);
    const exactMarker = analyzeTree([
      paragraph([text("TODO\n"), text("a".repeat(MAX_SEMANTIC_TEXT_CODE_UNITS - 5))], 2),
    ]);
    const overflow = analyzeTree([
      paragraph([text("TODO\n"), text("a".repeat(MAX_SEMANTIC_TEXT_CODE_UNITS - 4))], 3),
    ]);
    const astralOverflow = analyzeTree([
      paragraph([text(`${"😀".repeat(MAX_SEMANTIC_TEXT_CODE_UNITS / 2)}a`)], 4),
    ]);

    expect(exactAstral.issues).toEqual([]);
    expect(exactMarker.placeholderFindings).toEqual([{ location: { line: 2, column: 1 } }]);
    for (const [report, line] of [
      [overflow, 3],
      [astralOverflow, 4],
    ] as const) {
      expect(report.placeholderFindings).toEqual([]);
      expect(report.issues).toEqual([
        {
          code: "skill.markdown.complexity",
          message: "Markdown semantic text exceeds 524288 UTF-16 code units",
          location: { line, column: 1 },
        },
      ]);
    }
  });

  it("counts shared and cyclic semantic occurrences and reserves overflow before slots", () => {
    const leaf = { type: "thematicBreak" };
    const bulk = {
      type: "emphasis",
      children: Array.from({ length: MAX_SKILL_MARKDOWN_AST_NODES - 3 }, () => leaf),
      position: { start: { line: 8, column: 1 } },
    };
    const exact = analyzeTree([paragraph([bulk, { type: "emphasis", children: [leaf] }], 7)]);
    let lateReads = 0;
    const late: unknown[] = new Array(2);
    defineProperty(late, 0, {
      configurable: true,
      enumerable: true,
      get() {
        lateReads += 1;
        return leaf;
      },
    });
    const overflow = analyzeTree([paragraph([bulk, { type: "emphasis", children: late }], 7)]);
    const cycle = { type: "strong", children: [] as unknown[] };
    defineProperty(cycle.children, 0, { enumerable: true, value: cycle });
    const cyclic = analyzeTree([paragraph([cycle], 9)]);

    expect(exact.issues[0]?.location).toEqual({ line: 8, column: 1 });
    expect(overflow.issues[0]?.location).toEqual({ line: 7, column: 1 });
    expect(overflow.issues[0]?.message).toBe(
      `Markdown node count exceeds ${MAX_SKILL_MARKDOWN_AST_NODES}`,
    );
    expect(lateReads).toBe(0);
    expect(cyclic.issues[0]).toMatchObject({
      code: "skill.markdown.complexity",
      location: { line: 9, column: 1 },
    });
  });

  it("contains hostile classifier producers, brands, and predicates", async () => {
    vi.resetModules();
    const foreign = await import(SEMANTIC_MODULE);
    const safe = classifySemanticTextPlaceholder("ordinary");
    const invalid = classifySemanticTextPlaceholder(Symbol("private"));
    const tooLarge = classifySemanticTextPlaceholder("x".repeat(MAX_SEMANTIC_TEXT_CODE_UNITS + 1));
    const placeholder = classifySemanticTextPlaceholder("TODO");
    let producer: (value: unknown) => unknown = classifySemanticTextPlaceholder;
    let predicate: (value: unknown) => unknown = isGenuineSemanticTextPlaceholderClassification;
    const seen: string[] = [];
    const mockedSemantic = {
      MAX_SEMANTIC_TEXT_CODE_UNITS,
      classifySemanticTextPlaceholder(value: unknown) {
        if (typeof value === "string") seen.push(value);
        return producer(value);
      },
      isGenuineSemanticTextPlaceholderClassification(value: unknown) {
        return predicate(value);
      },
    };
    vi.doMock(SEMANTIC_MODULE, () => mockedSemantic);
    try {
      const isolated: typeof import("../src/validate/markdown-analysis.js") = await import(
        ANALYSIS_MODULE
      );
      const run = (children: unknown[]) => isolated.analyzeMarkdown("safe", () => root(children));
      const boundaryOnly = run([
        paragraph([
          { type: "break" },
          text(""),
          { type: "inlineCode", value: "TODO" },
          { type: "html", value: "TODO" },
          { type: "code", value: "TODO" },
          { type: "yaml", value: "TODO" },
          { type: "footnoteReference", identifier: "TODO" },
          { type: "definition", identifier: "TODO", url: "TODO" },
          { type: "image", url: "TODO" },
          { type: "image", url: "TODO", alt: "" },
          { type: "imageReference", identifier: "id", referenceType: "full", alt: null },
          {
            type: "linkReference",
            identifier: "TODO",
            referenceType: "full",
            children: [],
          },
        ]),
      ]);
      expect(boundaryOnly.issues).toEqual([]);
      expect(seen).toEqual([]);
      const barrier = run([
        paragraph([text("TO"), { type: "image", url: "safe", alt: "" }, text("DO")]),
      ]);
      expect(barrier.placeholderFindings).toEqual([]);
      expect(seen).toEqual(["TO DO"]);
      seen.length = 0;
      producer = () => placeholder;
      mockedSemantic.classifySemanticTextPlaceholder = () => {
        throw new Error("live classifier export observed");
      };
      mockedSemantic.isGenuineSemanticTextPlaceholderClassification = () => false;
      expect(run([paragraph([text("TODO")])]).placeholderFindings).toHaveLength(1);
      expect(seen).toEqual(["TODO"]);

      const parseFailures = [];
      producer = () => {
        throw new Error("private producer detail");
      };
      parseFailures.push(run([paragraph([text("TODO")])]));
      producer = () => foreign.classifySemanticTextPlaceholder("ordinary");
      parseFailures.push(run([paragraph([text("TODO")])]));
      producer = () => structuredClone(safe);
      parseFailures.push(run([paragraph([text("TODO")])]));
      let proxyTraps = 0;
      const proxy = new Proxy(safe, {
        get() {
          proxyTraps += 1;
          throw new Error("classification trap");
        },
        getOwnPropertyDescriptor() {
          proxyTraps += 1;
          throw new Error("classification trap");
        },
      });
      producer = () => proxy;
      parseFailures.push(run([paragraph([text("TODO")])]));
      producer = () => invalid;
      parseFailures.push(run([paragraph([text("TODO")])]));
      let classificationReads = 0;
      const accessorClassification = {};
      defineProperty(accessorClassification, "ok", {
        get() {
          classificationReads += 1;
          throw new Error("classification accessor observed");
        },
      });
      producer = () => accessorClassification;
      predicate = () => true;
      parseFailures.push(run([paragraph([text("TODO")])]));
      producer = () => safe;
      predicate = () => 1;
      parseFailures.push(run([paragraph([text("TODO")])]));
      predicate = () => {
        throw new Error("private predicate detail");
      };
      parseFailures.push(run([paragraph([text("TODO")])]));
      for (const report of parseFailures) {
        expect(report.issues[0]?.code).toBe("skill.markdown.parse");
        expect(report.placeholderFindings).toEqual([]);
      }
      expect(proxyTraps).toBe(0);
      expect(classificationReads).toBe(0);

      let produced = 0;
      producer = () => {
        produced += 1;
        return produced === 1 ? placeholder : tooLarge;
      };
      predicate = isGenuineSemanticTextPlaceholderClassification;
      const complex = run([paragraph([text("TODO")]), paragraph([text("TODO")], 2)]);
      expect(complex.placeholderFindings).toEqual([]);
      expect(complex.issues[0]).toEqual({
        code: "skill.markdown.complexity",
        message: "Markdown semantic text exceeds 524288 UTF-16 code units",
        location: { line: 2, column: 1 },
      });
    } finally {
      vi.doUnmock(SEMANTIC_MODULE);
      vi.resetModules();
    }
  });

  it("clears staged findings on late failure while retaining coexisting issues on success", () => {
    const failed = analyzeTree([paragraph([text("TODO")]), { type: "notMdast" }]);
    const coexist = analyzeTree([
      paragraph([text("TODO")]),
      { type: "definition", identifier: "same", url: "first" },
      { type: "definition", identifier: "same", url: "second" },
    ]);

    expect(failed.issues[0]?.code).toBe("skill.markdown.parse");
    expect(failed.placeholderFindings).toEqual([]);
    expect(coexist.placeholderFindings).toHaveLength(1);
    expect(coexist.issues[0]?.code).toBe("skill.markdown.duplicate_definition");
  });

  it("publishes a frozen raw-free location-only shape without changing RegExp legacy state", () => {
    const secret = "semantic-sentinel-private-value";
    const tree = root([paragraph([text(`TODO: ${secret}`)])]);
    /^(benign)-(state)$/u.exec("benign-state");
    const legacyBefore = legacyRegExpState();
    const report = analyzeMarkdown(secret, () => tree);
    const legacyAfter = legacyRegExpState();
    const failure = analyzeMarkdown(secret, () => {
      throw new Error(secret);
    });
    const finding = report.placeholderFindings[0];

    expect(legacyAfter).toEqual(legacyBefore);
    expect(Object.hasOwn(report, "placeholderFindings")).toBe(true);
    expect(Object.keys(report)).toContain("placeholderFindings");
    expect(Object.keys(finding ?? {})).toEqual(["location"]);
    expect(Object.getOwnPropertySymbols(finding ?? {})).toEqual([]);
    expect(Object.isFrozen(report)).toBe(true);
    expect(Object.isFrozen(report.placeholderFindings)).toBe(true);
    expect(Object.isFrozen(finding)).toBe(true);
    expect(Object.isFrozen(finding?.location)).toBe(true);
    expect(isGenuineMarkdownAnalysis(report)).toBe(true);
    expect(JSON.stringify(report)).not.toContain(secret);
    expect(Object.hasOwn(failure, "placeholderFindings")).toBe(true);
    expect(Object.isFrozen(failure.placeholderFindings)).toBe(true);
    expect(failure.placeholderFindings).toEqual([]);
    expect(JSON.stringify(failure)).not.toContain(secret);
  });
});
