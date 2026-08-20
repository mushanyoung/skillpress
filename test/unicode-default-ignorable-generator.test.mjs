import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { parseDerivedAge } from "../scripts/unicode-age-table.mjs";
import {
  parseDefaultIgnorable,
  verifyAssignedDefaultIgnorable,
} from "../scripts/unicode-default-ignorable-table.mjs";

const repositoryRoot = new URL("../", import.meta.url);
const defaultIgnorableHeading = "# Derived Property: Default_Ignorable_Code_Point";
const defaultIgnorableTotal = "# Total code points: 4174";

async function unicodeLines(file) {
  const source = await readFile(new URL(`vendor/unicode/15.1.0/${file}`, repositoryRoot), "utf8");
  return source.slice(0, -1).split("\n");
}

function firstDefaultIgnorableRecord(lines) {
  const index = lines.findIndex((line) => line.includes("; Default_Ignorable_Code_Point #"));
  expect(index).toBeGreaterThanOrEqual(0);
  return index;
}

describe("default-ignorable Unicode table generation", () => {
  it("rejects same-shaped full and assigned semantic mutations", async () => {
    const [derivedCorePropertiesLines, derivedAgeLines] = await Promise.all([
      unicodeLines("DerivedCoreProperties.txt"),
      unicodeLines("DerivedAge.txt"),
    ]);
    const changedSource = [...derivedCorePropertiesLines];
    const recordIndex = firstDefaultIgnorableRecord(changedSource);
    changedSource[recordIndex] = changedSource[recordIndex].replace(/^00AD/u, "00AE");
    expect(() => parseDefaultIgnorable(changedSource)).toThrow(
      /default-ignorable semantic SHA-256 does not match/u,
    );

    const fullRanges = parseDefaultIgnorable(derivedCorePropertiesLines);
    const changedRanges = fullRanges.map((range) => [...range]);
    changedRanges[0] = [0x00ae, 0x00ae];
    expect(() =>
      verifyAssignedDefaultIgnorable(changedRanges, parseDerivedAge(derivedAgeLines)),
    ).toThrow(/assigned default-ignorable semantic SHA-256 does not match/u);
  });

  it("rejects a range whose interior crosses the surrogate block", async () => {
    const lines = await unicodeLines("DerivedCoreProperties.txt");
    const recordIndex = firstDefaultIgnorableRecord(lines);
    lines[recordIndex] = lines[recordIndex].replace(/^00AD/u, "D7FF..E000");
    expect(() => parseDefaultIgnorable(lines)).toThrow(/intersects the surrogate range/u);
  });

  it("rejects swapped Math and default-ignorable section markers", async () => {
    const lines = await unicodeLines("DerivedCoreProperties.txt");
    const mathHeadingIndex = lines.indexOf("# Derived Property: Math");
    const mathTotalIndex = lines.indexOf("# Total code points: 2310");
    const defaultHeadingIndex = lines.indexOf(defaultIgnorableHeading);
    const defaultTotalIndex = lines.indexOf(defaultIgnorableTotal);
    for (const index of [
      mathHeadingIndex,
      mathTotalIndex,
      defaultHeadingIndex,
      defaultTotalIndex,
    ]) {
      expect(index).toBeGreaterThanOrEqual(0);
    }

    [lines[mathHeadingIndex], lines[defaultHeadingIndex]] = [
      lines[defaultHeadingIndex],
      lines[mathHeadingIndex],
    ];
    [lines[mathTotalIndex], lines[defaultTotalIndex]] = [
      lines[defaultTotalIndex],
      lines[mathTotalIndex],
    ];
    expect(() => parseDefaultIgnorable(lines)).toThrow(
      /places Math data inside the default-ignorable section/u,
    );
  });
});
