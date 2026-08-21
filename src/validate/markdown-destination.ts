import { Buffer } from "node:buffer";

import { isSafePathInput, isUnambiguousUnicode } from "../path-safety.js";

export const MAX_SKILL_REFERENCE_COMPONENT_BYTES = 255;
export const MAX_SKILL_REFERENCE_DESTINATION_BYTES = 4 * 1024;
export const MAX_SKILL_REFERENCE_PATH_COMPONENTS = 64;

const DANGEROUS_SCHEMES = new Set(["data", "file", "javascript", "vbscript"]);

export type MarkdownDestinationIssue =
  | "absolute_path"
  | "ambiguous_encoding"
  | "backslash"
  | "component_too_large"
  | "dot_component"
  | "empty_component"
  | "encoded_delimiter"
  | "encoded_separator"
  | "invalid_external"
  | "malformed_encoding"
  | "non_nfc"
  | "nonportable_component"
  | "query"
  | "too_large"
  | "too_many_components"
  | "type"
  | "unsafe_scheme"
  | "unsafe_unicode"
  | "windows_drive";

export type MarkdownDestination =
  | { readonly kind: "document" }
  | { readonly kind: "external" }
  | {
      readonly kind: "local";
      readonly path: string;
      readonly components: readonly string[];
    }
  | { readonly kind: "invalid"; readonly reason: MarkdownDestinationIssue };

// Module initialization is the trust boundary for the intrinsics and producers below.
const applySnapshot = Reflect.apply;
const objectRef = Object;
const bufferByteLengthSnapshot = Buffer.byteLength;
const bufferConstructorSnapshot = Buffer;
const charCodeAtSnapshot = String.prototype.charCodeAt;
const decodeURIComponentSnapshot = decodeURIComponent;
const definePropertySnapshot = Object.defineProperty;
const freezeSnapshot = Object.freeze;
const includesSnapshot = String.prototype.includes;
const indexOfSnapshot = String.prototype.indexOf;
const isSafePathInputSnapshot = isSafePathInput;
const isUnambiguousUnicodeSnapshot = isUnambiguousUnicode;
const normalizeSnapshot = String.prototype.normalize;
const setHasSnapshot = Set.prototype.has;
const sliceSnapshot = String.prototype.slice;
const startsWithSnapshot = String.prototype.startsWith;
const toLowerCaseSnapshot = String.prototype.toLowerCase;

type Intrinsic = (...args: never[]) => unknown;
function applyIntrinsic<T>(intrinsic: Intrinsic, receiver: unknown, args: unknown[]): T {
  return applySnapshot(intrinsic, receiver, args) as T;
}

function includes(value: string, search: string): boolean {
  return applyIntrinsic<boolean>(includesSnapshot, value, [search]);
}

function startsWith(value: string, search: string): boolean {
  return applyIntrinsic<boolean>(startsWithSnapshot, value, [search]);
}

function byteLength(value: string): number {
  return applyIntrinsic<number>(bufferByteLengthSnapshot, bufferConstructorSnapshot, [
    value,
    "utf8",
  ]);
}

function safePath(value: string): boolean {
  return applyIntrinsic<boolean>(isSafePathInputSnapshot, undefined, [value, "win32"]);
}

function unambiguous(value: string): boolean {
  return applyIntrinsic<boolean>(isUnambiguousUnicodeSnapshot, undefined, [value]);
}

function codeUnitAt(value: string, index: number): number {
  return applyIntrinsic<number>(charCodeAtSnapshot, value, [index]);
}

function isAsciiLetter(code: number): boolean {
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}

function uriSchemeEnd(value: string): number {
  if (!isAsciiLetter(codeUnitAt(value, 0))) return -1;
  for (let index = 1; index < value.length; index += 1) {
    const code = codeUnitAt(value, index);
    if (code === 58) return index;
    if (
      !isAsciiLetter(code) &&
      !(code >= 48 && code <= 57) &&
      code !== 43 &&
      code !== 45 &&
      code !== 46
    ) {
      return -1;
    }
  }
  return -1;
}

function hasWindowsDrive(value: string): boolean {
  return isAsciiLetter(codeUnitAt(value, 0)) && codeUnitAt(value, 1) === 58;
}

function hasWindowsDevicePath(value: string): boolean {
  if (value.length < 3 || codeUnitAt(value, 0) !== 47 || codeUnitAt(value, 1) !== 47) {
    return false;
  }
  const marker = codeUnitAt(value, 2);
  return (marker === 46 || marker === 63) && (value.length === 3 || codeUnitAt(value, 3) === 47);
}

function encodedSyntax(value: string): 0 | 1 | 2 {
  let delimiter = false;
  for (let index = 0; index + 2 < value.length; index += 1) {
    if (codeUnitAt(value, index) !== 37) continue;
    const middle = codeUnitAt(value, index + 1);
    const last = codeUnitAt(value, index + 2);
    if (
      (middle === 50 && (last === 70 || last === 102)) ||
      (middle === 53 && (last === 67 || last === 99))
    ) {
      return 1;
    }
    if (
      (middle === 50 && last === 51) ||
      (middle === 51 && (last === 65 || last === 70 || last === 97 || last === 102))
    ) {
      delimiter = true;
    }
  }
  return delimiter ? 2 : 0;
}

function isWindowsDeviceScheme(value: string): boolean {
  if (value === "aux" || value === "con" || value === "nul" || value === "prn") {
    return true;
  }
  if (value.length !== 4) return false;
  const first = codeUnitAt(value, 0);
  const second = codeUnitAt(value, 1);
  const third = codeUnitAt(value, 2);
  const digit = codeUnitAt(value, 3);
  return (
    ((first === 99 && second === 111 && third === 109) ||
      (first === 108 && second === 112 && third === 116)) &&
    digit >= 49 &&
    digit <= 57
  );
}

function isEsWhitespace(code: number): boolean {
  return (
    (code >= 9 && code <= 13) ||
    code === 32 ||
    code === 160 ||
    code === 5760 ||
    (code >= 8192 && code <= 8202) ||
    code === 8232 ||
    code === 8233 ||
    code === 8239 ||
    code === 8287 ||
    code === 12_288 ||
    code === 65_279
  );
}

function hasEsWhitespace(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    if (isEsWhitespace(codeUnitAt(value, index))) return true;
  }
  return false;
}

function append<T>(values: T[], value: T): void {
  applyIntrinsic<T[]>(definePropertySnapshot, objectRef, [
    values,
    values.length,
    { __proto__: null, configurable: true, enumerable: true, value, writable: true },
  ]);
}

const DOCUMENT = freezeSnapshot({ kind: "document" } as const);
const EXTERNAL = freezeSnapshot({ kind: "external" } as const);

function invalid(reason: MarkdownDestinationIssue): MarkdownDestination {
  return freezeSnapshot({ kind: "invalid", reason });
}

/** Purely check one decoded component the local classifier can emit; grants no authority. */
export function isCanonicalDecodedMarkdownLocalComponent(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value === "." ||
    value === ".." ||
    includes(value, "/") ||
    includes(value, "\\") ||
    includes(value, "%") ||
    includes(value, "#") ||
    byteLength(value) > MAX_SKILL_REFERENCE_COMPONENT_BYTES ||
    !unambiguous(value) ||
    applyIntrinsic<string>(normalizeSnapshot, value, ["NFC"]) !== value
  ) {
    return false;
  }
  return safePath(value);
}

function externalScheme(raw: string, scheme: string): MarkdownDestination {
  const normalized = applyIntrinsic<string>(toLowerCaseSnapshot, scheme, []);
  if (
    applyIntrinsic<boolean>(setHasSnapshot, DANGEROUS_SCHEMES, [normalized]) ||
    isWindowsDeviceScheme(normalized)
  ) {
    return invalid("unsafe_scheme");
  }
  if (includes(raw, "\\")) return invalid("backslash");
  if (hasEsWhitespace(raw)) return invalid("invalid_external");
  return EXTERNAL;
}

function protocolRelative(raw: string): MarkdownDestination {
  if (includes(raw, "\\")) return invalid("backslash");
  if (startsWith(raw, "///") || hasWindowsDevicePath(raw)) {
    return invalid("absolute_path");
  }
  if (hasEsWhitespace(raw)) return invalid("invalid_external");
  const first = applyIntrinsic<string>(sliceSnapshot, raw, [2, 3]);
  return includes("/?#", first) ? invalid("invalid_external") : EXTERNAL;
}

function decodedLocalPath(rawPath: string): MarkdownDestination {
  if (startsWith(rawPath, "/")) return invalid("absolute_path");
  const syntax = encodedSyntax(rawPath);
  if (syntax === 1) return invalid("encoded_separator");
  if (syntax === 2) return invalid("encoded_delimiter");

  let decoded: string;
  try {
    decoded = applyIntrinsic<string>(decodeURIComponentSnapshot, undefined, [rawPath]);
  } catch {
    return invalid("malformed_encoding");
  }
  if (includes(decoded, "%")) return invalid("ambiguous_encoding");
  if (!unambiguous(decoded)) return invalid("unsafe_unicode");
  if (applyIntrinsic<string>(normalizeSnapshot, decoded, ["NFC"]) !== decoded) {
    return invalid("non_nfc");
  }

  const components: string[] = [];
  let start = 0;
  while (start <= decoded.length) {
    const separator = applyIntrinsic<number>(indexOfSnapshot, decoded, ["/", start]);
    const end = separator === -1 ? decoded.length : separator;
    append(components, applyIntrinsic<string>(sliceSnapshot, decoded, [start, end]));
    if (separator === -1) break;
    start = separator + 1;
  }
  if (components.length > MAX_SKILL_REFERENCE_PATH_COMPONENTS) {
    return invalid("too_many_components");
  }
  const copied: string[] = [];
  for (let index = 0; index < components.length; index += 1) {
    const component = components[index] as string;
    if (component.length === 0) return invalid("empty_component");
    if (component === "." || component === "..") return invalid("dot_component");
    if (byteLength(component) > MAX_SKILL_REFERENCE_COMPONENT_BYTES) {
      return invalid("component_too_large");
    }
    if (!isCanonicalDecodedMarkdownLocalComponent(component)) {
      return invalid("nonportable_component");
    }
    append(copied, component);
  }
  return freezeSnapshot({ kind: "local", path: decoded, components: freezeSnapshot(copied) });
}

/** Classify an inert CommonMark destination. This function never opens or fetches the target. */
export function classifyMarkdownDestination(raw: unknown): MarkdownDestination {
  if (typeof raw !== "string") return invalid("type");
  if (
    raw.length > MAX_SKILL_REFERENCE_DESTINATION_BYTES ||
    byteLength(raw) > MAX_SKILL_REFERENCE_DESTINATION_BYTES
  ) {
    return invalid("too_large");
  }
  if (raw.length === 0) return DOCUMENT;
  if (!unambiguous(raw)) return invalid("unsafe_unicode");
  if (hasWindowsDrive(raw)) return invalid("windows_drive");
  if (startsWith(raw, "#") || startsWith(raw, "?")) return DOCUMENT;
  if (startsWith(raw, "//")) return protocolRelative(raw);

  const schemeEnd = uriSchemeEnd(raw);
  if (schemeEnd !== -1) {
    return externalScheme(raw, applyIntrinsic<string>(sliceSnapshot, raw, [0, schemeEnd]));
  }

  const fragment = applyIntrinsic<number>(indexOfSnapshot, raw, ["#"]);
  const rawPath = fragment === -1 ? raw : applyIntrinsic<string>(sliceSnapshot, raw, [0, fragment]);
  if (includes(rawPath, "\\")) return invalid("backslash");
  if (includes(rawPath, "?")) return invalid("query");
  return decodedLocalPath(rawPath);
}
