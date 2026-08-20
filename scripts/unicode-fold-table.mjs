import { assertGeneration, expectCount, MAX_CODE_POINT } from "./unicode-source-parse.mjs";

export function compressCaseFolding(selected) {
  const ranges = [];
  const exceptions = [];

  for (let index = 0; index < selected.length; ) {
    const first = selected[index];
    assertGeneration(first !== undefined, "case-fold compression lost its current record");

    const second = selected[index + 1];
    if (first.mapping.length !== 1 || second === undefined || second.mapping.length !== 1) {
      exceptions.push(first);
      index += 1;
      continue;
    }

    const firstTarget = first.mapping[0];
    const secondTarget = second.mapping[0];
    assertGeneration(
      firstTarget !== undefined && secondTarget !== undefined,
      "case-fold compression found an empty mapping",
    );
    const delta = firstTarget - first.source;
    const stride = second.source - first.source;
    if (stride <= 0 || secondTarget - second.source !== delta) {
      exceptions.push(first);
      index += 1;
      continue;
    }

    let endIndex = index + 2;
    while (endIndex < selected.length) {
      const previous = selected[endIndex - 1];
      const current = selected[endIndex];
      if (previous === undefined || current === undefined || current.mapping.length !== 1) {
        break;
      }
      const target = current.mapping[0];
      if (
        target === undefined ||
        current.source - previous.source !== stride ||
        target - current.source !== delta
      ) {
        break;
      }
      endIndex += 1;
    }

    const last = selected[endIndex - 1];
    assertGeneration(last !== undefined, "case-fold compression lost its final record");
    ranges.push({ start: first.source, end: last.source, stride, delta });
    index = endIndex;
  }

  expectCount(ranges.length, 91, "case-fold range count");
  expectCount(exceptions.length, 204, "case-fold exception count");
  expectCount(
    ranges.reduce((count, range) => count + (range.end - range.start) / range.stride + 1, 0),
    1_326,
    "case-fold range coverage",
  );
  expectCount(
    exceptions.filter((record) => record.mapping.length > 1).length,
    104,
    "multi-scalar case-fold exception count",
  );
  expectCount(
    exceptions.filter((record) => record.mapping.length === 1).length,
    100,
    "single-scalar case-fold exception count",
  );

  for (let index = 1; index < ranges.length; index += 1) {
    const previous = ranges[index - 1];
    const current = ranges[index];
    assertGeneration(
      previous !== undefined && current !== undefined && current.start > previous.end,
      "case-fold range spans overlap or are not sorted",
    );
  }
  for (let index = 1; index < exceptions.length; index += 1) {
    const previous = exceptions[index - 1];
    const current = exceptions[index];
    assertGeneration(
      previous !== undefined && current !== undefined && current.source > previous.source,
      "case-fold exceptions are not strictly sorted",
    );
  }
  return { ranges, exceptions };
}

function compressedFold(codePoint, compressed) {
  let low = 0;
  let high = compressed.exceptions.length - 1;
  while (low <= high) {
    const middle = low + Math.floor((high - low) / 2);
    const exception = compressed.exceptions[middle];
    assertGeneration(exception !== undefined, "case-fold exception search exceeded its table");
    if (codePoint < exception.source) {
      high = middle - 1;
    } else if (codePoint > exception.source) {
      low = middle + 1;
    } else {
      return exception.mapping;
    }
  }

  low = 0;
  high = compressed.ranges.length - 1;
  while (low <= high) {
    const middle = low + Math.floor((high - low) / 2);
    const range = compressed.ranges[middle];
    assertGeneration(range !== undefined, "case-fold range search exceeded its table");
    if (codePoint < range.start) {
      high = middle - 1;
    } else if (codePoint > range.end) {
      low = middle + 1;
    } else if ((codePoint - range.start) % range.stride === 0) {
      return [codePoint + range.delta];
    } else {
      return [codePoint];
    }
  }
  return [codePoint];
}

export function verifyCaseFolding(selected, compressed) {
  const oracle = new Map(selected.map((record) => [record.source, record.mapping]));
  for (let codePoint = 0; codePoint <= MAX_CODE_POINT; codePoint += 1) {
    const expected = oracle.get(codePoint) ?? [codePoint];
    const actual = compressedFold(codePoint, compressed);
    assertGeneration(
      actual.length === expected.length &&
        actual.every((value, index) => value === expected[index]),
      `case-fold compression mismatch at U+${codePoint.toString(16)}`,
    );
  }
}
