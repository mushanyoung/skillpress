import { Buffer } from "node:buffer";
import { types } from "node:util";

import type { Root } from "mdast";
import { fromMarkdown } from "mdast-util-from-markdown";

export const MAX_SKILL_MARKDOWN_AST_NODES = 20_000;
export const MAX_SKILL_MARKDOWN_AST_SCALAR_CODE_UNITS = 8 * 1024 * 1024;
export const MAX_SKILL_MARKDOWN_DEFINITIONS_PER_FILE = 1_024;
export const MAX_SKILL_MARKDOWN_TARGETS_PER_FILE = 1_024;
export const MAX_SKILL_MARKDOWN_SOURCE_BYTES = 512 * 1024;
export const MAX_SKILL_MARKDOWN_SYNTAX_MARKERS = 8_192;
const MDAST_NODE_TYPES =
  "|root|blockquote|break|code|definition|delete|emphasis|footnoteDefinition|footnoteReference|heading|html|image|imageReference|inlineCode|link|linkReference|list|listItem|paragraph|strong|table|tableCell|tableRow|text|thematicBreak|yaml|";
const MDAST_CONTAINER_TYPES =
  "|root|blockquote|delete|emphasis|footnoteDefinition|heading|link|linkReference|list|listItem|paragraph|strong|table|tableCell|tableRow|";

export interface MarkdownLocation {
  readonly line: number;
  readonly column: number;
}

export interface MarkdownTarget {
  readonly kind: "link" | "image";
  readonly form: "inline" | "reference";
  readonly url: string;
  readonly location: MarkdownLocation;
  readonly destinationLocation: MarkdownLocation;
  readonly referenceType?: "collapsed" | "full" | "shortcut";
  readonly definition?: MarkdownDefinition;
}

export interface MarkdownHeading {
  readonly depth: 1 | 2 | 3 | 4 | 5 | 6;
  readonly text: string;
  readonly location: MarkdownLocation;
}

export interface MarkdownDefinition {
  readonly identifier: string;
  readonly url: string;
  readonly location: MarkdownLocation;
}

export interface MarkdownAnalysisIssue {
  readonly code:
    | "skill.markdown.complexity"
    | "skill.markdown.duplicate_definition"
    | "skill.markdown.parse"
    | "skill.markdown.too_many_definitions"
    | "skill.markdown.too_large"
    | "skill.markdown.too_many_targets";
  readonly message: string;
  readonly location?: MarkdownLocation;
}

export interface MarkdownAnalysis {
  readonly nodeCount: number;
  readonly lineCount: number;
  readonly targets: readonly MarkdownTarget[];
  readonly headings: readonly MarkdownHeading[];
  readonly definitions: readonly MarkdownDefinition[];
  readonly unusedDefinitions: readonly MarkdownDefinition[];
  readonly issues: readonly MarkdownAnalysisIssue[];
}

type ParseMarkdown = (source: string) => Root;
type NodeType =
  | "root"
  | "blockquote"
  | "break"
  | "code"
  | "definition"
  | "delete"
  | "emphasis"
  | "footnoteDefinition"
  | "footnoteReference"
  | "heading"
  | "html"
  | "image"
  | "imageReference"
  | "inlineCode"
  | "link"
  | "linkReference"
  | "list"
  | "listItem"
  | "paragraph"
  | "strong"
  | "table"
  | "tableCell"
  | "tableRow"
  | "text"
  | "thematicBreak"
  | "yaml";
type ReferenceType = "collapsed" | "full" | "shortcut";
type FailureKind = "parse" | "node_complexity" | "scalar_complexity";
type ProjectionFailure = Readonly<{
  kind: FailureKind;
  location: MarkdownLocation | undefined;
}>;

interface AnalysisBudget {
  scalarCodeUnits: number;
  scheduledNodeOccurrences: number;
  headingProjectedOccurrences: number;
}

interface ProjectedNode {
  type: NodeType;
  location: MarkdownLocation;
  children: unknown[] | undefined;
  url: string | undefined;
  identifier: string | undefined;
  referenceType: ReferenceType | undefined;
  depth: 1 | 2 | 3 | 4 | 5 | 6 | undefined;
}

interface PendingTarget {
  readonly form: "inline" | "reference";
  readonly kind: "link" | "image";
  readonly location: MarkdownLocation;
  readonly url?: string;
  readonly identifier?: string;
  readonly referenceType?: ReferenceType;
}

type NodeProjectionResult = ProjectedNode | ProjectionFailure;
type HeadingProjectionResult = string | ProjectionFailure;

// Module initialization is the trust boundary for the projection intrinsics below.
const defaultParserSnapshot = fromMarkdown;
const applySnapshot = Reflect.apply;
const bufferByteLengthSnapshot = Buffer.byteLength;
const bufferConstructorSnapshot = Buffer;
const objectConstructorSnapshot = Object;
const objectPrototypeSnapshot = Object.prototype;
const definePropertySnapshot = Object.defineProperty;
const freezeSnapshot = Object.freeze;
const getOwnPropertyDescriptorSnapshot = Object.getOwnPropertyDescriptor;
const getPrototypeOfSnapshot = Object.getPrototypeOf;
const objectIsSnapshot = Object.is;
const arrayConstructorSnapshot = Array;
const arrayPrototypeSnapshot = Array.prototype;
const arrayIsArraySnapshot = Array.isArray;
const arrayJoinSnapshot = Array.prototype.join;
const numberConstructorSnapshot = Number;
const numberIsSafeIntegerSnapshot = Number.isSafeInteger;
const mapConstructorSnapshot = Map;
const mapGetSnapshot = Map.prototype.get;
const mapHasSnapshot = Map.prototype.has;
const mapSetSnapshot = Map.prototype.set;
const setConstructorSnapshot = Set;
const setAddSnapshot = Set.prototype.add;
const setHasSnapshot = Set.prototype.has;
const weakSetConstructorSnapshot = WeakSet;
const weakSetAddSnapshot = WeakSet.prototype.add;
const weakSetHasSnapshot = WeakSet.prototype.has;
const charCodeAtSnapshot = String.prototype.charCodeAt;
const indexOfSnapshot = String.prototype.indexOf;
const isProxySnapshot = types.isProxy;
const analysisBrands = new weakSetConstructorSnapshot<object>();

type Intrinsic = (...args: never[]) => unknown;
function applyIntrinsic<T>(intrinsic: Intrinsic, receiver: unknown, args: unknown[]): T {
  return applySnapshot(intrinsic, receiver, args) as T;
}

function freeze<T extends object>(value: T): Readonly<T> {
  return applyIntrinsic<Readonly<T>>(freezeSnapshot, objectConstructorSnapshot, [value]);
}

function defineSlot<T>(values: T[], index: number, value: T): void {
  applyIntrinsic(definePropertySnapshot, objectConstructorSnapshot, [
    values,
    index,
    { __proto__: null, configurable: true, enumerable: true, value, writable: true },
  ]);
}

function append<T>(values: T[], value: T): void {
  defineSlot(values, values.length, value);
}

function frozenCopy<T>(values: readonly T[]): readonly T[] {
  const copy = new arrayConstructorSnapshot<T>();
  for (let index = 0; index < values.length; index += 1)
    defineSlot(copy, index, values[index] as T);
  return freeze(copy);
}

const ABSENT = freeze({ kind: "absent" } as const);
const INVALID_FIELD = freeze({ kind: "invalid" } as const);
const PARSE_FAILURE = freeze({ kind: "parse", location: undefined } as const);
const NODE_COMPLEXITY = freeze({ kind: "node_complexity", location: undefined } as const);
const SCALAR_COMPLEXITY = freeze({ kind: "scalar_complexity", location: undefined } as const);
type FieldFailure = typeof INVALID_FIELD | typeof SCALAR_COMPLEXITY;

function ownData(value: object, key: PropertyKey): unknown | typeof ABSENT | typeof INVALID_FIELD {
  try {
    const descriptor = applyIntrinsic<PropertyDescriptor | undefined>(
      getOwnPropertyDescriptorSnapshot,
      objectConstructorSnapshot,
      [value, key],
    );
    if (descriptor === undefined) return ABSENT;
    const data = applyIntrinsic<PropertyDescriptor | undefined>(
      getOwnPropertyDescriptorSnapshot,
      objectConstructorSnapshot,
      [descriptor, "value"],
    );
    return data === undefined ? INVALID_FIELD : descriptor.value;
  } catch {
    return INVALID_FIELD;
  }
}

function isCurrentPlainRecord(value: unknown): value is Record<PropertyKey, unknown> {
  if (value === null || typeof value !== "object") return false;
  try {
    if (applyIntrinsic<boolean>(isProxySnapshot, undefined, [value])) return false;
    return (
      applyIntrinsic<object | null>(getPrototypeOfSnapshot, objectConstructorSnapshot, [value]) ===
      objectPrototypeSnapshot
    );
  } catch {
    return false;
  }
}

function isSafeInteger(value: unknown): value is number {
  return (
    typeof value === "number" &&
    applyIntrinsic<boolean>(numberIsSafeIntegerSnapshot, numberConstructorSnapshot, [value]) &&
    !applyIntrinsic<boolean>(objectIsSnapshot, objectConstructorSnapshot, [value, -0])
  );
}

function arrayLength(value: unknown): number | typeof INVALID_FIELD {
  if (value === null || typeof value !== "object") return INVALID_FIELD;
  try {
    if (applyIntrinsic<boolean>(isProxySnapshot, undefined, [value])) return INVALID_FIELD;
    if (
      !applyIntrinsic<boolean>(arrayIsArraySnapshot, arrayConstructorSnapshot, [value]) ||
      applyIntrinsic<object | null>(getPrototypeOfSnapshot, objectConstructorSnapshot, [value]) !==
        arrayPrototypeSnapshot
    ) {
      return INVALID_FIELD;
    }
  } catch {
    return INVALID_FIELD;
  }
  const length = ownData(value, "length");
  return isSafeInteger(length) && length >= 0 ? length : INVALID_FIELD;
}

function charCodeAt(value: string, index: number): number {
  return applyIntrinsic<number>(charCodeAtSnapshot, value, [index]);
}

function byteLength(value: string): number {
  return applyIntrinsic<number>(bufferByteLengthSnapshot, bufferConstructorSnapshot, [
    value,
    "utf8",
  ]);
}

function lineCount(value: string): number {
  if (value.length === 0) return 0;
  let lines = 1;
  for (let index = 0; index < value.length; index += 1) {
    const code = charCodeAt(value, index);
    if (code === 0x0a) lines += 1;
    else if (code === 0x0d) {
      lines += 1;
      if (charCodeAt(value, index + 1) === 0x0a) index += 1;
    }
  }
  return lines;
}

function exceedsSyntaxBudget(source: string): boolean {
  let markers = 0;
  for (let index = 0; index < source.length; index += 1) {
    const code = charCodeAt(source, index);
    if (code === 0x0a) markers += 1;
    else if (code === 0x0d) {
      markers += 1;
      if (charCodeAt(source, index + 1) === 0x0a) index += 1;
    } else {
      if (
        (code >= 0x21 && code <= 0x2f) ||
        (code >= 0x3a && code <= 0x40) ||
        (code >= 0x5b && code <= 0x60) ||
        (code >= 0x7b && code <= 0x7e)
      ) {
        markers += 1;
      }
    }
    if (markers > MAX_SKILL_MARKDOWN_SYNTAX_MARKERS) return true;
  }
  return false;
}

function listed(values: string, value: string): boolean {
  return (
    applyIntrinsic<number>(indexOfSnapshot, value, ["|"]) < 0 &&
    applyIntrinsic<number>(indexOfSnapshot, values, [`|${value}|`]) >= 0
  );
}

function isNodeType(value: string): value is NodeType {
  return listed(MDAST_NODE_TYPES, value);
}

function isContainerType(type: NodeType): boolean {
  return listed(MDAST_CONTAINER_TYPES, type);
}

function scalar(value: unknown, budget: AnalysisBudget): string | FieldFailure {
  if (typeof value !== "string") return INVALID_FIELD;
  if (
    value.length > MAX_SKILL_MARKDOWN_SOURCE_BYTES ||
    value.length > MAX_SKILL_MARKDOWN_AST_SCALAR_CODE_UNITS - budget.scalarCodeUnits
  ) {
    return SCALAR_COMPLEXITY;
  }
  budget.scalarCodeUnits += value.length;
  return value;
}

function scalarField(
  value: Record<PropertyKey, unknown>,
  key: PropertyKey,
  budget: AnalysisBudget,
): string | FieldFailure {
  const field = ownData(value, key);
  return field === ABSENT || field === INVALID_FIELD ? INVALID_FIELD : scalar(field, budget);
}

function locationOf(
  value: Record<PropertyKey, unknown>,
  maxCoordinate: number,
): MarkdownLocation | undefined {
  const position = ownData(value, "position");
  if (position === ABSENT || position === undefined) return freeze({ line: 1, column: 1 });
  if (position === INVALID_FIELD || !isCurrentPlainRecord(position)) return undefined;
  const start = ownData(position, "start");
  if (start === ABSENT || start === INVALID_FIELD || !isCurrentPlainRecord(start)) {
    return undefined;
  }
  const line = ownData(start, "line");
  const column = ownData(start, "column");
  return isSafeInteger(line) &&
    line > 0 &&
    line <= maxCoordinate &&
    isSafeInteger(column) &&
    column > 0 &&
    column <= maxCoordinate
    ? freeze({ line, column })
    : undefined;
}

function copyChildren(
  value: unknown,
  budget: AnalysisBudget,
  counter: "main" | "heading",
): unknown[] | ProjectionFailure {
  const length = arrayLength(value);
  if (typeof length !== "number") return PARSE_FAILURE;
  const current =
    counter === "main" ? budget.scheduledNodeOccurrences : budget.headingProjectedOccurrences;
  if (length > MAX_SKILL_MARKDOWN_AST_NODES - current) return NODE_COMPLEXITY;
  if (counter === "main") budget.scheduledNodeOccurrences += length;
  else budget.headingProjectedOccurrences += length;
  const copy = new arrayConstructorSnapshot<unknown>();
  for (let index = 0; index < length; index += 1) {
    const child = ownData(value as object, index);
    if (child === ABSENT || child === INVALID_FIELD || !isCurrentPlainRecord(child)) {
      return PARSE_FAILURE;
    }
    defineSlot(copy, index, child);
  }
  return copy;
}

function childrenOf(
  value: Record<PropertyKey, unknown>,
  type: NodeType,
  budget: AnalysisBudget,
  counter: "main" | "heading",
): unknown[] | typeof ABSENT | ProjectionFailure {
  const children = ownData(value, "children");
  if (children === ABSENT) return isContainerType(type) ? PARSE_FAILURE : ABSENT;
  if (children === INVALID_FIELD) return PARSE_FAILURE;
  return copyChildren(children, budget, counter);
}

function withLocation(
  failure: ProjectionFailure | FieldFailure,
  location: MarkdownLocation,
): ProjectionFailure {
  if (failure.kind === "node_complexity") return freeze({ kind: failure.kind, location });
  if (failure.kind === "scalar_complexity") return freeze({ kind: failure.kind, location });
  return PARSE_FAILURE;
}

function normalizeFieldFailure(failure: FieldFailure): ProjectionFailure {
  return failure.kind === "scalar_complexity" ? SCALAR_COMPLEXITY : PARSE_FAILURE;
}

function isProjectionFailure(value: ProjectedNode | ProjectionFailure): value is ProjectionFailure {
  const kind = ownData(value, "kind");
  return kind === "parse" || kind === "node_complexity" || kind === "scalar_complexity";
}

function readMainFields(
  value: Record<PropertyKey, unknown>,
  node: ProjectedNode,
  budget: AnalysisBudget,
): ProjectionFailure | undefined {
  let field: string | FieldFailure;
  if (node.type === "definition") {
    field = scalarField(value, "identifier", budget);
    if (typeof field !== "string") return withLocation(field, node.location);
    node.identifier = field;
    field = scalarField(value, "url", budget);
    if (typeof field !== "string") return withLocation(field, node.location);
    node.url = field;
  } else if (node.type === "link" || node.type === "image") {
    field = scalarField(value, "url", budget);
    if (typeof field !== "string") return withLocation(field, node.location);
    node.url = field;
  } else if (node.type === "linkReference" || node.type === "imageReference") {
    field = scalarField(value, "identifier", budget);
    if (typeof field !== "string") return withLocation(field, node.location);
    node.identifier = field;
    field = scalarField(value, "referenceType", budget);
    if (field === SCALAR_COMPLEXITY) return withLocation(field, node.location);
    if (field !== "collapsed" && field !== "full" && field !== "shortcut") return PARSE_FAILURE;
    node.referenceType = field;
  } else if (node.type === "heading") {
    const depth = ownData(value, "depth");
    if (!isSafeInteger(depth) || depth < 1 || depth > 6) return PARSE_FAILURE;
    node.depth = depth as 1 | 2 | 3 | 4 | 5 | 6;
  }
  return undefined;
}

function projectNode(
  value: unknown,
  budget: AnalysisBudget,
  initial: boolean,
  maxCoordinate: number,
): NodeProjectionResult {
  if (!isCurrentPlainRecord(value)) return PARSE_FAILURE;
  const type = scalarField(value, "type", budget);
  if (typeof type !== "string") return normalizeFieldFailure(type);
  if (!isNodeType(type) || (type === "root") !== initial) {
    return PARSE_FAILURE;
  }
  const location = locationOf(value, maxCoordinate);
  if (location === undefined) return PARSE_FAILURE;
  const node: ProjectedNode = {
    type,
    location,
    children: undefined,
    url: undefined,
    identifier: undefined,
    referenceType: undefined,
    depth: undefined,
  };
  const fieldFailure = readMainFields(value, node, budget);
  if (fieldFailure !== undefined) return fieldFailure;
  const children = childrenOf(value, type, budget, "main");
  if (children === PARSE_FAILURE || children === NODE_COMPLEXITY) {
    return withLocation(children, location);
  }
  if (children !== ABSENT) node.children = children as unknown[];
  return node;
}

function headingAlt(
  value: Record<PropertyKey, unknown>,
  budget: AnalysisBudget,
): string | ProjectionFailure {
  const alt = ownData(value, "alt");
  if (alt === ABSENT || alt === undefined || alt === null) return "";
  if (alt === INVALID_FIELD) return PARSE_FAILURE;
  const projected = scalar(alt, budget);
  return typeof projected === "string" ? projected : normalizeFieldFailure(projected);
}

function projectHeadingText(
  initialChildren: readonly unknown[],
  budget: AnalysisBudget,
): HeadingProjectionResult {
  if (initialChildren.length > MAX_SKILL_MARKDOWN_AST_NODES - budget.headingProjectedOccurrences) {
    return NODE_COMPLEXITY;
  }
  budget.headingProjectedOccurrences += initialChildren.length;
  const stack = new arrayConstructorSnapshot<unknown>();
  let stackLength = 0;
  for (let index = initialChildren.length - 1; index >= 0; index -= 1) {
    defineSlot(stack, stackLength, initialChildren[index]);
    stackLength += 1;
  }
  const fragments = new arrayConstructorSnapshot<string>();
  while (stackLength > 0) {
    stackLength -= 1;
    const value = stack[stackLength];
    if (!isCurrentPlainRecord(value)) return PARSE_FAILURE;
    const type = scalarField(value, "type", budget);
    if (typeof type !== "string") return normalizeFieldFailure(type);
    if (!isNodeType(type) || type === "root") {
      return PARSE_FAILURE;
    }
    if (type === "text" || type === "inlineCode") {
      const text = scalarField(value, "value", budget);
      if (typeof text !== "string") return normalizeFieldFailure(text);
      append(fragments, text);
    } else if (type === "image" || type === "imageReference") {
      const alt = headingAlt(value, budget);
      if (typeof alt !== "string") return alt;
      append(fragments, alt);
    } else if (type === "break") append(fragments, " ");
    if (
      type === "text" ||
      type === "inlineCode" ||
      type === "image" ||
      type === "imageReference" ||
      type === "html" ||
      type === "break"
    ) {
      continue;
    }
    const children = childrenOf(value, type, budget, "heading");
    if (children === PARSE_FAILURE || children === NODE_COMPLEXITY) {
      return children;
    }
    if (children !== ABSENT) {
      const nested = children as unknown[];
      for (let index = nested.length - 1; index >= 0; index -= 1) {
        defineSlot(stack, stackLength, nested[index]);
        stackLength += 1;
      }
    }
  }
  return applyIntrinsic<string>(arrayJoinSnapshot, fragments, [""]);
}

function issue(
  code: MarkdownAnalysisIssue["code"],
  message: string,
  location?: MarkdownLocation,
): MarkdownAnalysisIssue {
  return location === undefined ? freeze({ code, message }) : freeze({ code, message, location });
}

function registerResult(
  source: string,
  targets: readonly MarkdownTarget[],
  headings: readonly MarkdownHeading[],
  definitions: readonly MarkdownDefinition[],
  unusedDefinitions: readonly MarkdownDefinition[],
  issues: readonly MarkdownAnalysisIssue[],
  countSourceLines = true,
  nodeCount = 0,
): MarkdownAnalysis {
  const analysis = freeze({
    nodeCount,
    lineCount: countSourceLines ? lineCount(source) : 0,
    targets: frozenCopy(targets),
    headings: frozenCopy(headings),
    definitions: frozenCopy(definitions),
    unusedDefinitions: frozenCopy(unusedDefinitions),
    issues: frozenCopy(issues),
  });
  applyIntrinsic(weakSetAddSnapshot, analysisBrands, [analysis]);
  return analysis;
}

function failureResult(
  source: string,
  code: MarkdownAnalysisIssue["code"],
  message: string,
  location?: MarkdownLocation,
  countSourceLines = true,
): MarkdownAnalysis {
  return registerResult(source, [], [], [], [], [issue(code, message, location)], countSourceLines);
}

function projectionFailureResult(source: string, failure: ProjectionFailure): MarkdownAnalysis {
  if (failure.kind === "parse") {
    return failureResult(source, "skill.markdown.parse", "Markdown could not be parsed safely");
  }
  return failureResult(
    source,
    "skill.markdown.complexity",
    failure.kind === "node_complexity"
      ? `Markdown node count exceeds ${MAX_SKILL_MARKDOWN_AST_NODES}`
      : `Markdown AST scalar text exceeds ${MAX_SKILL_MARKDOWN_AST_SCALAR_CODE_UNITS} UTF-16 code units`,
    failure.location,
  );
}

/** Property-free identity check for analyses produced by this module instance. */
export function isGenuineMarkdownAnalysis(value: unknown): value is MarkdownAnalysis {
  if (value === null || typeof value !== "object") return false;
  try {
    return applyIntrinsic<boolean>(weakSetHasSnapshot, analysisBrands, [value]);
  } catch {
    return false;
  }
}

/** Parse CommonMark into a bounded inert summary. No target is opened or fetched. */
export function analyzeMarkdown(
  source: string,
  parseMarkdown: ParseMarkdown = defaultParserSnapshot,
): MarkdownAnalysis {
  if (typeof source !== "string") {
    return failureResult("", "skill.markdown.parse", "Markdown could not be parsed safely");
  }
  if (
    source.length > MAX_SKILL_MARKDOWN_SOURCE_BYTES ||
    byteLength(source) > MAX_SKILL_MARKDOWN_SOURCE_BYTES
  ) {
    return failureResult(
      source,
      "skill.markdown.too_large",
      `Markdown exceeds ${MAX_SKILL_MARKDOWN_SOURCE_BYTES} bytes`,
      undefined,
      false,
    );
  }
  if (exceedsSyntaxBudget(source)) {
    return failureResult(
      source,
      "skill.markdown.complexity",
      `Markdown syntax exceeds ${MAX_SKILL_MARKDOWN_SYNTAX_MARKERS} markers`,
    );
  }
  let root: unknown;
  try {
    root = applyIntrinsic(parseMarkdown as Intrinsic, undefined, [source]);
  } catch {
    return failureResult(source, "skill.markdown.parse", "Markdown could not be parsed safely");
  }

  try {
    const budget: AnalysisBudget = {
      scalarCodeUnits: 0,
      scheduledNodeOccurrences: 1,
      headingProjectedOccurrences: 0,
    };
    const definitions = new mapConstructorSnapshot<string, MarkdownDefinition>();
    const definitionList = new arrayConstructorSnapshot<MarkdownDefinition>();
    const duplicateIssues = new arrayConstructorSnapshot<MarkdownAnalysisIssue>();
    const pendingTargets = new arrayConstructorSnapshot<PendingTarget>();
    const headings = new arrayConstructorSnapshot<MarkdownHeading>();
    const stack = new arrayConstructorSnapshot<unknown>();
    defineSlot(stack, 0, root);
    let stackLength = 1;
    let nodes = 0;
    let definitionNodes = 0;
    while (stackLength > 0) {
      stackLength -= 1;
      const projected = projectNode(stack[stackLength], budget, nodes === 0, source.length + 1);
      if (isProjectionFailure(projected)) return projectionFailureResult(source, projected);
      const node = projected;
      nodes += 1;
      if (node.type === "definition") {
        definitionNodes += 1;
        if (definitionNodes > MAX_SKILL_MARKDOWN_DEFINITIONS_PER_FILE) {
          return failureResult(
            source,
            "skill.markdown.too_many_definitions",
            `Markdown contains more than ${MAX_SKILL_MARKDOWN_DEFINITIONS_PER_FILE} reference definitions`,
            node.location,
          );
        }
        const item = freeze({
          identifier: node.identifier as string,
          url: node.url as string,
          location: node.location,
        });
        if (applyIntrinsic<boolean>(mapHasSnapshot, definitions, [item.identifier])) {
          append(
            duplicateIssues,
            issue(
              "skill.markdown.duplicate_definition",
              "Markdown reference definitions must be unique",
              node.location,
            ),
          );
        } else {
          applyIntrinsic(mapSetSnapshot, definitions, [item.identifier, item]);
          append(definitionList, item);
        }
      } else if (node.type === "link" || node.type === "image") {
        append(
          pendingTargets,
          freeze({
            form: "inline",
            kind: node.type,
            url: node.url as string,
            location: node.location,
          }),
        );
      } else if (node.type === "linkReference" || node.type === "imageReference") {
        append(
          pendingTargets,
          freeze({
            form: "reference",
            kind: node.type === "linkReference" ? "link" : "image",
            identifier: node.identifier as string,
            referenceType: node.referenceType as ReferenceType,
            location: node.location,
          }),
        );
      } else if (node.type === "heading") {
        const projectedText = projectHeadingText(node.children as unknown[], budget);
        if (typeof projectedText !== "string") {
          return projectionFailureResult(source, withLocation(projectedText, node.location));
        }
        append(
          headings,
          freeze({
            depth: node.depth as 1 | 2 | 3 | 4 | 5 | 6,
            text: projectedText,
            location: node.location,
          }),
        );
      }
      if (pendingTargets.length > MAX_SKILL_MARKDOWN_TARGETS_PER_FILE) {
        return failureResult(
          source,
          "skill.markdown.too_many_targets",
          `Markdown contains more than ${MAX_SKILL_MARKDOWN_TARGETS_PER_FILE} links and images`,
          node.location,
        );
      }
      const children = node.children;
      if (children !== undefined) {
        for (let index = children.length - 1; index >= 0; index -= 1) {
          defineSlot(stack, stackLength, children[index]);
          stackLength += 1;
        }
      }
    }

    const usedDefinitions = new setConstructorSnapshot<string>();
    const targets = new arrayConstructorSnapshot<MarkdownTarget>();
    for (let index = 0; index < pendingTargets.length; index += 1) {
      const pending = pendingTargets[index] as PendingTarget;
      if (pending.form === "inline") {
        append(
          targets,
          freeze({
            kind: pending.kind,
            form: "inline",
            url: pending.url as string,
            location: pending.location,
            destinationLocation: pending.location,
          }),
        );
        continue;
      }
      const found = applyIntrinsic<MarkdownDefinition | undefined>(mapGetSnapshot, definitions, [
        pending.identifier as string,
      ]);
      if (found === undefined) continue;
      applyIntrinsic(setAddSnapshot, usedDefinitions, [pending.identifier as string]);
      append(
        targets,
        freeze({
          kind: pending.kind,
          form: "reference",
          url: found.url,
          location: pending.location,
          destinationLocation: found.location,
          referenceType: pending.referenceType as ReferenceType,
          definition: found,
        }),
      );
    }
    const unusedDefinitions = new arrayConstructorSnapshot<MarkdownDefinition>();
    for (let index = 0; index < definitionList.length; index += 1) {
      const item = definitionList[index] as MarkdownDefinition;
      if (!applyIntrinsic<boolean>(setHasSnapshot, usedDefinitions, [item.identifier])) {
        append(unusedDefinitions, item);
      }
    }
    return registerResult(
      source,
      targets,
      headings,
      definitionList,
      unusedDefinitions,
      duplicateIssues,
      true,
      nodes,
    );
  } catch {
    return failureResult(source, "skill.markdown.parse", "Markdown could not be parsed safely");
  }
}
