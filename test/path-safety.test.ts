import { Buffer } from "node:buffer";
import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { isDefaultIgnorableCodePointUnicode15_1 } from "../src/validate/generated-unicode.js";
import {
  isSafePathInput,
  isUnambiguousUnicode,
  MAX_PATH_COMPONENTS,
  MAX_PATH_INPUT_BYTES,
} from "../src/path-safety.js";

const repositoryRoot = new URL("../", import.meta.url);
const referenceReserved =
  /^(?:aux|clock\$|com(?:[1-9]|[¹²³])|con|conin\$|conout\$|lpt(?:[1-9]|[¹²³])|nul|prn)(?:\.|$)/iu;
const referenceDevicePrefix = /^(?:\\\\|\/\/)[?.](?:\\|\/)/u;
const referenceDriveRelative = /^[A-Za-z]:(?:$|[^\\/])/u;
const referenceDriveComponent = /^[A-Za-z]:$/u;
const referenceForbiddenComponent = /[<>"|?*]/u;

function referenceHasUnsafeWindowsSyntax(value: string): boolean {
  if (referenceDevicePrefix.test(value) || referenceDriveRelative.test(value)) return true;
  const components = value.split(/[\\/]/u);
  for (let index = 0; index < components.length; index += 1) {
    const component = components[index];
    if (component === "" || component === "." || component === "..") continue;
    const drive = index === 0 && referenceDriveComponent.test(component);
    if (
      (!drive && component.includes(":")) ||
      referenceForbiddenComponent.test(component) ||
      component.endsWith(".") ||
      component.endsWith(" ") ||
      referenceReserved.test(component)
    ) {
      return true;
    }
  }
  return false;
}

function legacyRegExpState(): readonly string[] {
  const aliases = RegExp as unknown as Readonly<Record<string, string>>;
  return [
    RegExp.input,
    RegExp.$_,
    RegExp.lastMatch,
    aliases["$&"],
    RegExp.lastParen,
    aliases["$+"],
    RegExp.leftContext,
    aliases["$`"],
    RegExp.rightContext,
    aliases["$'"],
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

describe("filesystem path input safety", () => {
  it("accepts ordinary relative and absolute path text", () => {
    expect(isSafePathInput("skills/example", "linux")).toBe(true);
    expect(isSafePathInput("/workspace/技能/example", "darwin")).toBe(true);
    expect(isSafePathInput("C:\\workspace\\skills\\example", "win32")).toBe(true);
    expect(isSafePathInput("\\\\server\\share\\skills\\example", "win32")).toBe(true);
    expect(isSafePathInput(".", "win32")).toBe(true);
    expect(isSafePathInput(".\\skills\\example", "win32")).toBe(true);
    expect(isSafePathInput("..\\skills\\example", "win32")).toBe(true);
  });

  it("rejects blank, oversized, control, ignorable, and malformed Unicode paths", () => {
    const invalid = [
      "",
      "   ",
      "\u00a0",
      "bad\0path",
      "bad\u001bpath",
      "bad\u0085path",
      "bad\u2028path",
      "bad\u2060path",
      "bad\ud800path",
      `bad${String.fromCodePoint(0xfdd0)}path`,
      `bad${String.fromCodePoint(0x10ffff)}path`,
      "x".repeat(MAX_PATH_INPUT_BYTES + 1),
      "😀".repeat(MAX_PATH_INPUT_BYTES / 2),
    ];
    for (const value of invalid) expect(isSafePathInput(value, "linux")).toBe(false);
  });

  it("applies exact byte bounds without taking ownership of the component cap", () => {
    const exactAscii = "a".repeat(MAX_PATH_INPUT_BYTES);
    const exactMultibyte = "😀".repeat(MAX_PATH_INPUT_BYTES / 4);
    expect(isSafePathInput(exactAscii, "linux")).toBe(true);
    expect(isSafePathInput(`${exactAscii}a`, "linux")).toBe(false);
    expect(Buffer.byteLength(exactMultibyte, "utf8")).toBe(MAX_PATH_INPUT_BYTES);
    expect(isSafePathInput(exactMultibyte, "linux")).toBe(true);
    expect(isSafePathInput(`${exactMultibyte}😀`, "linux")).toBe(false);
    expect(
      isSafePathInput(
        Array.from({ length: MAX_PATH_COMPONENTS + 1 }, () => "a").join("/"),
        "win32",
      ),
    ).toBe(true);
  });

  it("rejects the complete pinned Unicode 15.1 default-ignorable set", () => {
    let count = 0;
    for (let codePoint = 0; codePoint <= 0x10ffff; codePoint += 1) {
      if (!isDefaultIgnorableCodePointUnicode15_1(codePoint)) continue;
      count += 1;
      expect(isUnambiguousUnicode(`a${String.fromCodePoint(codePoint)}b`)).toBe(false);
    }
    expect(count).toBe(4_174);
  }, 30_000);

  it("rejects Windows device, stream, reserved, and normalization aliases", () => {
    const invalid = [
      "\\\\?\\C:\\safe",
      "\\\\.\\pipe\\skillpress",
      "C:",
      "C:relative",
      "C:\\safe\\stream:name",
      "C:\\safe\\CON",
      "C:\\safe\\CONIN$",
      "C:\\safe\\CONOUT$.txt",
      "C:\\safe\\CLOCK$",
      "C:\\safe\\nul.txt",
      "C:\\safe\\COM¹.txt",
      "C:\\safe\\LPT³.log",
      "C:\\safe\\CLOC\u212a$.txt",
      "C:\\safe\\trailing.",
      "C:\\safe\\trailing ",
      "C:\\safe\\bad?name",
    ];
    for (const value of invalid) expect(isSafePathInput(value, "win32")).toBe(false);
    expect(isSafePathInput("C:\\safe\\stream:name", "linux")).toBe(true);
    for (const value of [
      "C:\\safe\\CONSOLE",
      "C:\\safe\\CONIN",
      "C:\\safe\\CONOUT",
      "C:\\safe\\CLOCK",
      "C:\\safe\\COM10",
      "C:\\safe\\COM¹0",
      "C:\\safe\\LPT³x",
      "C:\\safe\\CLOCＫ$.txt",
    ]) {
      expect(isSafePathInput(value, "win32")).toBe(true);
    }
  });

  it("matches all five previous Windows expressions on a deterministic corpus", () => {
    const components = [
      "safe",
      ".",
      "..",
      "stream:name",
      "trailing.",
      "trailing ",
      "bad<name",
      "bad>name",
      'bad"name',
      "bad|name",
      "bad?name",
      "bad*name",
      "console",
      "conin",
      "conout",
      "clock",
      "com0",
      "com10",
      "com¹0",
      "lpt0",
      "lpt10",
      "lpt³x",
      "xcon",
      "ＣＯＮ",
      "CLOC\u212a$.txt",
      "CLOCＫ$.txt",
    ];
    const suffixes = ["", ".txt", "x", "0"];
    for (const stem of ["aux", "clock$", "con", "conin$", "conout$", "nul", "prn"]) {
      for (const suffix of suffixes) {
        components.push(`${stem}${suffix}`, `${stem.toUpperCase()}${suffix}`);
      }
    }
    for (const stem of ["com", "lpt"]) {
      for (const number of ["1", "2", "3", "4", "5", "6", "7", "8", "9", "¹", "²", "³"]) {
        for (const suffix of suffixes) {
          components.push(`${stem}${number}${suffix}`, `${stem.toUpperCase()}${number}${suffix}`);
        }
      }
    }
    let comparisons = 0;
    const compare = (value: string) => {
      expect(isSafePathInput(value, "win32")).toBe(!referenceHasUnsafeWindowsSyntax(value));
      comparisons += 1;
    };
    for (const value of [
      "\\\\?\\C:\\safe",
      "\\\\.\\pipe\\name",
      "//?/C:/safe",
      "//./pipe/name",
      "\\\\?/mixed",
      "\\\\./mixed",
      "//?\\mixed",
      "//.\\mixed",
      "C:",
      "C:relative",
      "z:.",
      "A:0",
      "C:\\safe",
      "c:/safe",
      "root\\C:\\safe",
      "\\\\server\\share\\safe",
    ]) {
      compare(value);
    }
    for (const component of components) {
      for (const prefix of ["", "root\\", "C:\\safe\\", "\\\\server\\share\\"]) {
        compare(`${prefix}${component}`);
      }
    }
    expect(comparisons).toBe(1_112);
  });

  it("leaves all legacy RegExp aliases unchanged on every former execution path", () => {
    const secret = "sentinel-private-path";
    const rawIgnorable = `${secret}\u2060tail`;
    const cases: readonly { readonly expected: boolean; readonly run: () => boolean }[] = [
      { expected: false, run: () => isUnambiguousUnicode(rawIgnorable) },
      { expected: false, run: () => isSafePathInput(rawIgnorable, "linux") },
      { expected: false, run: () => isSafePathInput(`\\\\?\\C:\\${secret}`, "win32") },
      { expected: false, run: () => isSafePathInput(`C:${secret}`, "win32") },
      { expected: true, run: () => isSafePathInput(`C:\\safe\\${secret}`, "win32") },
      { expected: false, run: () => isSafePathInput(`C:\\safe\\bad?${secret}`, "win32") },
      { expected: false, run: () => isSafePathInput(`C:\\safe\\CON.${secret}`, "win32") },
    ];
    for (let index = 0; index < cases.length; index += 1) {
      const { expected, run } = cases[index];
      /(b)(e)(n)(i)(g)(n)(-)(o)(k)/u.exec("leftbenign-okright");
      const before = legacyRegExpState();
      const result = run();
      const after = legacyRegExpState();
      expect(after).toEqual(before);
      expect(result).toBe(expected);
    }
  });

  it("rejects non-string runtime values", () => {
    for (const value of [undefined, null, 7, {}, []]) {
      expect(isSafePathInput(value)).toBe(false);
    }
  });

  it("uses its module-initialization intrinsics after live bindings are poisoned", () => {
    const defineProperty = Object.defineProperty;
    const targets = [
      [Reflect, "apply"],
      [Buffer, "byteLength"],
      [Buffer, "from"],
      [Buffer.prototype, "toString"],
      [RegExp.prototype, "exec"],
      [RegExp.prototype, "test"],
      [RegExp.prototype, Symbol.search],
      [RegExp.prototype, Symbol.split],
      [String.prototype, "charCodeAt"],
      [String.prototype, "codePointAt"],
      [String.prototype, "endsWith"],
      [String.prototype, "includes"],
      [String.prototype, "slice"],
      [String.prototype, "startsWith"],
      [String.prototype, "toLowerCase"],
      [String.prototype, "toUpperCase"],
      [String.prototype, "trim"],
    ] as const;
    const originals = targets.map(([target, key]) => Object.getOwnPropertyDescriptor(target, key));
    const platformDescriptor = Object.getOwnPropertyDescriptor(process, "platform");
    const beforeDefault = isSafePathInput("C:relative");
    let results: readonly boolean[] = [];
    const poison = () => {
      throw new Error("live intrinsic used");
    };

    try {
      for (const [target, key] of targets) {
        defineProperty(target, key, { configurable: true, value: poison, writable: true });
      }
      defineProperty(process, "platform", {
        ...platformDescriptor,
        value: process.platform === "win32" ? "linux" : "win32",
      });
      results = [
        isSafePathInput("skills/example", "linux"),
        isSafePathInput("C:\\safe\\CON", "win32"),
        isUnambiguousUnicode("技能"),
        isUnambiguousUnicode("bad\u2060"),
        isSafePathInput("C:relative"),
      ];
    } finally {
      for (let index = targets.length - 1; index >= 0; index -= 1) {
        defineProperty(
          targets[index]?.[0],
          targets[index]?.[1],
          originals[index] as PropertyDescriptor,
        );
      }
      defineProperty(process, "platform", platformDescriptor as PropertyDescriptor);
    }

    expect(results).toEqual([true, false, true, false, beforeDefault]);
  });

  it("uses the pinned table and contains no per-input RegExp execution", async () => {
    const source = await readFile(new URL("src/path-safety.ts", repositoryRoot), "utf8");
    for (const fragment of [
      "RegExp",
      ".exec(",
      ".match(",
      ".replace(",
      ".replaceAll(",
      ".search(",
      ".split(",
      ".test(",
      "\\p{",
      ".toLowerCase(",
      ".toUpperCase(",
      ".startsWith(",
    ]) {
      expect(source).not.toContain(fragment);
    }
    expect(source).toContain("defaultIgnorableSnapshot(codePoint)");
    expect(source).toContain("codeUnit === 0x212a ? 0x6b : codeUnit");
    expect(source).not.toMatch(/\bfor\s*\([^)]*\bof\b/gu);
  });
});
