import { Buffer } from "node:buffer";
import { posix, win32 } from "node:path";

import { describe, expect, it } from "vitest";

import {
  classifyMarkdownDestination,
  isCanonicalDecodedMarkdownLocalComponent,
  MAX_SKILL_REFERENCE_COMPONENT_BYTES,
  MAX_SKILL_REFERENCE_DESTINATION_BYTES,
  MAX_SKILL_REFERENCE_PATH_COMPONENTS,
} from "../src/validate/markdown-destination.js";
import { analyzeMarkdown } from "../src/validate/markdown-analysis.js";

function local(path: string) {
  const components = path.split("/");
  return {
    kind: "local",
    path,
    components,
  };
}

describe("Markdown destination classification", () => {
  it("recognizes document-local and external destinations without fetching them", () => {
    for (const value of [
      "",
      "#section",
      "?view=compact",
      "?#section",
      "#cafe\u0301",
      "?q=cafe\u0301",
      "#a\\b",
      "?q=a\\b",
    ]) {
      expect(classifyMarkdownDestination(value)).toEqual({ kind: "document" });
    }
    for (const value of [
      "https://example.com/reference",
      "http://example.com",
      "ftp://example.com/archive",
      "mailto:owner@example.com",
      "mailto:",
      "custom:",
      "git+ssh://example.com/repository",
      "https:example.com",
      "https:/example.com",
      "https:///example.com",
      "https://example.com/cafe\u0301",
      "custom:cafe\u0301",
      "//cdn.example.com/diagram.png",
    ]) {
      expect(classifyMarkdownDestination(value)).toEqual({ kind: "external" });
    }
  });

  it("returns a decoded canonical skill-root-relative local path", () => {
    const cases = [
      ["references/guide.md", "references/guide.md"],
      ["assets/a%20diagram.png#overview", "assets/a diagram.png"],
      ["references/%E6%8C%87%E5%8D%97.md", "references/指南.md"],
      ["scripts/😀.js", "scripts/😀.js"],
      ["scripts/a+b.js", "scripts/a+b.js"],
      ["leading space/file.md", "leading space/file.md"],
      ["references/guide.md#cafe\u0301", "references/guide.md"],
      ["references/guide.md#a\\b", "references/guide.md"],
    ] as const;
    for (const [value, path] of cases) {
      expect(classifyMarkdownDestination(value)).toEqual(local(path));
    }
  });

  it("shares the exact domain of one already-decoded local component", () => {
    const accepted = ["guide.md", "a b.md", "é.md", "😀".repeat(63), "\u0378.md"];
    for (const value of accepted) {
      expect(isCanonicalDecodedMarkdownLocalComponent(value)).toBe(true);
      expect(classifyMarkdownDestination(value)).toEqual(local(value));
    }

    const rejected = [
      undefined,
      null,
      7,
      "",
      ".",
      "..",
      "/",
      "\\",
      "%",
      "#",
      "?",
      "\u00a0",
      "e\u0301.md",
      "bad\u2060.md",
      "bad\ud800.md",
      `${String.fromCodePoint(0xfdd0)}.md`,
      "a".repeat(MAX_SKILL_REFERENCE_COMPONENT_BYTES + 1),
      "😀".repeat(64),
      "CON.txt",
      "name:stream",
      "trailing.",
      "trailing ",
    ];
    for (const value of rejected) {
      expect(isCanonicalDecodedMarkdownLocalComponent(value)).toBe(false);
    }
    expect(classifyMarkdownDestination("\u00a0")).toEqual({
      kind: "invalid",
      reason: "nonportable_component",
    });

    for (const raw of ["references/guide.md", "assets/a%20diagram.png#part", "\u0378/ok"]) {
      const result = classifyMarkdownDestination(raw);
      expect(result.kind).toBe("local");
      if (result.kind === "local") {
        for (const component of result.components) {
          expect(isCanonicalDecodedMarkdownLocalComponent(component)).toBe(true);
        }
      }
    }
  });

  it("rejects unsafe or malformed external forms", () => {
    const cases = [
      ["file:///etc/passwd", "unsafe_scheme"],
      ["javascript:alert(1)", "unsafe_scheme"],
      ["DATA:text/plain,hello", "unsafe_scheme"],
      ["vbscript:msgbox(1)", "unsafe_scheme"],
      ["https://example.com/bad path", "invalid_external"],
      ["https:\\example.com", "backslash"],
      ["//", "invalid_external"],
      ["///etc/passwd", "absolute_path"],
      ["//?/C:/Windows", "absolute_path"],
      ["//./pipe/skillpress", "absolute_path"],
      ["//example.com\\share", "backslash"],
      ["//example.com/bad path", "invalid_external"],
    ] as const;
    for (const [value, reason] of cases) {
      expect(classifyMarkdownDestination(value)).toEqual({ kind: "invalid", reason });
    }
    for (const scheme of ["CON", "prn", "Aux", "NUL", "COM1", "com9", "LPT1", "lpt9"]) {
      expect(classifyMarkdownDestination(`${scheme}:payload`)).toEqual({
        kind: "invalid",
        reason: "unsafe_scheme",
      });
    }
  });

  it("rejects absolute, query-bearing, backslash, drive, and structural aliases", () => {
    const cases = [
      ["/etc/passwd", "absolute_path"],
      ["C:/Windows/system.ini", "windows_drive"],
      ["C:relative.txt", "windows_drive"],
      ["references\\guide.md", "backslash"],
      ["references/guide.md?raw=1", "query"],
      ["./references/guide.md", "dot_component"],
      ["references/../secret", "dot_component"],
      ["references//guide.md", "empty_component"],
      ["references/", "empty_component"],
    ] as const;
    for (const [value, reason] of cases) {
      expect(classifyMarkdownDestination(value)).toEqual({ kind: "invalid", reason });
    }
    for (const letter of "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz") {
      for (const suffix of ["", "relative", "/absolute", "\\absolute"]) {
        expect(classifyMarkdownDestination(`${letter}:${suffix}`)).toEqual({
          kind: "invalid",
          reason: "windows_drive",
        });
      }
      expect(classifyMarkdownDestination(`${letter}%3Arelative`)).toEqual({
        kind: "invalid",
        reason: "encoded_delimiter",
      });
    }
    for (const value of [
      "\\\\server\\share",
      "\\\\?\\C:\\safe",
      "\\\\.\\pipe\\skillpress",
      "\\??\\C:\\safe",
    ]) {
      expect(classifyMarkdownDestination(value)).toEqual({ kind: "invalid", reason: "backslash" });
    }
  });

  it("decodes once and rejects encoded traversal, separators, delimiters, and ambiguity", () => {
    const cases = [
      ["references/%2e%2e/secret", "dot_component"],
      ["references/.%2e/secret", "dot_component"],
      ["references/%2e./secret", "dot_component"],
      ["references%2fguide.md", "encoded_separator"],
      ["references%5Cguide.md", "encoded_separator"],
      ["references/%23hidden", "encoded_delimiter"],
      ["references/%3Fquery", "encoded_delimiter"],
      ["references/%3Astream", "encoded_delimiter"],
      ["references/%25guide", "ambiguous_encoding"],
      ["references/%252e%252e/secret", "ambiguous_encoding"],
      ["references/%E0%A4%A", "malformed_encoding"],
      ["references/%C0%AE", "malformed_encoding"],
      ["references/%ED%A0%80", "malformed_encoding"],
      ["references/%F4%90%80%80", "malformed_encoding"],
      ["references/%F4%8F%BF%BF", "unsafe_unicode"],
      ["references/100%guide", "malformed_encoding"],
      ["references/e%CC%81.md", "non_nfc"],
      ["references/trailing%2e", "nonportable_component"],
      ["references/trailing%20", "nonportable_component"],
    ] as const;
    for (const [value, reason] of cases) {
      expect(classifyMarkdownDestination(value)).toEqual({ kind: "invalid", reason });
    }
  });

  it("enforces Unicode normalization and cross-platform component rules", () => {
    const unsafe = [
      ["references/e\u0301.md", "non_nfc"],
      ["references/bad\u2060name.md", "unsafe_unicode"],
      ["references/bad\ud800name.md", "unsafe_unicode"],
      [`references/${String.fromCodePoint(0xfdd0)}.md`, "unsafe_unicode"],
      ["references/CON.txt", "nonportable_component"],
      ["references/CONIN$", "nonportable_component"],
      ["references/CONOUT$.txt", "nonportable_component"],
      ["references/CLOCK$", "nonportable_component"],
      ["references/COM¹.log", "nonportable_component"],
      ["references/name:stream", "nonportable_component"],
      ["references/trailing.", "nonportable_component"],
      ["references/trailing ", "nonportable_component"],
      ["references/<bad>.md", "nonportable_component"],
      ["references/file::$DATA", "nonportable_component"],
      ["references/가.md", "non_nfc"],
    ] as const;
    for (const [value, reason] of unsafe) {
      expect(classifyMarkdownDestination(value)).toEqual({ kind: "invalid", reason });
    }
    expect(classifyMarkdownDestination("references/é.md")).toEqual(local("references/é.md"));
    expect(classifyMarkdownDestination("references/가.md")).toEqual(local("references/가.md"));
    for (const value of [
      "references/COM0",
      "references/COM10",
      "references/COM⁴",
      "references/CONSOLE",
    ]) {
      expect(classifyMarkdownDestination(value)).toEqual(local(value));
    }
  });

  it("classifies already-decoded CommonMark targets exactly once", () => {
    const analysis = analyzeMarkdown(
      [
        "[escaped](references/a\\(b\\).md)",
        "[entity](references/a&amp;b.md)",
        "[angle](<references/a b.md>)",
        "[percent](references/a%20b.md)",
        "[fragment](references/guide.md#part)",
        "[external](https://example.com/reference)",
      ].join("\n"),
    );
    expect(analysis.issues).toEqual([]);
    expect(analysis.targets.map((target) => target.url)).toEqual([
      "references/a(b).md",
      "references/a&b.md",
      "references/a b.md",
      "references/a%20b.md",
      "references/guide.md#part",
      "https://example.com/reference",
    ]);
    expect(analysis.targets.map((target) => classifyMarkdownDestination(target.url))).toEqual([
      local("references/a(b).md"),
      local("references/a&b.md"),
      local("references/a b.md"),
      local("references/a b.md"),
      local("references/guide.md"),
      { kind: "external" },
    ]);
  });

  it("rejects every control and Unicode noncharacter before path use", () => {
    const controls = [
      ...Array.from({ length: 0x20 }, (_, codePoint) => String.fromCodePoint(codePoint)),
      ...Array.from({ length: 0x21 }, (_, offset) => String.fromCodePoint(0x7f + offset)),
    ];
    const noncharacters = [
      ...Array.from({ length: 0x20 }, (_, offset) => String.fromCodePoint(0xfdd0 + offset)),
      ...Array.from({ length: 17 }, (_, plane) => String.fromCodePoint(plane * 0x1_0000 + 0xfffe)),
      ...Array.from({ length: 17 }, (_, plane) => String.fromCodePoint(plane * 0x1_0000 + 0xffff)),
    ];
    for (const character of [
      ...controls,
      ...noncharacters,
      "\u200b",
      "\u2060",
      "\ufe0f",
      String.fromCodePoint(0xe0100),
      "\ud800",
      "\udfff",
    ]) {
      expect(classifyMarkdownDestination(`references/a${character}b.md`)).toEqual({
        kind: "invalid",
        reason: "unsafe_unicode",
      });
    }
    expect(classifyMarkdownDestination("references/%00.md")).toEqual({
      kind: "invalid",
      reason: "unsafe_unicode",
    });
  });

  it("applies exact byte, component, and depth boundaries", () => {
    const exactDestination = "a".repeat(MAX_SKILL_REFERENCE_DESTINATION_BYTES);
    expect(classifyMarkdownDestination(exactDestination)).toEqual({
      kind: "invalid",
      reason: "component_too_large",
    });
    expect(classifyMarkdownDestination(`${exactDestination}a`)).toEqual({
      kind: "invalid",
      reason: "too_large",
    });

    const exactPortableDestination = Array.from({ length: 17 }, () => "a".repeat(240)).join("/");
    expect(Buffer.byteLength(exactPortableDestination, "utf8")).toBe(
      MAX_SKILL_REFERENCE_DESTINATION_BYTES,
    );
    expect(classifyMarkdownDestination(exactPortableDestination)).toEqual(
      local(exactPortableDestination),
    );
    expect(classifyMarkdownDestination(`${exactPortableDestination}a`)).toEqual({
      kind: "invalid",
      reason: "too_large",
    });

    const exactComponent = "a".repeat(MAX_SKILL_REFERENCE_COMPONENT_BYTES);
    expect(classifyMarkdownDestination(exactComponent)).toEqual(local(exactComponent));
    expect(classifyMarkdownDestination(`${exactComponent}a`)).toEqual({
      kind: "invalid",
      reason: "component_too_large",
    });
    expect(classifyMarkdownDestination("😀".repeat(63))).toEqual(local("😀".repeat(63)));
    expect(classifyMarkdownDestination("😀".repeat(64))).toEqual({
      kind: "invalid",
      reason: "component_too_large",
    });

    const exactDepth = Array.from(
      { length: MAX_SKILL_REFERENCE_PATH_COMPONENTS },
      (_, index) => `p${index}`,
    ).join("/");
    expect(classifyMarkdownDestination(exactDepth)).toEqual(local(exactDepth));
    expect(classifyMarkdownDestination(`${exactDepth}/extra`)).toEqual({
      kind: "invalid",
      reason: "too_many_components",
    });
  });

  it("fails closed for non-string values and returns deeply frozen inert results", () => {
    for (const value of [undefined, null, 7, {}, [], Symbol("target")]) {
      expect(classifyMarkdownDestination(value)).toEqual({ kind: "invalid", reason: "type" });
    }
    for (const result of [
      classifyMarkdownDestination(""),
      classifyMarkdownDestination("https://example.com"),
      classifyMarkdownDestination("references/guide.md"),
      classifyMarkdownDestination("../secret"),
    ]) {
      expect(Object.isFrozen(result)).toBe(true);
      if (result.kind === "local") expect(Object.isFrozen(result.components)).toBe(true);
    }
    const secret = "TOP_SECRET_17f84";
    for (const result of [
      classifyMarkdownDestination(`javascript:${secret}`),
      classifyMarkdownDestination(`custom:${secret}`),
      classifyMarkdownDestination(`//${secret} invalid`),
    ]) {
      expect(JSON.stringify(result)).not.toContain(secret);
    }
    expect(
      classifyMarkdownDestination(`${"a".repeat(MAX_SKILL_REFERENCE_DESTINATION_BYTES)}\ud800`),
    ).toEqual({ kind: "invalid", reason: "too_large" });
  });

  it("uses captured classifier and transitive path-safety intrinsics", () => {
    const defineProperty = Object.defineProperty;
    const targets = [
      [Reflect, "apply"],
      [Buffer, "byteLength"],
      [Buffer, "from"],
      [Buffer.prototype, "toString"],
      [globalThis, "decodeURIComponent"],
      [Object, "defineProperty"],
      [Object, "freeze"],
      [RegExp.prototype, "exec"],
      [RegExp.prototype, Symbol.search],
      [RegExp.prototype, Symbol.split],
      [Set.prototype, "has"],
      [String.prototype, "codePointAt"],
      [String.prototype, "endsWith"],
      [String.prototype, "includes"],
      [String.prototype, "indexOf"],
      [String.prototype, "normalize"],
      [String.prototype, "search"],
      [String.prototype, "slice"],
      [String.prototype, "split"],
      [String.prototype, "startsWith"],
      [String.prototype, "toLowerCase"],
      [String.prototype, "trim"],
      [Array.prototype, Symbol.iterator],
    ] as const;
    const originals = targets.map(([target, key]) => Object.getOwnPropertyDescriptor(target, key));
    const poison = () => {
      throw new Error("live intrinsic used");
    };
    let accepted: ReturnType<typeof classifyMarkdownDestination> | undefined;
    let dangerous: ReturnType<typeof classifyMarkdownDestination> | undefined;
    let external: ReturnType<typeof classifyMarkdownDestination> | undefined;
    let unsafe: ReturnType<typeof classifyMarkdownDestination> | undefined;
    let componentResults: readonly boolean[] = [];

    try {
      for (let index = 0; index < targets.length; index += 1) {
        const target = targets[index] as (typeof targets)[number];
        defineProperty(target[0], target[1], {
          configurable: true,
          value: poison,
          writable: true,
        });
      }
      accepted = classifyMarkdownDestination("assets/a%20diagram.png#overview");
      dangerous = classifyMarkdownDestination("DATA:text/plain,hello");
      external = classifyMarkdownDestination("//cdn.example.com/diagram.png");
      unsafe = classifyMarkdownDestination("references/bad\u2060");
      componentResults = [
        isCanonicalDecodedMarkdownLocalComponent("\u0378"),
        isCanonicalDecodedMarkdownLocalComponent("\u00a0"),
      ];
    } finally {
      for (let index = targets.length - 1; index >= 0; index -= 1) {
        const target = targets[index] as (typeof targets)[number];
        defineProperty(target[0], target[1], originals[index] as PropertyDescriptor);
      }
    }

    expect(accepted).toEqual(local("assets/a diagram.png"));
    expect(dangerous).toEqual({ kind: "invalid", reason: "unsafe_scheme" });
    expect(external).toEqual({ kind: "external" });
    expect(unsafe).toEqual({ kind: "invalid", reason: "unsafe_unicode" });
    expect(componentResults).toEqual([true, false]);
  });

  it("is total and keeps every accepted local path lexical under deterministic fuzz", () => {
    let state = 0x5a17c9e3;
    for (let sample = 0; sample < 10_000; sample += 1) {
      state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
      const length = state % 24;
      let value = "";
      for (let index = 0; index < length; index += 1) {
        state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
        value += String.fromCharCode(state & 0xffff);
      }
      const result = classifyMarkdownDestination(value);
      expect(Object.isFrozen(result)).toBe(true);
      expect(isCanonicalDecodedMarkdownLocalComponent(value)).toBe(
        result.kind === "local" &&
          result.path === value &&
          result.components.length === 1 &&
          result.components[0] === value,
      );
      if (result.kind === "local") {
        expect(result.path.normalize("NFC")).toBe(result.path);
        expect(posix.normalize(result.path)).toBe(result.path);
        expect(posix.isAbsolute(result.path)).toBe(false);
        expect(win32.isAbsolute(result.path)).toBe(false);
      }
    }
  });
});
