import { createHash } from "node:crypto";

import {
  assertGeneration,
  expectCount,
  isAscii,
  isCodePoint,
  MAX_CODE_POINT,
  SURROGATE_END,
  SURROGATE_START,
} from "./unicode-source-parse.mjs";

const DEFAULT_IGNORABLE_PROPERTY = "Default_Ignorable_Code_Point";
const DEFAULT_IGNORABLE_HEADING = `# Derived Property: ${DEFAULT_IGNORABLE_PROPERTY}`;
const DEFAULT_IGNORABLE_TOTAL = "# Total code points: 4174";
const FULL_DEFAULT_IGNORABLE_SHA256 =
  "c8984091f29193139ea640ff7fc181d77f209fe34867cb0368af1f07f260a3bd";
const ASSIGNED_DEFAULT_IGNORABLE_SHA256 =
  "47369767624770346e80491eece207fde8e876a257bdf676c0f92fc073773615";
const derivedCorePropertyRecordPattern =
  /^([0-9A-F]{4,6})(?:\.\.([0-9A-F]{4,6}))?\s*;\s*([A-Za-z][A-Za-z0-9_]*)(?:;\s*([A-Za-z][A-Za-z0-9_]*))?\s+# .+$/;

const expectedPropertyGroups = [
  ["Math", 240],
  ["Alphabetic", 1_141],
  ["Lowercase", 686],
  ["Uppercase", 651],
  ["Cased", 174],
  ["Case_Ignorable", 491],
  ["Changes_When_Lowercased", 609],
  ["Changes_When_Uppercased", 627],
  ["Changes_When_Titlecased", 626],
  ["Changes_When_Casefolded", 622],
  ["Changes_When_Casemapped", 131],
  ["ID_Start", 740],
  ["ID_Continue", 1_344],
  ["XID_Start", 743],
  ["XID_Continue", 1_348],
  [DEFAULT_IGNORABLE_PROPERTY, 27],
  ["Grapheme_Extend", 376],
  ["Grapheme_Base", 1_743],
  ["Grapheme_Link", 60],
  ["InCB=Linker", 6],
  ["InCB=Consonant", 26],
  ["InCB=Extend", 170],
];

function rangeCodePointCount(ranges) {
  return ranges.reduce((count, [start, end]) => count + end - start + 1, 0);
}

function mergeAdjacentRanges(ranges) {
  const merged = [];
  for (const [start, end] of ranges) {
    const previous = merged.at(-1);
    if (previous !== undefined && start === previous[1] + 1) {
      previous[1] = end;
    } else {
      merged.push([start, end]);
    }
  }
  return merged;
}

function rangeBitsetSha256(ranges) {
  const bitset = Buffer.alloc((MAX_CODE_POINT + 1) / 8);
  for (const [start, end] of ranges) {
    for (let codePoint = start; codePoint <= end; codePoint += 1) {
      const byteIndex = codePoint >> 3;
      bitset[byteIndex] = (bitset[byteIndex] ?? 0) | (1 << (codePoint & 7));
    }
  }
  return createHash("sha256").update(bitset).digest("hex");
}

export function parseDefaultIgnorable(lines) {
  const groups = [];
  const defaultIgnorableRecords = [];
  let recordCount = 0;
  let binaryRecordCount = 0;
  let enumeratedRecordCount = 0;
  let defaultIgnorableSection = "before";

  for (const [index, line] of lines.entries()) {
    if (line === DEFAULT_IGNORABLE_HEADING) {
      assertGeneration(
        defaultIgnorableSection === "before",
        `DerivedCoreProperties.txt line ${index + 1} has a misplaced default-ignorable heading`,
      );
      defaultIgnorableSection = "inside";
      continue;
    }
    if (line === DEFAULT_IGNORABLE_TOTAL) {
      assertGeneration(
        defaultIgnorableSection === "inside",
        `DerivedCoreProperties.txt line ${index + 1} has a misplaced default-ignorable total`,
      );
      expectCount(
        defaultIgnorableRecords.length,
        27,
        "default-ignorable records before the section total",
      );
      defaultIgnorableSection = "after";
      continue;
    }
    if (
      defaultIgnorableSection === "inside" &&
      (line.startsWith("# Derived Property:") || line.startsWith("# Total code points:"))
    ) {
      assertGeneration(
        false,
        `DerivedCoreProperties.txt line ${index + 1} closes the default-ignorable section incorrectly`,
      );
    }
    if (line === "" || line.startsWith("#")) {
      continue;
    }

    assertGeneration(
      isAscii(line),
      `DerivedCoreProperties.txt line ${index + 1} is not ASCII data`,
    );
    const match = derivedCorePropertyRecordPattern.exec(line);
    assertGeneration(
      match !== null,
      `DerivedCoreProperties.txt line ${index + 1} has invalid grammar`,
    );
    const startText = match[1];
    const endText = match[2] ?? startText;
    const property = match[3];
    const value = match[4];
    assertGeneration(
      startText !== undefined && endText !== undefined && property !== undefined,
      `DerivedCoreProperties.txt line ${index + 1} is incomplete`,
    );

    const start = Number.parseInt(startText, 16);
    const end = Number.parseInt(endText, 16);
    assertGeneration(
      isCodePoint(start) && isCodePoint(end),
      `DerivedCoreProperties.txt line ${index + 1} has an invalid endpoint`,
    );
    assertGeneration(
      start <= end,
      `DerivedCoreProperties.txt line ${index + 1} has a reversed range`,
    );
    assertGeneration(
      end < SURROGATE_START || start > SURROGATE_END,
      `DerivedCoreProperties.txt line ${index + 1} intersects the surrogate range`,
    );

    if (value === undefined) {
      binaryRecordCount += 1;
    } else {
      enumeratedRecordCount += 1;
      assertGeneration(
        property === "InCB" && ["Linker", "Consonant", "Extend"].includes(value),
        `DerivedCoreProperties.txt line ${index + 1} has an unexpected enumerated property`,
      );
    }
    const groupKey = value === undefined ? property : `${property}=${value}`;
    let group = groups.at(-1);
    if (group === undefined || group.key !== groupKey) {
      group = { key: groupKey, count: 0, end: -1 };
      groups.push(group);
    }
    assertGeneration(
      start > group.end,
      `DerivedCoreProperties.txt line ${index + 1} is not strictly ordered within ${groupKey}`,
    );
    group.count += 1;
    group.end = end;

    if (property === DEFAULT_IGNORABLE_PROPERTY) {
      assertGeneration(
        value === undefined && defaultIgnorableSection === "inside",
        `DerivedCoreProperties.txt line ${index + 1} places target data outside its section`,
      );
      defaultIgnorableRecords.push([start, end]);
    } else {
      assertGeneration(
        defaultIgnorableSection !== "inside",
        `DerivedCoreProperties.txt line ${index + 1} places ${property} data inside the default-ignorable section`,
      );
    }
    recordCount += 1;
  }

  assertGeneration(
    defaultIgnorableSection === "after",
    "DerivedCoreProperties.txt default-ignorable section is incomplete",
  );

  expectCount(recordCount, 12_581, "DerivedCoreProperties.txt record count");
  expectCount(binaryRecordCount, 12_379, "DerivedCoreProperties.txt binary record count");
  expectCount(enumeratedRecordCount, 202, "DerivedCoreProperties.txt enumerated record count");
  expectCount(
    groups.length,
    expectedPropertyGroups.length,
    "DerivedCoreProperties.txt group count",
  );
  for (let index = 0; index < expectedPropertyGroups.length; index += 1) {
    const expected = expectedPropertyGroups[index];
    const actual = groups[index];
    assertGeneration(
      expected !== undefined &&
        actual !== undefined &&
        actual.key === expected[0] &&
        actual.count === expected[1],
      `DerivedCoreProperties.txt property group ${index + 1} is unexpected`,
    );
  }

  expectCount(defaultIgnorableRecords.length, 27, "default-ignorable record count");
  expectCount(
    rangeCodePointCount(defaultIgnorableRecords),
    4_174,
    "default-ignorable code-point count",
  );
  const merged = mergeAdjacentRanges(defaultIgnorableRecords);
  expectCount(merged.length, 17, "default-ignorable merged range count");
  expectCount(rangeCodePointCount(merged), 4_174, "default-ignorable merged code-point count");
  assertGeneration(
    rangeBitsetSha256(merged) === FULL_DEFAULT_IGNORABLE_SHA256,
    "default-ignorable semantic SHA-256 does not match",
  );
  return merged;
}

export function verifyAssignedDefaultIgnorable(defaultIgnorableRanges, assignedRanges) {
  const intersections = [];
  let defaultIndex = 0;
  let assignedIndex = 0;

  while (defaultIndex < defaultIgnorableRanges.length && assignedIndex < assignedRanges.length) {
    const defaultRange = defaultIgnorableRanges[defaultIndex];
    const assignedRange = assignedRanges[assignedIndex];
    assertGeneration(
      defaultRange !== undefined && assignedRange !== undefined,
      "default-ignorable intersection exceeded its source tables",
    );
    const start = Math.max(defaultRange[0], assignedRange[0]);
    const end = Math.min(defaultRange[1], assignedRange[1]);
    if (start <= end) {
      intersections.push([start, end]);
    }
    if (defaultRange[1] <= assignedRange[1]) {
      defaultIndex += 1;
    }
    if (assignedRange[1] <= defaultRange[1]) {
      assignedIndex += 1;
    }
  }

  const merged = mergeAdjacentRanges(intersections);
  expectCount(merged.length, 19, "assigned default-ignorable range count");
  expectCount(rangeCodePointCount(merged), 405, "assigned default-ignorable scalar count");
  assertGeneration(
    rangeBitsetSha256(merged) === ASSIGNED_DEFAULT_IGNORABLE_SHA256,
    "assigned default-ignorable semantic SHA-256 does not match",
  );
}
