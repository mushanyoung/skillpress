import { Buffer } from "node:buffer";

import { isSafePathInput, isUnambiguousUnicode } from "../path-safety.js";

export const MAX_SKILL_REFERENCE_COMPONENT_BYTES = 255;
export const MAX_SKILL_REFERENCE_DESTINATION_BYTES = 4 * 1024;
export const MAX_SKILL_REFERENCE_PATH_COMPONENTS = 64;

const URI_SCHEME = /^([A-Za-z][A-Za-z0-9+.-]*):/u;
const WINDOWS_DRIVE = /^[A-Za-z]:/u;
const WINDOWS_DEVICE_PATH = /^\/\/[?.](?:\/|$)/u;
const ENCODED_SEPARATOR = /%(?:2f|5c)/iu;
const ENCODED_DELIMITER = /%(?:23|3a|3f)/iu;
const WINDOWS_DEVICE_SCHEME = /^(?:aux|com[1-9]|con|lpt[1-9]|nul|prn)$/u;
const WHITESPACE = /\s/u;
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
const bufferByteLengthSnapshot = Buffer.byteLength;
const bufferConstructorSnapshot = Buffer;
const decodeURIComponentSnapshot = decodeURIComponent;
const definePropertySnapshot = Object.defineProperty;
const freezeSnapshot = Object.freeze;
const includesSnapshot = String.prototype.includes;
const indexOfSnapshot = String.prototype.indexOf;
const isSafePathInputSnapshot = isSafePathInput;
const isUnambiguousUnicodeSnapshot = isUnambiguousUnicode;
const normalizeSnapshot = String.prototype.normalize;
const regexpExecSnapshot = RegExp.prototype.exec;
const setHasSnapshot = Set.prototype.has;
const sliceSnapshot = String.prototype.slice;
const startsWithSnapshot = String.prototype.startsWith;
const toLowerCaseSnapshot = String.prototype.toLowerCase;

type Intrinsic = (...args: never[]) => unknown;
function applyIntrinsic<T>(intrinsic: Intrinsic, receiver: unknown, args: unknown[]): T {
  return applySnapshot(intrinsic, receiver, args) as T;
}

function matches(pattern: RegExp, value: string): RegExpExecArray | null {
  return applyIntrinsic<RegExpExecArray | null>(regexpExecSnapshot, pattern, [value]);
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

function append<T>(values: T[], value: T): void {
  applyIntrinsic<T[]>(definePropertySnapshot, Object, [
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
    matches(WINDOWS_DEVICE_SCHEME, normalized) !== null
  ) {
    return invalid("unsafe_scheme");
  }
  if (includes(raw, "\\")) return invalid("backslash");
  if (matches(WHITESPACE, raw) !== null) return invalid("invalid_external");
  return EXTERNAL;
}

function protocolRelative(raw: string): MarkdownDestination {
  if (includes(raw, "\\")) return invalid("backslash");
  if (startsWith(raw, "///") || matches(WINDOWS_DEVICE_PATH, raw) !== null) {
    return invalid("absolute_path");
  }
  if (matches(WHITESPACE, raw) !== null) return invalid("invalid_external");
  const first = applyIntrinsic<string>(sliceSnapshot, raw, [2, 3]);
  return includes("/?#", first) ? invalid("invalid_external") : EXTERNAL;
}

function decodedLocalPath(rawPath: string): MarkdownDestination {
  if (startsWith(rawPath, "/")) return invalid("absolute_path");
  if (matches(ENCODED_SEPARATOR, rawPath) !== null) return invalid("encoded_separator");
  if (matches(ENCODED_DELIMITER, rawPath) !== null) return invalid("encoded_delimiter");

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
  if (matches(WINDOWS_DRIVE, raw) !== null) return invalid("windows_drive");
  if (startsWith(raw, "#") || startsWith(raw, "?")) return DOCUMENT;
  if (startsWith(raw, "//")) return protocolRelative(raw);

  const scheme = matches(URI_SCHEME, raw);
  if (scheme !== null) return externalScheme(raw, scheme[1] as string);

  const fragment = applyIntrinsic<number>(indexOfSnapshot, raw, ["#"]);
  const rawPath = fragment === -1 ? raw : applyIntrinsic<string>(sliceSnapshot, raw, [0, fragment]);
  if (includes(rawPath, "\\")) return invalid("backslash");
  if (includes(rawPath, "?")) return invalid("query");
  return decodedLocalPath(rawPath);
}
