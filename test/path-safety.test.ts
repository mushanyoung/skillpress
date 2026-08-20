import { describe, expect, it } from "vitest";

import { isSafePathInput, MAX_PATH_INPUT_BYTES } from "../src/path-safety.js";

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
});
