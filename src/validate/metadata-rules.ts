import type { DiagnosticCollector } from "./diagnostics.js";
import type {
  DiagnosticLocation,
  MutableAgentSkillMetadata,
  ParsedAgentSkillFrontmatter,
  ParsedFrontmatterField,
} from "./types.js";

const MAX_COMPATIBILITY_CODE_POINTS = 500;
const MAX_RECOMMENDED_BODY_LINES = 500;

// Module initialization is the trust boundary for the intrinsics below.
const applySnapshot = Reflect.apply;
const charCodeAtSnapshot = String.prototype.charCodeAt;

function codeUnitAt(value: string, index: number): number {
  return applySnapshot(charCodeAtSnapshot, value, [index]) as number;
}

function isEcmaScriptWhitespace(codeUnit: number): boolean {
  return (
    (codeUnit >= 0x09 && codeUnit <= 0x0d) ||
    codeUnit === 0x20 ||
    codeUnit === 0xa0 ||
    codeUnit === 0x1680 ||
    (codeUnit >= 0x2000 && codeUnit <= 0x200a) ||
    codeUnit === 0x2028 ||
    codeUnit === 0x2029 ||
    codeUnit === 0x202f ||
    codeUnit === 0x205f ||
    codeUnit === 0x3000 ||
    codeUnit === 0xfeff
  );
}

function isAllowedToolsValue(value: string): boolean {
  if (value.length === 0) return false;
  let previousWasSeparator = false;
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = codeUnitAt(value, index);
    if (codeUnit === 0x20) {
      if (index === 0 || index === value.length - 1 || previousWasSeparator) return false;
      previousWasSeparator = true;
    } else {
      if (isEcmaScriptWhitespace(codeUnit)) return false;
      previousWasSeparator = false;
    }
  }
  return true;
}

function bodyExceedsRecommendedLines(body: string): boolean {
  let lines = 1;
  for (let index = 0; index < body.length; index += 1) {
    const codeUnit = codeUnitAt(body, index);
    if (codeUnit !== 0x0a && codeUnit !== 0x0d) continue;
    if (codeUnit === 0x0d && codeUnitAt(body, index + 1) === 0x0a) index += 1;
    lines += 1;
    if (lines > MAX_RECOMMENDED_BODY_LINES) return true;
  }
  return false;
}

function error(
  diagnostics: DiagnosticCollector,
  code: string,
  message: string,
  location?: DiagnosticLocation,
): void {
  diagnostics.add(code, "error", "agent-skills", message, location);
}

function optionalString(
  parsed: ParsedAgentSkillFrontmatter,
  field: string,
  diagnostics: DiagnosticCollector,
): string | undefined {
  const entry = parsed.fields.get(field);
  if (entry === undefined) return undefined;
  if (entry.value.kind !== "string") {
    const codeField = field === "allowed-tools" ? "allowed_tools" : field;
    error(diagnostics, `skill.${codeField}.type`, `${field} must be a string`, entry.location);
    return undefined;
  }
  return entry.value.value;
}

function validateOptionalStrings(
  parsed: ParsedAgentSkillFrontmatter,
  result: MutableAgentSkillMetadata,
  diagnostics: DiagnosticCollector,
): void {
  if (!parsed.fields.has("license")) {
    diagnostics.add(
      "skill.license.missing",
      "warning",
      "portable",
      "a license is recommended for publish-ready skills",
      { line: 2, column: 1 },
    );
  }
  const license = optionalString(parsed, "license", diagnostics);
  if (license !== undefined) {
    result.license = license;
    if (license.trim() === "") {
      error(
        diagnostics,
        "skill.license.empty",
        "license must not be empty",
        parsed.fields.get("license")?.location,
      );
    }
  }
  const compatibility = optionalString(parsed, "compatibility", diagnostics);
  if (compatibility !== undefined) {
    result.compatibility = compatibility;
    const length = [...compatibility].length;
    if (compatibility.trim() === "" || length > MAX_COMPATIBILITY_CODE_POINTS) {
      error(
        diagnostics,
        "skill.compatibility.length",
        "compatibility must contain 1 to 500 Unicode code points",
        parsed.fields.get("compatibility")?.location,
      );
    }
  }
  const allowedTools = optionalString(parsed, "allowed-tools", diagnostics);
  if (allowedTools !== undefined) {
    result.allowedTools = allowedTools;
    const at = parsed.fields.get("allowed-tools")?.location;
    if (!isAllowedToolsValue(allowedTools)) {
      error(
        diagnostics,
        "skill.allowed_tools.format",
        "allowed-tools must be a non-empty, single-space-delimited string",
        at,
      );
    } else {
      diagnostics.add(
        "skill.allowed_tools.experimental",
        "warning",
        "portable",
        "allowed-tools is experimental and is not supported by every Agent Skills client",
        at,
      );
    }
  }
}

function validateMetadata(
  field: ParsedFrontmatterField | undefined,
  result: MutableAgentSkillMetadata,
  diagnostics: DiagnosticCollector,
): void {
  if (field === undefined) return;
  if (field.value.kind !== "map") {
    error(
      diagnostics,
      "skill.metadata.type",
      "metadata must be a mapping of string keys to string values",
      field.location,
    );
    return;
  }
  const record: Record<string, string> = Object.create(null) as Record<string, string>;
  let valid = true;
  for (const entry of field.value.entries) {
    if (entry.key === undefined) {
      valid = false;
      error(
        diagnostics,
        "skill.metadata.key_type",
        "metadata keys must be strings",
        field.location,
      );
    } else if (entry.value === undefined) {
      valid = false;
      error(
        diagnostics,
        "skill.metadata.value_type",
        "metadata values must be strings",
        field.location,
      );
    } else record[entry.key] = entry.value;
  }
  if (valid) result.metadata = Object.freeze(record);
}

function validateBody(body: string, diagnostics: DiagnosticCollector): void {
  if (body.trim() === "") {
    diagnostics.add(
      "skill.body.empty",
      "warning",
      "agent-skills",
      "skill instructions should contain a non-empty Markdown body",
    );
  } else if (bodyExceedsRecommendedLines(body)) {
    diagnostics.add(
      "skill.body.recommended_length",
      "warning",
      "portable",
      "skill body exceeds the recommended 500 lines",
    );
  }
}

export function validateSupplementalMetadata(
  parsed: ParsedAgentSkillFrontmatter,
  result: MutableAgentSkillMetadata,
  diagnostics: DiagnosticCollector,
): void {
  validateOptionalStrings(parsed, result, diagnostics);
  validateMetadata(parsed.fields.get("metadata"), result, diagnostics);
  validateBody(parsed.body, diagnostics);
}
