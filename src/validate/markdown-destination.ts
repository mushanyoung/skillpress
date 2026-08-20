import { isSafePathInput, isUnambiguousUnicode } from "../path-safety.js";

export const MAX_SKILL_REFERENCE_COMPONENT_BYTES = 255;
export const MAX_SKILL_REFERENCE_DESTINATION_BYTES = 4 * 1024;
export const MAX_SKILL_REFERENCE_PATH_COMPONENTS = 64;

const URI_SCHEME = /^([A-Za-z][A-Za-z0-9+.-]*):/u;
const WINDOWS_DRIVE = /^[A-Za-z]:/u;
const WINDOWS_DEVICE_PATH = /^\/\/[?.](?:\/|$)/u;
const ENCODED_SEPARATOR = /%(?:2f|5c)/iu;
const ENCODED_DELIMITER = /%(?:23|3a|3f)/iu;
const DANGEROUS_SCHEMES = new Set(["data", "file", "javascript", "vbscript"]);
const WINDOWS_DEVICE_SCHEME = /^(?:aux|com[1-9]|con|lpt[1-9]|nul|prn)$/u;

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

const DOCUMENT = Object.freeze({ kind: "document" } as const);
const EXTERNAL = Object.freeze({ kind: "external" } as const);

function invalid(reason: MarkdownDestinationIssue): MarkdownDestination {
  return Object.freeze({ kind: "invalid", reason });
}

function externalScheme(raw: string, scheme: string): MarkdownDestination {
  const normalized = scheme.toLowerCase();
  if (DANGEROUS_SCHEMES.has(normalized) || WINDOWS_DEVICE_SCHEME.test(normalized)) {
    return invalid("unsafe_scheme");
  }
  if (raw.includes("\\")) return invalid("backslash");
  if (/\s/u.test(raw)) return invalid("invalid_external");
  return EXTERNAL;
}

function protocolRelative(raw: string): MarkdownDestination {
  if (raw.includes("\\")) return invalid("backslash");
  if (raw.startsWith("///") || WINDOWS_DEVICE_PATH.test(raw)) {
    return invalid("absolute_path");
  }
  if (/\s/u.test(raw)) return invalid("invalid_external");
  const networkPath = raw.slice(2);
  const authorityEnd = networkPath.search(/[/?#]/u);
  const authority = authorityEnd === -1 ? networkPath : networkPath.slice(0, authorityEnd);
  if (authority.length === 0) return invalid("invalid_external");
  return EXTERNAL;
}

function decodedLocalPath(rawPath: string): MarkdownDestination {
  if (rawPath.startsWith("/")) return invalid("absolute_path");
  if (ENCODED_SEPARATOR.test(rawPath)) return invalid("encoded_separator");
  if (ENCODED_DELIMITER.test(rawPath)) return invalid("encoded_delimiter");

  let decoded: string;
  try {
    decoded = decodeURIComponent(rawPath);
  } catch {
    return invalid("malformed_encoding");
  }
  if (decoded.includes("%")) return invalid("ambiguous_encoding");
  if (!isUnambiguousUnicode(decoded)) return invalid("unsafe_unicode");
  if (decoded.normalize("NFC") !== decoded) return invalid("non_nfc");

  const components = decoded.split("/");
  if (components.length > MAX_SKILL_REFERENCE_PATH_COMPONENTS) {
    return invalid("too_many_components");
  }
  for (const component of components) {
    if (component.length === 0) return invalid("empty_component");
    if (component === "." || component === "..") return invalid("dot_component");
    if (Buffer.byteLength(component, "utf8") > MAX_SKILL_REFERENCE_COMPONENT_BYTES) {
      return invalid("component_too_large");
    }
    if (!isSafePathInput(component, "win32")) return invalid("nonportable_component");
  }
  const frozenComponents = Object.freeze([...components]);
  return Object.freeze({
    kind: "local",
    path: decoded,
    components: frozenComponents,
  });
}

/** Classify an inert CommonMark destination. This function never opens or fetches the target. */
export function classifyMarkdownDestination(raw: unknown): MarkdownDestination {
  if (typeof raw !== "string") return invalid("type");
  if (
    raw.length > MAX_SKILL_REFERENCE_DESTINATION_BYTES ||
    Buffer.byteLength(raw, "utf8") > MAX_SKILL_REFERENCE_DESTINATION_BYTES
  ) {
    return invalid("too_large");
  }
  if (raw.length === 0) return DOCUMENT;
  if (!isUnambiguousUnicode(raw)) return invalid("unsafe_unicode");
  if (WINDOWS_DRIVE.test(raw)) return invalid("windows_drive");
  if (raw.startsWith("#") || raw.startsWith("?")) return DOCUMENT;
  if (raw.startsWith("//")) return protocolRelative(raw);

  const scheme = URI_SCHEME.exec(raw);
  if (scheme !== null) return externalScheme(raw, scheme[1] as string);

  const fragment = raw.indexOf("#");
  const rawPath = fragment === -1 ? raw : raw.slice(0, fragment);
  if (rawPath.includes("\\")) return invalid("backslash");
  if (rawPath.includes("?")) return invalid("query");
  return decodedLocalPath(rawPath);
}
