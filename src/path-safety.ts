import { Buffer } from "node:buffer";

import { isDefaultIgnorableCodePointUnicode15_1 } from "./validate/generated-unicode.js";

export const MAX_PATH_INPUT_BYTES = 64 * 1024;
export const MAX_PATH_COMPONENTS = 256;

// Module initialization is the trust boundary for the intrinsics below.
const applySnapshot = Reflect.apply;
const bufferByteLengthSnapshot = Buffer.byteLength;
const bufferConstructorSnapshot = Buffer;
const bufferFromSnapshot = Buffer.from;
const bufferToStringSnapshot = Buffer.prototype.toString;
const charCodeAtSnapshot = String.prototype.charCodeAt;
const codePointAtSnapshot = String.prototype.codePointAt;
const defaultIgnorableSnapshot = isDefaultIgnorableCodePointUnicode15_1;
const platformSnapshot = process.platform;
const trimSnapshot = String.prototype.trim;

type Intrinsic = (...args: never[]) => unknown;
function applyIntrinsic<T>(intrinsic: Intrinsic, receiver: unknown, args: unknown[]): T {
  return applySnapshot(intrinsic, receiver, args) as T;
}

function codeUnitAt(value: string, index: number): number {
  return applyIntrinsic<number>(charCodeAtSnapshot, value, [index]);
}

function byteLength(value: string): number {
  return applyIntrinsic<number>(bufferByteLengthSnapshot, bufferConstructorSnapshot, [
    value,
    "utf8",
  ]);
}

export function isUnambiguousUnicode(value: string): boolean {
  const encoded = applyIntrinsic<Buffer>(bufferFromSnapshot, bufferConstructorSnapshot, [
    value,
    "utf8",
  ]);
  if (applyIntrinsic<string>(bufferToStringSnapshot, encoded, ["utf8"]) !== value) return false;
  for (let index = 0; index < value.length; index += 1) {
    const codePoint = applyIntrinsic<number>(codePointAtSnapshot, value, [index]);
    if (
      defaultIgnorableSnapshot(codePoint) ||
      codePoint < 0x20 ||
      (codePoint >= 0x7f && codePoint <= 0x9f) ||
      codePoint === 0x2028 ||
      codePoint === 0x2029 ||
      (codePoint >= 0xfdd0 && codePoint <= 0xfdef) ||
      codePoint % 0x10000 >= 0xfffe
    ) {
      return false;
    }
    if (codePoint > 0xffff) index += 1;
  }
  return true;
}

function isSeparator(codeUnit: number): boolean {
  return codeUnit === 0x2f || codeUnit === 0x5c;
}

function isAsciiLetter(codeUnit: number): boolean {
  return (codeUnit >= 0x41 && codeUnit <= 0x5a) || (codeUnit >= 0x61 && codeUnit <= 0x7a);
}

function hasWindowsDevicePrefix(value: string): boolean {
  const first = codeUnitAt(value, 0);
  const marker = codeUnitAt(value, 2);
  return (
    isSeparator(first) &&
    codeUnitAt(value, 1) === first &&
    (marker === 0x2e || marker === 0x3f) &&
    isSeparator(codeUnitAt(value, 3))
  );
}

function hasWindowsDriveRelative(value: string): boolean {
  return (
    isAsciiLetter(codeUnitAt(value, 0)) &&
    codeUnitAt(value, 1) === 0x3a &&
    (value.length === 2 || !isSeparator(codeUnitAt(value, 2)))
  );
}

function isWindowsDriveComponent(value: string, start: number, end: number): boolean {
  return (
    end - start === 2 &&
    isAsciiLetter(codeUnitAt(value, start)) &&
    codeUnitAt(value, start + 1) === 0x3a
  );
}

function hasComponentCodeUnit(
  value: string,
  start: number,
  end: number,
  expected: number,
): boolean {
  for (let index = start; index < end; index += 1) {
    if (codeUnitAt(value, index) === expected) return true;
  }
  return false;
}

function hasWindowsForbiddenComponent(value: string, start: number, end: number): boolean {
  for (let index = start; index < end; index += 1) {
    const codeUnit = codeUnitAt(value, index);
    if (
      codeUnit === 0x22 ||
      codeUnit === 0x2a ||
      codeUnit === 0x3c ||
      codeUnit === 0x3e ||
      codeUnit === 0x3f ||
      codeUnit === 0x7c
    ) {
      return true;
    }
  }
  return false;
}

function foldedWindowsCodeUnit(value: string, index: number): number {
  const codeUnit = codeUnitAt(value, index);
  if (codeUnit >= 0x41 && codeUnit <= 0x5a) return codeUnit + 0x20;
  return codeUnit === 0x212a ? 0x6b : codeUnit;
}

function hasFoldedPrefix(value: string, start: number, end: number, prefix: string): boolean {
  if (end - start < prefix.length) return false;
  for (let index = 0; index < prefix.length; index += 1) {
    if (foldedWindowsCodeUnit(value, start + index) !== codeUnitAt(prefix, index)) return false;
  }
  return true;
}

function isWindowsDeviceNumber(codeUnit: number): boolean {
  return (
    (codeUnit >= 0x31 && codeUnit <= 0x39) ||
    (codeUnit >= 0xb2 && codeUnit <= 0xb3) ||
    codeUnit === 0xb9
  );
}

function hasWindowsReservedName(value: string, start: number, end: number): boolean {
  let length = 0;
  if (
    hasFoldedPrefix(value, start, end, "clock$") ||
    hasFoldedPrefix(value, start, end, "conin$")
  ) {
    length = 6;
  } else if (hasFoldedPrefix(value, start, end, "conout$")) {
    length = 7;
  } else if (
    hasFoldedPrefix(value, start, end, "aux") ||
    hasFoldedPrefix(value, start, end, "con") ||
    hasFoldedPrefix(value, start, end, "nul") ||
    hasFoldedPrefix(value, start, end, "prn")
  ) {
    length = 3;
  } else if (
    end - start >= 4 &&
    (hasFoldedPrefix(value, start, end, "com") || hasFoldedPrefix(value, start, end, "lpt")) &&
    isWindowsDeviceNumber(codeUnitAt(value, start + 3))
  ) {
    length = 4;
  }
  return length !== 0 && (start + length === end || codeUnitAt(value, start + length) === 0x2e);
}

function hasUnsafeWindowsSyntax(value: string): boolean {
  if (hasWindowsDevicePrefix(value) || hasWindowsDriveRelative(value)) return true;
  let start = 0;
  for (let index = 0; index <= value.length; index += 1) {
    if (index < value.length && !isSeparator(codeUnitAt(value, index))) continue;
    const length = index - start;
    const initial = codeUnitAt(value, start);
    const first = start === 0;
    const drive = first && isWindowsDriveComponent(value, start, index);
    const final = codeUnitAt(value, index - 1);
    const structural =
      length === 0 ||
      (length === 1 && initial === 0x2e) ||
      (length === 2 && initial === 0x2e && codeUnitAt(value, start + 1) === 0x2e);
    if (
      !structural &&
      ((!drive && hasComponentCodeUnit(value, start, index, 0x3a)) ||
        hasWindowsForbiddenComponent(value, start, index) ||
        final === 0x2e ||
        final === 0x20 ||
        hasWindowsReservedName(value, start, index))
    ) {
      return true;
    }
    start = index + 1;
  }
  return false;
}

export function isSafePathInput(
  value: unknown,
  platform: NodeJS.Platform = platformSnapshot,
): value is string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_PATH_INPUT_BYTES ||
    applyIntrinsic<string>(trimSnapshot, value, []).length === 0
  ) {
    return false;
  }
  if (byteLength(value) > MAX_PATH_INPUT_BYTES || !isUnambiguousUnicode(value)) return false;
  return platform !== "win32" || !hasUnsafeWindowsSyntax(value);
}
