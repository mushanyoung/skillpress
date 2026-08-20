import {
  assertGeneration,
  isAscii,
  MAX_CODE_POINT,
  SURROGATE_END,
  SURROGATE_START,
  UNICODE_VERSION,
} from "./unicode-source-parse.mjs";

function hex(value) {
  return `0x${value.toString(16)}`;
}

function escapedMapping(mapping) {
  return mapping.map((codePoint) => `\\u{${codePoint.toString(16)}}`).join("");
}

export function renderGeneratedSource(assignedRanges, compressed) {
  const assignedRows = assignedRanges
    .map(([start, end]) => `  [${hex(start)}, ${hex(end)}],`)
    .join("\n");
  const foldRangeRows = compressed.ranges
    .map(({ start, end, stride, delta }) => `  [${hex(start)}, ${hex(end)}, ${stride}, ${delta}],`)
    .join("\n");
  const exceptionRows = compressed.exceptions
    .map(({ source, mapping }) => `  [${hex(source)}, "${escapedMapping(mapping)}"],`)
    .join("\n");

  const generated = `/* Generated from Unicode Character Database ${UNICODE_VERSION} by
 * scripts/generate-unicode-tables.mjs. Do not edit by hand. */

type AssignedRange = readonly [start: number, end: number];
type FoldRange = readonly [start: number, end: number, stride: number, delta: number];
type FoldException = readonly [codePoint: number, mapping: string];

const ASSIGNED_SCALAR_RANGES: readonly AssignedRange[] = [
${assignedRows}
];

const CASE_FOLD_RANGES: readonly FoldRange[] = [
${foldRangeRows}
];

const CASE_FOLD_EXCEPTIONS: readonly FoldException[] = [
${exceptionRows}
];

export const UNICODE_PORTABILITY_VERSION: string = "${UNICODE_VERSION}";

function foldCodePoint(codePoint: number): string {
  let low = 0;
  let high = CASE_FOLD_EXCEPTIONS.length - 1;
  while (low <= high) {
    const middle = low + Math.floor((high - low) / 2);
    const [source, mapping] = CASE_FOLD_EXCEPTIONS[middle] as FoldException;
    if (codePoint < source) {
      high = middle - 1;
    } else if (codePoint > source) {
      low = middle + 1;
    } else {
      return mapping;
    }
  }

  low = 0;
  high = CASE_FOLD_RANGES.length - 1;
  while (low <= high) {
    const middle = low + Math.floor((high - low) / 2);
    const [start, end, stride, delta] = CASE_FOLD_RANGES[middle] as FoldRange;
    if (codePoint < start) {
      high = middle - 1;
    } else if (codePoint > end) {
      low = middle + 1;
    } else if ((codePoint - start) % stride === 0) {
      return String.fromCodePoint(codePoint + delta);
    } else {
      return String.fromCodePoint(codePoint);
    }
  }
  return String.fromCodePoint(codePoint);
}

export function fullCaseFoldUnicode15_1(value: string): string {
  let result = "";
  for (const character of value) {
    result += foldCodePoint(character.codePointAt(0) as number);
  }
  return result;
}

export function isAssignedScalarUnicode15_1(codePoint: number): boolean {
  if (
    !Number.isInteger(codePoint) ||
    codePoint < 0 ||
    codePoint > ${hex(MAX_CODE_POINT)} ||
    (codePoint >= ${hex(SURROGATE_START)} && codePoint <= ${hex(SURROGATE_END)})
  ) {
    return false;
  }

  let low = 0;
  let high = ASSIGNED_SCALAR_RANGES.length - 1;
  while (low <= high) {
    const middle = low + Math.floor((high - low) / 2);
    const [start, end] = ASSIGNED_SCALAR_RANGES[middle] as AssignedRange;
    if (codePoint < start) {
      high = middle - 1;
    } else if (codePoint > end) {
      low = middle + 1;
    } else {
      return true;
    }
  }
  return false;
}
`;

  assertGeneration(isAscii(generated), "generated module must contain ASCII only");
  return generated;
}
