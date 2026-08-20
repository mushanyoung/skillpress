import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import {
  fullCaseFoldUnicode15_1,
  isAssignedScalarUnicode15_1,
  UNICODE_PORTABILITY_VERSION,
} from "../src/validate/generated-unicode.js";

const repositoryRoot = new URL("../", import.meta.url);
const MAX_CODE_POINT = 0x10ffff;
const CODE_POINT_COUNT = MAX_CODE_POINT + 1;
const SURROGATE_START = 0xd800;
const SURROGATE_END = 0xdfff;

async function readUnicodeSource(file: string): Promise<string> {
  return readFile(new URL(`vendor/unicode/15.1.0/${file}`, repositoryRoot), "utf8");
}

function parseCaseFoldOracle(source: string): Map<number, readonly number[]> {
  const mappings = new Map<number, readonly number[]>();
  for (const line of source.split("\n")) {
    const data = line.split("#")[0]?.trim();
    if (!data) {
      continue;
    }

    const fields = data.split(";").map((field) => field.trim());
    const sourceText = fields[0];
    const status = fields[1];
    const mappingText = fields[2];
    if (
      sourceText === undefined ||
      mappingText === undefined ||
      (status !== "C" && status !== "F")
    ) {
      continue;
    }

    mappings.set(
      Number.parseInt(sourceText, 16),
      mappingText.split(" ").map((value) => Number.parseInt(value, 16)),
    );
  }
  return mappings;
}

function versionAtMost15_1(version: string): boolean {
  const parts = version.split(".");
  const major = Number.parseInt(parts[0] ?? "", 10);
  const minor = Number.parseInt(parts[1] ?? "", 10);
  return major < 15 || (major === 15 && minor <= 1);
}

function parseAssignedScalarOracle(source: string): Uint8Array {
  const assigned = new Uint8Array(CODE_POINT_COUNT);
  for (const line of source.split("\n")) {
    const data = line.split("#")[0]?.trim();
    if (!data) {
      continue;
    }

    const fields = data.split(";").map((field) => field.trim());
    const rangeText = fields[0];
    const version = fields[1];
    if (rangeText === undefined || version === undefined || !versionAtMost15_1(version)) {
      continue;
    }

    const endpoints = rangeText.split("..");
    const startText = endpoints[0];
    const endText = endpoints[1] ?? startText;
    if (startText === undefined || endText === undefined) {
      continue;
    }
    const start = Number.parseInt(startText, 16);
    const end = Number.parseInt(endText, 16);
    assigned.fill(1, start, end + 1);
  }

  assigned.fill(0, SURROGATE_START, SURROGATE_END + 1);
  return assigned;
}

function digest(content: Uint8Array): string {
  return createHash("sha256").update(content).digest("hex");
}

function scalarValues(value: string): number[] {
  return Array.from(value, (character) => character.codePointAt(0) as number);
}

describe("generated Unicode 15.1 portability tables", () => {
  it("exposes the pinned Unicode version and readable full-fold goldens", () => {
    expect(UNICODE_PORTABILITY_VERSION).toBe("15.1.0");
    expect(fullCaseFoldUnicode15_1("AZ")).toBe("az");
    expect(fullCaseFoldUnicode15_1("ß")).toBe("ss");
    expect(fullCaseFoldUnicode15_1("İ")).toBe("i\u0307");
    expect(fullCaseFoldUnicode15_1("ﬃ")).toBe("ffi");
    expect(fullCaseFoldUnicode15_1("Āā")).toBe("āā");
    expect(fullCaseFoldUnicode15_1("🙂")).toBe("🙂");
    expect(fullCaseFoldUnicode15_1("\ud800")).toBe("\ud800");
    expect(fullCaseFoldUnicode15_1("")).toBe("");
  });

  it("recognizes only assigned Unicode 15.1 scalar values", () => {
    expect(isAssignedScalarUnicode15_1(0)).toBe(true);
    expect(isAssignedScalarUnicode15_1(0x41)).toBe(true);
    expect(isAssignedScalarUnicode15_1(0x2fff)).toBe(true);
    expect(isAssignedScalarUnicode15_1(0x10ffff)).toBe(true);
    expect(isAssignedScalarUnicode15_1(0x378)).toBe(false);

    for (const invalid of [
      Number.NaN,
      Number.POSITIVE_INFINITY,
      -1,
      1.5,
      SURROGATE_START,
      SURROGATE_END,
      MAX_CODE_POINT + 1,
    ]) {
      expect(isAssignedScalarUnicode15_1(invalid)).toBe(false);
    }
  });

  it("matches independent UCD oracles for every code point and locks semantic digests", async () => {
    const [caseFoldingSource, derivedAgeSource] = await Promise.all([
      readUnicodeSource("CaseFolding.txt"),
      readUnicodeSource("DerivedAge.txt"),
    ]);
    const foldOracle = parseCaseFoldOracle(caseFoldingSource);
    const assignedOracle = parseAssignedScalarOracle(derivedAgeSource);

    expect(foldOracle.size).toBe(1_530);

    const combinedFraming = Buffer.allocUnsafe(CODE_POINT_COUNT * 14);
    const foldFraming = Buffer.allocUnsafe(CODE_POINT_COUNT * 13);
    const assignedBitset = Buffer.alloc(Math.ceil(CODE_POINT_COUNT / 8));
    let combinedOffset = 0;
    let foldOffset = 0;
    let assignedCount = 0;
    let foldMismatchCount = 0;
    let assignedMismatchCount = 0;
    let firstFoldMismatch:
      | { readonly codePoint: number; readonly expected: number[]; readonly actual: number[] }
      | undefined;
    let firstAssignedMismatch:
      | { readonly codePoint: number; readonly expected: boolean; readonly actual: boolean }
      | undefined;

    for (let codePoint = 0; codePoint <= MAX_CODE_POINT; codePoint += 1) {
      const expectedMapping = foldOracle.get(codePoint) ?? [codePoint];
      const expectedFold = String.fromCodePoint(...expectedMapping);
      const actualFold = fullCaseFoldUnicode15_1(String.fromCodePoint(codePoint));
      if (actualFold !== expectedFold) {
        foldMismatchCount += 1;
        firstFoldMismatch ??= {
          codePoint,
          expected: [...expectedMapping],
          actual: scalarValues(actualFold),
        };
      }

      const expectedAssigned = assignedOracle[codePoint] === 1;
      const actualAssigned = isAssignedScalarUnicode15_1(codePoint);
      if (actualAssigned !== expectedAssigned) {
        assignedMismatchCount += 1;
        firstAssignedMismatch ??= { codePoint, expected: expectedAssigned, actual: actualAssigned };
      }
      if (actualAssigned) {
        assignedCount += 1;
        const byteIndex = codePoint >> 3;
        assignedBitset[byteIndex] = (assignedBitset[byteIndex] ?? 0) | (1 << (codePoint & 7));
      }

      combinedFraming[combinedOffset] = actualAssigned ? 1 : 0;
      combinedOffset += 1;
      combinedFraming[combinedOffset] = expectedMapping.length;
      combinedOffset += 1;
      foldFraming[foldOffset] = expectedMapping.length;
      foldOffset += 1;
      for (const mappedCodePoint of expectedMapping) {
        combinedFraming.writeUInt32LE(mappedCodePoint, combinedOffset);
        combinedOffset += 4;
        foldFraming.writeUInt32LE(mappedCodePoint, foldOffset);
        foldOffset += 4;
      }
    }

    expect({ count: foldMismatchCount, first: firstFoldMismatch }).toEqual({
      count: 0,
      first: undefined,
    });
    expect({ count: assignedMismatchCount, first: firstAssignedMismatch }).toEqual({
      count: 0,
      first: undefined,
    });
    expect(assignedCount).toBe(287_412);
    expect(digest(combinedFraming.subarray(0, combinedOffset))).toBe(
      "eb91735feb94303a8d611b1a85aa55ca3fe6367d23d84d7b2d4c4dc4ee03a11e",
    );
    expect(digest(foldFraming.subarray(0, foldOffset))).toBe(
      "b6448e86dddf50efa9baf605f293630923aaa3daa56b58124d6ec05f3bdcf0a5",
    );
    expect(digest(assignedBitset)).toBe(
      "0952fdec921e0439d955516710b6aa42cf30df450611e6159d1a2f2de4137b37",
    );
  }, 30_000);

  it("keeps generated declarations narrow and host Unicode operations out of generation", async () => {
    const declaration = await readFile(
      new URL("dist/validate/generated-unicode.d.ts", repositoryRoot),
      "utf8",
    );
    expect(declaration).toContain(
      "export declare const UNICODE_PORTABILITY_VERSION: string;\nexport declare function fullCaseFoldUnicode15_1(value: string): string;\nexport declare function isAssignedScalarUnicode15_1(codePoint: number): boolean;",
    );
    expect(declaration).not.toMatch(/(?:ASSIGNED_SCALAR|CASE_FOLD_)/u);
    expect(declaration.split("\n").length).toBeLessThanOrEqual(6);

    const scriptDirectory = new URL("scripts/", repositoryRoot);
    const unicodeScripts = (await readdir(scriptDirectory)).filter((file) =>
      file.includes("unicode"),
    );
    const generatedSource = await readFile(
      new URL("src/validate/generated-unicode.ts", repositoryRoot),
      "utf8",
    );
    const sources = await Promise.all(
      unicodeScripts.map((file) => readFile(new URL(file, scriptDirectory), "utf8")),
    );
    const forbiddenFragments = [
      `to${"Lower"}Case`,
      `to${"Upper"}Case`,
      `locale${"Compare"}`,
      `toLocale${"Lower"}Case`,
      `toLocale${"Upper"}Case`,
      `norma${"lize"}`,
      `${"Int"}l`,
    ];
    for (const source of [generatedSource, ...sources]) {
      for (const fragment of forbiddenFragments) {
        expect(source).not.toContain(fragment);
      }
    }
  });
});
