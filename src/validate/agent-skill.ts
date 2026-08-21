import { basename } from "node:path";
import { types } from "node:util";

import { isSafePathInput } from "../path-safety.js";
import { DiagnosticCollector } from "./diagnostics.js";
import { parseAgentSkillFrontmatter } from "./frontmatter.js";
import {
  buildInspectedMarkdownResourceGraph,
  isGenuineBundledResourceNameFindings,
  isGenuineMarkdownResourcePlaceholderFindings,
  type BundledResourceNameFinding,
  type MarkdownResourceGraph,
  type MarkdownResourcePlaceholderFinding,
} from "./markdown-resource-graph.js";
import {
  addBundledResourceNameFindingDiagnostics,
  addMarkdownResourceGraphFailureDiagnostic,
  addMarkdownResourceGraphFindingDiagnostics,
  addMarkdownResourcePlaceholderFindingDiagnostics,
} from "./markdown-resource-diagnostics.js";
import { validateSupplementalMetadata } from "./metadata-rules.js";
import {
  classifySemanticTextPlaceholder,
  isGenuineSemanticTextPlaceholderClassification,
} from "./semantic-text-placeholder.js";
import { inspectAgentSkillDocument } from "./skill-document.js";
import { inspectAgentSkillRoot } from "./skill-root.js";
import type {
  AgentSkillMetadata,
  AgentSkillValidationOptions,
  AgentSkillValidationReport,
  DiagnosticLocation,
  MutableAgentSkillMetadata,
  ParsedAgentSkillFrontmatter,
} from "./types.js";

const MAX_NAME_CODE_POINTS = 64;
const MAX_DESCRIPTION_CODE_POINTS = 1024;
const basenameSnapshot = basename;
const buildGraphSnapshot = buildInspectedMarkdownResourceGraph;
const inspectDocumentSnapshot = inspectAgentSkillDocument;
const inspectRootSnapshot = inspectAgentSkillRoot;
const genuineResourceFindingsSnapshot = isGenuineBundledResourceNameFindings;
const genuinePlaceholderFindingsSnapshot = isGenuineMarkdownResourcePlaceholderFindings;
const classifyPlaceholderSnapshot = classifySemanticTextPlaceholder;
const genuineClassificationSnapshot = isGenuineSemanticTextPlaceholderClassification;
const applySnapshot = Reflect.apply;
const charCodeAtSnapshot = String.prototype.charCodeAt;
const isProxySnapshot = types.isProxy;
const objectGetOwnPropertyDescriptorSnapshot = Object.getOwnPropertyDescriptor;
const ABSENT = Symbol("absent");
const INVALID_FIELD = Symbol("invalid");

function applyIntrinsic<T>(intrinsic: (...args: never[]) => unknown, args: unknown[]): T {
  return applySnapshot(intrinsic, undefined, args) as T;
}

function portableName(value: string): boolean {
  let needsUnit = true;
  for (let index = 0; index < value.length; index += 1) {
    const code = applySnapshot(charCodeAtSnapshot, value, [index]) as number;
    if ((code >= 97 && code <= 122) || (code >= 48 && code <= 57)) {
      needsUnit = false;
    } else if (code === 45 && !needsUnit) {
      needsUnit = true;
    } else {
      return false;
    }
  }
  return !needsUnit;
}

function isRecord(value: unknown): value is object {
  if (typeof value !== "object" || value === null) return false;
  try {
    return applyIntrinsic<boolean>(isProxySnapshot, [value]) === false;
  } catch {
    return false;
  }
}

function ownData(value: object, key: PropertyKey): unknown {
  try {
    const descriptor = applyIntrinsic<PropertyDescriptor | undefined>(
      objectGetOwnPropertyDescriptorSnapshot,
      [value, key],
    );
    if (descriptor === undefined) return ABSENT;
    const data = applyIntrinsic<PropertyDescriptor | undefined>(
      objectGetOwnPropertyDescriptorSnapshot,
      [descriptor, "value"],
    );
    return data === undefined ? INVALID_FIELD : data.value;
  } catch {
    return INVALID_FIELD;
  }
}

function error(
  diagnostics: DiagnosticCollector,
  code: string,
  message: string,
  location?: DiagnosticLocation,
  scope: "agent-skills" | "portable" | "skillpress" = "agent-skills",
): void {
  diagnostics.add(code, "error", scope, message, location);
}

function warning(
  diagnostics: DiagnosticCollector,
  code: string,
  message: string,
  location?: DiagnosticLocation,
  scope: "agent-skills" | "portable" | "anthropic" = "agent-skills",
): void {
  diagnostics.add(code, "warning", scope, message, location);
}

function requiredString(
  parsed: ParsedAgentSkillFrontmatter,
  field: string,
  diagnostics: DiagnosticCollector,
): string | undefined {
  const entry = parsed.fields.get(field);
  if (entry === undefined) {
    error(diagnostics, `skill.${field}.required`, `${field} is required`, {
      line: 2,
      column: 1,
    });
    return undefined;
  }
  if (entry.value.kind !== "string") {
    const codeField = field === "allowed-tools" ? "allowed_tools" : field;
    error(diagnostics, `skill.${codeField}.type`, `${field} must be a string`, entry.location);
    return undefined;
  }
  return entry.value.value;
}

function validateName(
  parsed: ParsedAgentSkillFrontmatter,
  directoryName: string,
  expectedName: string | undefined,
  result: MutableAgentSkillMetadata,
  diagnostics: DiagnosticCollector,
): void {
  const name = requiredString(parsed, "name", diagnostics);
  if (name === undefined) return;
  result.name = name;
  const at = parsed.fields.get("name")?.location;
  const length = [...name].length;
  if (length < 1 || length > MAX_NAME_CODE_POINTS) {
    error(diagnostics, "skill.name.length", "name must contain 1 to 64 Unicode code points", at);
  }
  if (!portableName(name)) {
    error(
      diagnostics,
      "skill.name.portable_format",
      "name must contain lowercase ASCII letters, digits, and single hyphens",
      at,
      "portable",
    );
  }
  if (name !== directoryName) {
    error(
      diagnostics,
      "skill.name.directory_mismatch",
      "name must exactly match the skill directory name",
      at,
    );
  }
  if (expectedName !== undefined && name !== expectedName) {
    error(
      diagnostics,
      "skill.name.project_mismatch",
      "name must exactly match the project-configured skill name",
      at,
      "skillpress",
    );
  }
  if (name.includes("claude") || name.includes("anthropic")) {
    warning(
      diagnostics,
      "skill.target.anthropic.reserved_name",
      "Anthropic product names in skill names may reduce portability",
      at,
      "anthropic",
    );
  }
}

function validateDescription(
  parsed: ParsedAgentSkillFrontmatter,
  result: MutableAgentSkillMetadata,
  diagnostics: DiagnosticCollector,
): void {
  const description = requiredString(parsed, "description", diagnostics);
  if (description === undefined) return;
  result.description = description;
  const at = parsed.fields.get("description")?.location;
  if (description.trim() === "") {
    error(diagnostics, "skill.description.required", "description must not be empty", at);
  } else if ([...description].length > MAX_DESCRIPTION_CODE_POINTS) {
    error(
      diagnostics,
      "skill.description.length",
      "description must not exceed 1024 Unicode code points",
      at,
    );
  }
  if (description.includes("<") || description.includes(">")) {
    warning(
      diagnostics,
      "skill.target.anthropic.xml_description",
      "angle brackets in descriptions may be interpreted as XML by Anthropic clients",
      at,
      "anthropic",
    );
  }
}

function validateFields(
  parsed: ParsedAgentSkillFrontmatter,
  directoryName: string,
  expectedName: string | undefined,
  diagnostics: DiagnosticCollector,
): AgentSkillMetadata | undefined {
  const result: MutableAgentSkillMetadata = {};
  validateName(parsed, directoryName, expectedName, result, diagnostics);
  validateDescription(parsed, result, diagnostics);
  validateSupplementalMetadata(parsed, result, diagnostics);
  if (result.name === undefined || result.description === undefined) return undefined;
  return Object.freeze(result) as AgentSkillMetadata;
}

function readExpectedName(options: AgentSkillValidationOptions | undefined): string | undefined {
  if (options === undefined) return undefined;
  let value: unknown;
  try {
    if (options === null || typeof options !== "object" || Array.isArray(options)) {
      throw new TypeError("invalid options");
    }
    value = options.expectedName;
  } catch {
    throw new TypeError("Agent Skill validation options must be inert data.");
  }
  if (
    value !== undefined &&
    (typeof value !== "string" || value.length > MAX_NAME_CODE_POINTS || !portableName(value))
  ) {
    throw new TypeError("expectedName must be a portable Agent Skill name when provided.");
  }
  return value;
}

function ownGraph(value: object): MarkdownResourceGraph | undefined {
  const descriptor = objectGetOwnPropertyDescriptorSnapshot(value, "graph");
  if (descriptor === undefined) return undefined;
  const valueDescriptor = objectGetOwnPropertyDescriptorSnapshot(descriptor, "value");
  return valueDescriptor?.value as MarkdownResourceGraph | undefined;
}

function ownFindingInventory<T>(
  value: object,
  property: string,
  predicate: (candidate: unknown) => boolean,
): readonly T[] | undefined {
  try {
    const descriptor = objectGetOwnPropertyDescriptorSnapshot(value, property);
    if (descriptor === undefined) return undefined;
    const valueDescriptor = objectGetOwnPropertyDescriptorSnapshot(descriptor, "value");
    const findings = valueDescriptor?.value;
    return predicate(findings) === true ? (findings as readonly T[]) : undefined;
  } catch {
    return undefined;
  }
}

function classifyFrontmatterSemanticText(value: string): "safe" | "placeholder" | "failure" {
  let classification: unknown;
  try {
    classification = applyIntrinsic(classifyPlaceholderSnapshot, [value]);
    if (applyIntrinsic(genuineClassificationSnapshot, [classification]) !== true) return "failure";
  } catch {
    return "failure";
  }
  if (!isRecord(classification)) return "failure";
  const ok = ownData(classification, "ok");
  const reason = ownData(classification, "reason");
  if (ok === true && reason === ABSENT) return "safe";
  return ok === false && reason === "placeholder" ? "placeholder" : "failure";
}

function scanFrontmatterPlaceholders(parsed: ParsedAgentSkillFrontmatter | undefined) {
  const descriptionEntry = parsed?.fields.get("description");
  const compatibilityEntry = parsed?.fields.get("compatibility");
  const description =
    descriptionEntry?.value.kind === "string"
      ? ([descriptionEntry.value.value, descriptionEntry.location] as const)
      : undefined;
  const compatibility =
    compatibilityEntry?.value.kind === "string"
      ? ([compatibilityEntry.value.value, compatibilityEntry.location] as const)
      : undefined;
  let descriptionFinding: DiagnosticLocation | undefined;
  let compatibilityFinding: DiagnosticLocation | undefined;
  if (description !== undefined) {
    const result = classifyFrontmatterSemanticText(description[0]);
    if (result === "failure") {
      return [description[1], undefined, undefined];
    }
    if (result === "placeholder") descriptionFinding = description[1];
  }
  if (compatibility !== undefined) {
    const result = classifyFrontmatterSemanticText(compatibility[0]);
    if (result === "failure") {
      return [compatibility[1], undefined, undefined];
    }
    if (result === "placeholder") compatibilityFinding = compatibility[1];
  }
  return [undefined, descriptionFinding, compatibilityFinding];
}

function addFrontmatterPlaceholderDiagnostic(
  diagnostics: DiagnosticCollector,
  location: DiagnosticLocation,
  failure = false,
): void {
  error(
    diagnostics,
    failure ? "skill.frontmatter.placeholder_analysis" : "skill.frontmatter.placeholder",
    failure
      ? "frontmatter semantic text could not be analyzed safely"
      : "frontmatter semantic text must not contain placeholders",
    location,
    "skillpress",
  );
}

/**
 * Validate one canonical Agent Skill without executing its instructions or fetching external URLs.
 * Throws TypeError only for malformed API arguments; skill findings are returned as diagnostics.
 */
export async function validateAgentSkill(
  skillDirectory: string,
  options?: AgentSkillValidationOptions,
): Promise<AgentSkillValidationReport> {
  if (!isSafePathInput(skillDirectory)) {
    throw new TypeError("skillDirectory must be a bounded, unambiguous filesystem path.");
  }
  const expectedName = readExpectedName(options);
  const diagnostics = new DiagnosticCollector();
  const root = await inspectRootSnapshot(skillDirectory, diagnostics);
  if (root === undefined) return diagnostics.finish();
  const document = await inspectDocumentSnapshot(root, diagnostics);
  if (document === undefined) return diagnostics.finish();
  const directoryName = basenameSnapshot(root.canonicalPath);
  const graphed = await buildGraphSnapshot(document);
  if (!graphed.ok) {
    addMarkdownResourceGraphFailureDiagnostic(diagnostics, graphed.reason);
    return diagnostics.finish();
  }
  const parsed = parseAgentSkillFrontmatter(graphed.documentText, diagnostics);
  const metadata =
    parsed === undefined
      ? undefined
      : validateFields(parsed, directoryName, expectedName, diagnostics);
  const resourceFindings = ownFindingInventory<BundledResourceNameFinding>(
    graphed,
    "resourceFindings",
    genuineResourceFindingsSnapshot,
  );
  if (resourceFindings === undefined) {
    addMarkdownResourceGraphFailureDiagnostic(diagnostics, "inconsistent");
    return diagnostics.finish(metadata);
  }
  const placeholderFindings = ownFindingInventory<MarkdownResourcePlaceholderFinding>(
    graphed,
    "placeholderFindings",
    genuinePlaceholderFindingsSnapshot,
  );
  if (placeholderFindings === undefined) {
    addMarkdownResourceGraphFailureDiagnostic(diagnostics, "inconsistent");
    return diagnostics.finish(metadata);
  }
  const frontmatterPlaceholders = scanFrontmatterPlaceholders(parsed);
  addBundledResourceNameFindingDiagnostics(diagnostics, resourceFindings);
  if (frontmatterPlaceholders[0] !== undefined) {
    addFrontmatterPlaceholderDiagnostic(diagnostics, frontmatterPlaceholders[0], true);
  } else {
    if (frontmatterPlaceholders[1] !== undefined)
      addFrontmatterPlaceholderDiagnostic(diagnostics, frontmatterPlaceholders[1]);
    if (frontmatterPlaceholders[2] !== undefined)
      addFrontmatterPlaceholderDiagnostic(diagnostics, frontmatterPlaceholders[2]);
  }
  addMarkdownResourcePlaceholderFindingDiagnostics(diagnostics, placeholderFindings);
  const graph = ownGraph(graphed);
  if (graph !== undefined) addMarkdownResourceGraphFindingDiagnostics(diagnostics, graph);
  return diagnostics.finish(metadata);
}
