import {
  assertGeneration,
  compareUnicodeVersions,
  expectCount,
  isAscii,
  isCodePoint,
  SURROGATE_END,
  SURROGATE_START,
} from "./unicode-source-parse.mjs";

const derivedAgeRecordPattern =
  /^([0-9A-F]{4,6})(?:\.\.([0-9A-F]{4,6}))?\s*;\s*([0-9]+)\.([0-9]+)$/;

export function parseDerivedAge(lines) {
  expectCount(
    lines.filter((line) => line === "# @missing: 0000..10FFFF; Unassigned").length,
    1,
    "DerivedAge.txt missing-value declaration count",
  );

  const records = [];
  let previous;
  for (const [index, line] of lines.entries()) {
    if (line === "" || line.startsWith("#")) {
      continue;
    }

    const commentIndex = line.indexOf("#");
    const data = (commentIndex === -1 ? line : line.slice(0, commentIndex)).trimEnd();
    assertGeneration(isAscii(data), `DerivedAge.txt line ${index + 1} is not ASCII data`);
    const match = derivedAgeRecordPattern.exec(data);
    assertGeneration(match !== null, `DerivedAge.txt line ${index + 1} has invalid grammar`);

    const startText = match[1];
    const endText = match[2] ?? startText;
    const majorText = match[3];
    const minorText = match[4];
    assertGeneration(
      startText !== undefined &&
        endText !== undefined &&
        majorText !== undefined &&
        minorText !== undefined,
      `DerivedAge.txt line ${index + 1} is incomplete`,
    );

    const start = Number.parseInt(startText, 16);
    const end = Number.parseInt(endText, 16);
    const version = [Number.parseInt(majorText, 10), Number.parseInt(minorText, 10)];
    assertGeneration(
      isCodePoint(start) && isCodePoint(end),
      `DerivedAge.txt line ${index + 1} has an invalid endpoint`,
    );
    assertGeneration(start <= end, `DerivedAge.txt line ${index + 1} has a reversed range`);

    if (previous !== undefined) {
      const versionOrder = compareUnicodeVersions(version, previous.version);
      assertGeneration(
        versionOrder > 0 || (versionOrder === 0 && start > previous.start),
        `DerivedAge.txt line ${index + 1} is not strictly ordered`,
      );
    }
    previous = { version, start };
    records.push({ start, end, version });
  }
  expectCount(records.length, 1_721, "DerivedAge.txt record count");

  const byStart = [...records].sort((left, right) => left.start - right.start);
  for (let index = 1; index < byStart.length; index += 1) {
    const previousRange = byStart[index - 1];
    const currentRange = byStart[index];
    assertGeneration(
      previousRange !== undefined &&
        currentRange !== undefined &&
        currentRange.start > previousRange.end,
      "DerivedAge.txt contains overlapping or duplicate ranges",
    );
  }

  const selected = byStart.filter((record) => compareUnicodeVersions(record.version, [15, 1]) <= 0);
  expectCount(
    selected.reduce((count, record) => count + record.end - record.start + 1, 0),
    289_460,
    "Unicode 15.1 assigned code-point count",
  );

  let surrogateCount = 0;
  const scalarParts = [];
  for (const record of selected) {
    const overlapStart = Math.max(record.start, SURROGATE_START);
    const overlapEnd = Math.min(record.end, SURROGATE_END);
    if (overlapStart <= overlapEnd) {
      surrogateCount += overlapEnd - overlapStart + 1;
    }
    if (record.start < SURROGATE_START) {
      scalarParts.push([record.start, Math.min(record.end, SURROGATE_START - 1)]);
    }
    if (record.end > SURROGATE_END) {
      scalarParts.push([Math.max(record.start, SURROGATE_END + 1), record.end]);
    }
  }
  expectCount(surrogateCount, 2_048, "Unicode 15.1 assigned surrogate count");

  const merged = [];
  for (const [start, end] of scalarParts) {
    const previousRange = merged.at(-1);
    if (previousRange !== undefined && start === previousRange[1] + 1) {
      previousRange[1] = end;
    } else {
      merged.push([start, end]);
    }
  }

  expectCount(
    merged.reduce((count, [start, end]) => count + end - start + 1, 0),
    287_412,
    "Unicode 15.1 assigned scalar count",
  );
  expectCount(merged.length, 715, "Unicode 15.1 assigned scalar range count");
  return merged;
}
