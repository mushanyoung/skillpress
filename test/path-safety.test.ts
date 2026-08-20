import { Buffer } from "node:buffer";

import { describe, expect, it } from "vitest";

import { isSafePathInput, isUnambiguousUnicode, MAX_PATH_INPUT_BYTES } from "../src/path-safety.js";

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
      "C:\\safe\\trailing.",
      "C:\\safe\\trailing ",
      "C:\\safe\\bad?name",
    ];
    for (const value of invalid) expect(isSafePathInput(value, "win32")).toBe(false);
    expect(isSafePathInput("C:\\safe\\stream:name", "linux")).toBe(true);
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
      [RegExp.prototype, Symbol.search],
      [RegExp.prototype, Symbol.split],
      [String.prototype, "charCodeAt"],
      [String.prototype, "codePointAt"],
      [String.prototype, "endsWith"],
      [String.prototype, "includes"],
      [String.prototype, "slice"],
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
});
