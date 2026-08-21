import { Buffer } from "node:buffer";

import { isDefaultIgnorableCodePointUnicode15_1 } from "./generated-unicode.js";
import {
  portableFilenameKey,
  projectNfcWithVerifiedRuntime,
  type PortableFilenameKeyResult,
} from "./unicode-portability.js";

export const MAX_RESOURCE_NAME_BYTES = 255;

export type ResourceNameProfileFailureReason =
  | "type"
  | "empty"
  | "too_large"
  | "separator"
  | "dot"
  | "unsafe_unicode"
  | "nonportable"
  | "unassigned"
  | "unsupported_runtime";

declare const resourceNameProfileBrand: unique symbol;
type ResourceNameProfileBrand = { readonly [resourceNameProfileBrand]: true };

export type ResourceNameProfile = Readonly<{
  ok: true;
  exact: string;
  exactByteLength: number;
  nfc: string;
  key: string;
  isNfc: boolean;
}> &
  ResourceNameProfileBrand;

export type ResourceNameProfileFailure = Readonly<{
  ok: false;
  reason: ResourceNameProfileFailureReason;
}> &
  ResourceNameProfileBrand;

export type ResourceNameProfileResult = ResourceNameProfile | ResourceNameProfileFailure;

// Module initialization is the trust boundary for the intrinsics below.
const applySnapshot = Reflect.apply;
const bufferByteLengthSnapshot = Buffer.byteLength;
const charCodeAtSnapshot = String.prototype.charCodeAt;
const freezeSnapshot = Object.freeze;
const weakSetAddSnapshot = WeakSet.prototype.add;
const weakSetHasSnapshot = WeakSet.prototype.has;

const resultProvenance = new WeakSet<object>();

function registerResult<T extends ResourceNameProfileResult>(result: T): T {
  const frozen = freezeSnapshot(result);
  applySnapshot(weakSetAddSnapshot, resultProvenance, [frozen]);
  return frozen;
}

const failures: Readonly<Record<ResourceNameProfileFailureReason, ResourceNameProfileFailure>> =
  freezeSnapshot({
    type: registerResult({ ok: false, reason: "type" } as ResourceNameProfileFailure),
    empty: registerResult({ ok: false, reason: "empty" } as ResourceNameProfileFailure),
    too_large: registerResult({ ok: false, reason: "too_large" } as ResourceNameProfileFailure),
    separator: registerResult({ ok: false, reason: "separator" } as ResourceNameProfileFailure),
    dot: registerResult({ ok: false, reason: "dot" } as ResourceNameProfileFailure),
    unsafe_unicode: registerResult({
      ok: false,
      reason: "unsafe_unicode",
    } as ResourceNameProfileFailure),
    nonportable: registerResult({
      ok: false,
      reason: "nonportable",
    } as ResourceNameProfileFailure),
    unassigned: registerResult({ ok: false, reason: "unassigned" } as ResourceNameProfileFailure),
    unsupported_runtime: registerResult({
      ok: false,
      reason: "unsupported_runtime",
    } as ResourceNameProfileFailure),
  });

function failure(reason: ResourceNameProfileFailureReason): ResourceNameProfileFailure {
  return failures[reason];
}

function codeUnitAt(value: string, index: number): number {
  return applySnapshot(charCodeAtSnapshot, value, [index]) as number;
}

function byteLength(value: string): number {
  return applySnapshot(bufferByteLengthSnapshot, Buffer, [value, "utf8"]) as number;
}

function hasPrefix(value: string, prefix: string): boolean {
  for (let index = 0; index < prefix.length; index += 1) {
    if (codeUnitAt(value, index) !== codeUnitAt(prefix, index)) {
      return false;
    }
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

function hasReservedWindowsKey(key: string): boolean {
  let end = 0;
  if (hasPrefix(key, "clock$") || hasPrefix(key, "conin$")) {
    end = 6;
  } else if (hasPrefix(key, "conout$")) {
    end = 7;
  } else if (
    hasPrefix(key, "aux") ||
    hasPrefix(key, "con") ||
    hasPrefix(key, "nul") ||
    hasPrefix(key, "prn")
  ) {
    end = 3;
  } else if (
    (hasPrefix(key, "com") || hasPrefix(key, "lpt")) &&
    isWindowsDeviceNumber(codeUnitAt(key, 3))
  ) {
    end = 4;
  }
  return end !== 0 && (end === key.length || codeUnitAt(key, end) === 0x2e);
}

function safePortableFilenameKey(value: string): PortableFilenameKeyResult | undefined {
  try {
    return portableFilenameKey(value);
  } catch {
    return undefined;
  }
}

function hasSeparator(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = codeUnitAt(value, index);
    if (codeUnit === 0x2f || codeUnit === 0x5c) {
      return true;
    }
  }
  return false;
}

function hasUnsafeUnicode(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const first = codeUnitAt(value, index);
    let codePoint = first;
    if (first >= 0xd800 && first <= 0xdbff && index + 1 < value.length) {
      const second = codeUnitAt(value, index + 1);
      if (second >= 0xdc00 && second <= 0xdfff) {
        codePoint = (first - 0xd800) * 0x400 + second - 0xdc00 + 0x10000;
        index += 1;
      }
    }
    if (
      codePoint < 0x20 ||
      (codePoint >= 0x7f && codePoint <= 0x9f) ||
      codePoint === 0x2028 ||
      codePoint === 0x2029 ||
      (codePoint >= 0xfdd0 && codePoint <= 0xfdef) ||
      (codePoint & 0xffff) >= 0xfffe ||
      isDefaultIgnorableCodePointUnicode15_1(codePoint)
    ) {
      return true;
    }
  }
  return false;
}

function hasUnsafeWindowsName(exact: string, key: string): boolean {
  for (let index = 0; index < exact.length; index += 1) {
    const codeUnit = codeUnitAt(exact, index);
    if (
      codeUnit === 0x22 ||
      codeUnit === 0x2a ||
      codeUnit === 0x3a ||
      codeUnit === 0x3c ||
      codeUnit === 0x3e ||
      codeUnit === 0x3f ||
      codeUnit === 0x7c
    ) {
      return true;
    }
  }
  const finalCodeUnit = codeUnitAt(exact, exact.length - 1);
  return finalCodeUnit === 0x20 || finalCodeUnit === 0x2e || hasReservedWindowsKey(key);
}

function successfulProfile(
  exact: string,
  exactByteLength: number,
  nfc: string,
  key: string,
): ResourceNameProfile {
  return registerResult({
    ok: true,
    exact,
    exactByteLength,
    nfc,
    key,
    isNfc: exact === nfc,
  } as ResourceNameProfile);
}

/** Profile one already-observed filesystem entry name without opening or resolving it. */
export function profileObservedResourceName(value: unknown): ResourceNameProfileResult {
  if (typeof value !== "string") {
    return failure("type");
  }
  if (value.length === 0) {
    return failure("empty");
  }
  if (value.length > MAX_RESOURCE_NAME_BYTES) {
    return failure("too_large");
  }
  const exactByteLength = byteLength(value);
  if (exactByteLength > MAX_RESOURCE_NAME_BYTES) {
    return failure("too_large");
  }
  if (hasSeparator(value)) {
    return failure("separator");
  }
  if (value === "." || value === "..") {
    return failure("dot");
  }

  const initialKey = safePortableFilenameKey(value);
  if (initialKey === undefined || (!initialKey.ok && initialKey.reason === "unsupported_runtime")) {
    return failure("unsupported_runtime");
  }
  if (!initialKey.ok && initialKey.reason === "unassigned") {
    return failure("unassigned");
  }

  let nfc: string;
  let key: string;
  if (initialKey.ok) {
    nfc = value;
    key = initialKey.key;
  } else {
    const projected = projectNfcWithVerifiedRuntime(value);
    if (projected === undefined) {
      return failure("unsupported_runtime");
    }
    nfc = projected;
    const projectedKey = safePortableFilenameKey(nfc);
    if (projectedKey === undefined || !projectedKey.ok) {
      return failure("unsupported_runtime");
    }
    key = projectedKey.key;
  }

  if (hasUnsafeUnicode(value)) {
    return failure("unsafe_unicode");
  }
  if (hasUnsafeWindowsName(value, key)) {
    return failure("nonportable");
  }
  return successfulProfile(value, exactByteLength, nfc, key);
}

/** Accept only identities produced by this module; no properties are inspected. */
export function isResourceNameProfileResult(value: unknown): value is ResourceNameProfileResult {
  if ((typeof value !== "object" && typeof value !== "function") || value === null) {
    return false;
  }
  return applySnapshot(weakSetHasSnapshot, resultProvenance, [value]) as boolean;
}
