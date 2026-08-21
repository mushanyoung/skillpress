import { Buffer } from "node:buffer";
import { readFileSync } from "node:fs";
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
  return { kind: "local", path, components: path.split("/") };
}

function legacyRegExpState(): readonly string[] {
  const aliases = RegExp as unknown as Record<string, string>;
  return [
    RegExp.input,
    aliases.$_ as string,
    RegExp.lastMatch,
    aliases["$&"] as string,
    RegExp.lastParen,
    aliases["$+"] as string,
    RegExp.leftContext,
    aliases["$`"] as string,
    RegExp.rightContext,
    aliases["$'"] as string,
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

function seedLegacyRegExpState(): void {
  /^(a)(b)(c)(d)(e)(f)(g)(h)(i)/u.exec("abcdefghi known-benign-tail");
}

const ES_WHITESPACE_CODE_UNITS = [
  0x0009, 0x000a, 0x000b, 0x000c, 0x000d, 0x0020, 0x00a0, 0x1680, 0x2000, 0x2001, 0x2002, 0x2003,
  0x2004, 0x2005, 0x2006, 0x2007, 0x2008, 0x2009, 0x200a, 0x2028, 0x2029, 0x202f, 0x205f, 0x3000,
  0xfeff,
];

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

  it("matches the seven frozen regular languages over deterministic edge corpora", () => {
    const uriScheme = /^([A-Za-z][A-Za-z0-9+.-]*):/u;
    const windowsDrive = /^[A-Za-z]:/u;
    const windowsDevicePath = /^\/\/[?.](?:\/|$)/u;
    const encodedSeparator = /%(?:2f|5c)/iu;
    const encodedDelimiter = /%(?:23|3a|3f)/iu;
    const windowsDeviceScheme = /^(?:aux|com[1-9]|con|lpt[1-9]|nul|prn)$/u;
    const whitespace = /\s/u;

    for (const value of [
      "za:payload",
      "ZA0+.-:payload",
      "za::payload",
      "0za:payload",
      "+za:payload",
      ".za:payload",
      "_za:payload",
      "za_:payload",
      "za/payload",
      "za",
    ]) {
      expect(classifyMarkdownDestination(value).kind === "external").toBe(uriScheme.test(value));
    }

    for (const prefix of [
      ..."ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz",
      "0",
      "+",
      "é",
      "K",
      "ſ",
      "ab",
    ]) {
      const value = `${prefix}:payload`;
      const result = classifyMarkdownDestination(value);
      expect(result.kind === "invalid" && result.reason === "windows_drive").toBe(
        windowsDrive.test(value),
      );
    }

    for (const value of ["//?", "//.", "//?/tail", "//./tail", "//?x", "//.x", "//x/tail"]) {
      const result = classifyMarkdownDestination(value);
      expect(result.kind === "invalid" && result.reason === "absolute_path").toBe(
        windowsDevicePath.test(value),
      );
    }

    for (const value of [
      "plain",
      "a%2fb",
      "a%2Fb",
      "a%5cb",
      "a%5Cb",
      "a%23b",
      "a%3ab",
      "a%3Ab",
      "a%3fb",
      "a%3Fb",
      "a%20b",
      "a%2gb",
    ]) {
      const result = classifyMarkdownDestination(value);
      expect(result.kind === "invalid" && result.reason === "encoded_separator").toBe(
        encodedSeparator.test(value),
      );
      if (!encodedSeparator.test(value)) {
        expect(result.kind === "invalid" && result.reason === "encoded_delimiter").toBe(
          encodedDelimiter.test(value),
        );
      }
    }

    for (const scheme of [
      "aux",
      "CON",
      "nul",
      "PrN",
      "com1",
      "COM9",
      "lpt1",
      "LPT9",
      "com0",
      "com10",
      "lpt0",
      "lpt10",
      "console",
      "clock",
    ]) {
      const result = classifyMarkdownDestination(`${scheme}:payload`);
      expect(result.kind === "invalid" && result.reason === "unsafe_scheme").toBe(
        windowsDeviceScheme.test(scheme.toLowerCase()),
      );
    }

    const whitespaceMatches: number[] = [];
    for (let code = 0; code <= 0xffff; code += 1) {
      if (whitespace.test(String.fromCharCode(code))) whitespaceMatches.push(code);
    }
    expect(whitespaceMatches).toEqual(ES_WHITESPACE_CODE_UNITS);
  });

  it("preserves ES2025 whitespace and surrounding rejection priorities", () => {
    const unsafe = new Set([0x0009, 0x000a, 0x000b, 0x000c, 0x000d, 0x2028, 0x2029, 0xfeff]);
    for (const code of ES_WHITESPACE_CODE_UNITS) {
      const character = String.fromCharCode(code);
      const reason = unsafe.has(code) ? "unsafe_unicode" : "invalid_external";
      expect(classifyMarkdownDestination(`custom:a${character}b`)).toEqual({
        kind: "invalid",
        reason,
      });
      expect(classifyMarkdownDestination(`//host${character}path`)).toEqual({
        kind: "invalid",
        reason,
      });
    }
    expect(classifyMarkdownDestination("custom:a\u0378b")).toEqual({ kind: "external" });
    expect(classifyMarkdownDestination("custom:a\u0085b")).toEqual({
      kind: "invalid",
      reason: "unsafe_unicode",
    });
    expect(classifyMarkdownDestination("javascript:bad\\ path")).toEqual({
      kind: "invalid",
      reason: "unsafe_scheme",
    });
    expect(classifyMarkdownDestination("custom:bad path\\tail")).toEqual({
      kind: "invalid",
      reason: "backslash",
    });
    expect(classifyMarkdownDestination("//?/bad path")).toEqual({
      kind: "invalid",
      reason: "absolute_path",
    });
    expect(classifyMarkdownDestination("//?/bad\\ path")).toEqual({
      kind: "invalid",
      reason: "backslash",
    });
  });

  it("keeps encoded separators globally ahead of delimiters and malformed escapes", () => {
    for (const value of ["a%23b%2fc", "a%3ab%5Cc", "a%3Fb%2Fc", "a%ZZb%2fc", "a%2fb%23c"]) {
      expect(classifyMarkdownDestination(value)).toEqual({
        kind: "invalid",
        reason: "encoded_separator",
      });
    }
    expect(classifyMarkdownDestination("safe.md#fragment%2fignored")).toEqual(local("safe.md"));
    expect(classifyMarkdownDestination("/absolute%2fpath")).toEqual({
      kind: "invalid",
      reason: "absolute_path",
    });
    expect(classifyMarkdownDestination("/absolute?query=%2f")).toEqual({
      kind: "invalid",
      reason: "query",
    });
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

  it("does not mutate any legacy RegExp alias on safe or unsafe old execution paths", () => {
    const cases = [
      ["custom:retention-sentinel", "external"],
      ["javascript:retention-sentinel", "invalid:unsafe_scheme"],
      ["COM1:retention-sentinel", "invalid:unsafe_scheme"],
      ["custom:bad path", "invalid:invalid_external"],
      ["custom:bad\\path", "invalid:backslash"],
      ["//host.invalid/path", "external"],
      ["//host.invalid/bad path", "invalid:invalid_external"],
      ["//host.invalid\\bad", "invalid:backslash"],
      ["//?/C:/retention-sentinel", "invalid:absolute_path"],
      ["C:retention-sentinel", "invalid:windows_drive"],
      ["local/retention-sentinel", "local"],
      ["local%2fretention-sentinel", "invalid:encoded_separator"],
      ["local%23retention-sentinel", "invalid:encoded_delimiter"],
      ["#retention-sentinel", "document"],
      ["?retention-sentinel", "document"],
    ] as const;
    const seeded = [
      "abcdefghi known-benign-tail",
      "abcdefghi known-benign-tail",
      "abcdefghi",
      "abcdefghi",
      "i",
      "i",
      "",
      "",
      " known-benign-tail",
      " known-benign-tail",
      ..."abcdefghi",
    ];

    for (const [value, expected] of cases) {
      seedLegacyRegExpState();
      const before = legacyRegExpState();
      const result = classifyMarkdownDestination(value);
      const after = legacyRegExpState();
      expect(before).toEqual(seeded);
      expect(after).toEqual(before);
      expect(result.kind === "invalid" ? `${result.kind}:${result.reason}` : result.kind).toBe(
        expected,
      );
      if (result.kind !== "local") {
        expect(JSON.stringify(result)).not.toContain("retention-sentinel");
      }
    }
  });

  it("contains no per-input RegExp execution entry point", () => {
    const source = readFileSync(
      new URL("../src/validate/markdown-destination.ts", import.meta.url),
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
    ]) {
      expect(source).not.toContain(fragment);
    }
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
      [RegExp.prototype, "test"],
      [RegExp.prototype, Symbol.search],
      [RegExp.prototype, Symbol.split],
      [Set.prototype, "has"],
      [String.prototype, "charCodeAt"],
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
