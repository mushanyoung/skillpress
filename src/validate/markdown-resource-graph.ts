import { Buffer } from "node:buffer";
import { types } from "node:util";

import { type AbortSignalSample, sampleAbortSignal } from "./abort-signal.js";
import {
  classifyBundledResourceFileName,
  isGenuineBundledResourceFileNameClassification,
} from "./bundled-resource-name.js";
import {
  analyzeMarkdown,
  isGenuineMarkdownAnalysis,
  type MarkdownAnalysis,
  type MarkdownAnalysisIssue,
  type MarkdownLocation,
  type MarkdownTarget,
} from "./markdown-analysis.js";
import {
  classifyMarkdownDestination,
  isCanonicalDecodedMarkdownLocalComponent,
  type MarkdownDestinationIssue,
} from "./markdown-destination.js";
import type { CapturedResourceTreeEntry } from "./resource-tree-capture.js";
import {
  createResourceTreePathIndex,
  type ResourceTreePathIndex,
  resolveResourceTreePath,
} from "./resource-tree-path-index.js";
import {
  isGenuineResourceTreeSession,
  openInspectedResourceTreeSession,
  type ResourceTreeSession,
  type ResourceTreeSessionFailureReason,
  type ResourceTreeSessionMemberReadFailureReason,
  readResourceTreeSessionUtf8Member,
  resourceTreeSessionIsCurrent,
} from "./resource-tree-session.js";
import { projectSkillDocumentEnvelope, type SkillDocumentEnvelope } from "./skill-source.js";
import { MAX_SKILL_DOCUMENT_BYTES } from "./types.js";

export const MAX_SKILL_MARKDOWN_GRAPH_FILES = 256;
export const MAX_SKILL_MARKDOWN_GRAPH_BYTES = 8 * 1024 * 1024;
export const MAX_SKILL_MARKDOWN_GRAPH_NODES = 100_000;
export const MAX_SKILL_MARKDOWN_GRAPH_TARGETS = 4_096;
export const MAX_SKILL_MARKDOWN_GRAPH_WORK = 128 * 1024;
export const MAX_SKILL_MARKDOWN_GRAPH_COMPONENTS = 8_192;
export const MAX_SKILL_MARKDOWN_GRAPH_ALIAS_CANDIDATES = 8_192;

export type MarkdownResourceGraphLocation = Readonly<{ line: number; column: number }>;
export type MarkdownResourceGraphDocument = Readonly<{
  file: string;
  depth: number;
  byteLength: number;
  nodeCount: number;
  targetCount: number;
}>;
export type MarkdownResourceGraphEdge = Readonly<{
  from: string;
  to: string;
  kind: "link" | "image";
  form: "inline" | "reference";
  location: MarkdownResourceGraphLocation;
  destinationLocation: MarkdownResourceGraphLocation;
}>;
type Finding<T extends object> = Readonly<{ file: string } & T>;
type ResolutionFinding<T extends object> = Finding<
  { kind: "resolution"; target: string; location: MarkdownResourceGraphLocation } & T
>;
export type MarkdownResourceGraphFinding =
  | Finding<{
      kind: "markdown";
      code: MarkdownAnalysisIssue["code"];
      location?: MarkdownResourceGraphLocation;
    }>
  | Finding<{
      kind: "destination";
      reason: MarkdownDestinationIssue;
      location: MarkdownResourceGraphLocation;
    }>
  | ResolutionFinding<{ reason: "missing" | "not_directory"; componentIndex: number }>
  | ResolutionFinding<{
      reason: "noncanonical";
      componentIndex: number;
      match: "nfc" | "fold";
      exact: string;
    }>
  | ResolutionFinding<{
      reason: "ambiguous";
      componentIndex: number;
      match: "nfc" | "fold";
      exacts: readonly string[];
    }>
  | ResolutionFinding<{ reason: "not_file" }>
  | Finding<{
      kind: "read";
      reason: "too_large" | "invalid_metadata" | "invalid_read" | "invalid_utf8" | "io";
      target: string;
      location: MarkdownResourceGraphLocation;
    }>
  | Finding<{
      kind: "budget";
      limit: "files" | "bytes" | "nodes" | "targets" | "work" | "components" | "alias_candidates";
      location: MarkdownResourceGraphLocation;
    }>;
export type BundledResourceNameFinding =
  | Finding<{ kind: "environment_file" }>
  | Finding<{ kind: "credential_file" }>;
export type MarkdownResourceGraphTotals = Readonly<{
  files: number;
  bytes: number;
  nodes: number;
  targets: number;
  work: number;
  components: number;
  aliasCandidates: number;
}>;
export type MarkdownResourceGraph = Readonly<{
  surface: "commonmark-links-images-v1";
  complete: boolean;
  documents: readonly MarkdownResourceGraphDocument[];
  edges: readonly MarkdownResourceGraphEdge[];
  reachableFiles: readonly string[];
  findings: readonly MarkdownResourceGraphFinding[];
  totals: MarkdownResourceGraphTotals;
}>;
export type MarkdownResourceGraphFailureReason =
  | ResourceTreeSessionFailureReason
  | ResourceTreeSessionMemberReadFailureReason;
export type MarkdownResourceGraphResult =
  | Readonly<{
      ok: true;
      documentText: string;
      resourceFindings: readonly BundledResourceNameFinding[];
      graph: MarkdownResourceGraph;
    }>
  | Readonly<{
      ok: true;
      documentText: string;
      resourceFindings: readonly BundledResourceNameFinding[];
    }>
  | Readonly<{ ok: false; reason: MarkdownResourceGraphFailureReason }>;

type Failure = Extract<MarkdownResourceGraphResult, Readonly<{ ok: false }>>;
type AsyncSettlement = Readonly<{ ok: true; value: unknown }> | Readonly<{ ok: false }>;
type SyncResult = Readonly<{ ok: true; value: unknown }> | Readonly<{ ok: false }>;
type AsyncCall = Readonly<{ kind: "async"; intrinsic: Intrinsic; args: readonly unknown[] }>;
type RoutineCall = Readonly<{ kind: "routine"; routine: Routine }>;
type Effect = AsyncCall | RoutineCall;
type Routine<T = unknown> = Generator<Effect, T, unknown>;
type ReplayEntry = Readonly<{
  identity: CapturedResourceTreeEntry;
  layout: object;
  metadata: object;
  role: CapturedResourceTreeEntry["role"];
  exactName: string;
  relativePath: string;
  size: bigint;
}>;
type EntryReplay = Readonly<{
  sourceEntries: readonly unknown[];
  entries: readonly ReplayEntry[];
  documentIndex: number;
}>;
type LocalDestination = Readonly<{ path: string; components: readonly string[] }>;
type VisitOrigin = Finding<{ target: string; location: MarkdownResourceGraphLocation }>;
type ReadSuccess = Readonly<{ ok: true; text: string; byteLength: number }>;
type ReadFailure = Readonly<{ ok: false; reason: ResourceTreeSessionMemberReadFailureReason }>;
type ReadResult = ReadSuccess | ReadFailure;

interface MutableTotals {
  files: number;
  bytes: number;
  nodes: number;
  targets: number;
  work: number;
  components: number;
  aliasCandidates: number;
}
interface GraphState {
  readonly session: ResourceTreeSession;
  readonly index: ResourceTreePathIndex;
  readonly sourceEntries: readonly unknown[];
  readonly entries: readonly ReplayEntry[];
  readonly status: number[];
  readonly reachable: boolean[];
  readonly documents: MarkdownResourceGraphDocument[];
  readonly edges: MarkdownResourceGraphEdge[];
  readonly reachableFiles: string[];
  readonly findings: MarkdownResourceGraphFinding[];
  readonly totals: MutableTotals;
  complete: boolean;
  terminal: boolean;
  documentText: string | undefined;
  graphUnavailable: boolean;
}

// Module initialization is the trust boundary for producers and intrinsics below.
const applySnapshot = Reflect.apply;
const arrayConstructorSnapshot = Array;
const arrayIsArraySnapshot = Array.isArray;
const arrayJoinSnapshot = Array.prototype.join;
const arrayPrototypeSnapshot = Array.prototype;
const bufferByteLengthSnapshot = Buffer.byteLength;
const bufferConstructorSnapshot = Buffer;
const numberConstructorSnapshot = Number;
const numberIsSafeIntegerSnapshot = Number.isSafeInteger;
const objectConstructorSnapshot = Object;
const objectDefinePropertySnapshot = Object.defineProperty;
const objectFreezeSnapshot = Object.freeze;
const objectGetOwnPropertyDescriptorSnapshot = Object.getOwnPropertyDescriptor;
const objectGetPrototypeOfSnapshot = Object.getPrototypeOf;
const objectIsSnapshot = Object.is;
const objectPrototypeSnapshot = Object.prototype;
const promiseConstructorSnapshot = Promise;
const promisePrototypeSnapshot = Promise.prototype;
const stringCharCodeAtSnapshot = String.prototype.charCodeAt;
const stringIndexOfSnapshot = String.prototype.indexOf;
const stringSliceSnapshot = String.prototype.slice;
const stringSplitSnapshot = String.prototype.split;
const weakSetAddSnapshot = WeakSet.prototype.add;
const weakSetHasSnapshot = WeakSet.prototype.has;
const isPromiseSnapshot = types.isPromise;
const isProxySnapshot = types.isProxy;
const sampleSignalSnapshot = sampleAbortSignal;
const openSessionSnapshot = openInspectedResourceTreeSession;
const genuineSessionSnapshot = isGenuineResourceTreeSession;
const currentSessionSnapshot = resourceTreeSessionIsCurrent;
const readMemberSnapshot = readResourceTreeSessionUtf8Member;
const createIndexSnapshot = createResourceTreePathIndex;
const resolvePathSnapshot = resolveResourceTreePath;
const envelopeSnapshot = projectSkillDocumentEnvelope;
const analyzeSnapshot = analyzeMarkdown;
const genuineAnalysisSnapshot = isGenuineMarkdownAnalysis;
const destinationSnapshot = classifyMarkdownDestination;
const canonicalComponentSnapshot = isCanonicalDecodedMarkdownLocalComponent;
const classifyResourceNameSnapshot = classifyBundledResourceFileName;
const genuineResourceNameClassificationSnapshot = isGenuineBundledResourceFileNameClassification;
const generatorNextSnapshot = (function* () {})().next;
const ABSENT = objectFreezeSnapshot({ absent: true } as const);
const resourceFindingArrays = new WeakSet<object>();
const MAX_SAFE_INTEGER = 9_007_199_254_740_991;
const MAX_SKILL_DOCUMENT_BYTES_BIGINT = 524_288n;
const SESSION_FAILURES =
  "|invalid_input|aborted|changed|invalid_inventory|invalid_metadata|unsupported_kind|too_many_entries|too_deep|paths_too_large|inconsistent|io|";
const DESTINATION_ISSUES =
  "|absolute_path|ambiguous_encoding|backslash|component_too_large|dot_component|empty_component|encoded_delimiter|encoded_separator|invalid_external|malformed_encoding|non_nfc|nonportable_component|query|too_large|too_many_components|type|unsafe_scheme|unsafe_unicode|windows_drive|";
const MEMBER_FAILURES =
  "|invalid_input|aborted|changed|unsupported_kind|too_large|invalid_metadata|invalid_read|invalid_utf8|inconsistent|io|";
const ENVELOPE_FAILURES =
  "|byte_order_mark|control_character|missing_frontmatter|unclosed_frontmatter|frontmatter_too_large|";

type Intrinsic = (...args: never[]) => unknown;
function applyIntrinsic<T>(intrinsic: Intrinsic, receiver: unknown, args: unknown[]): T {
  return applySnapshot(intrinsic, receiver, args) as T;
}
function freeze<T extends object>(value: T): Readonly<T> {
  return applyIntrinsic<Readonly<T>>(objectFreezeSnapshot, objectConstructorSnapshot, [value]);
}
function defineFrozenData(
  target: object,
  property: PropertyKey,
  value: unknown,
  enumerable: boolean,
): void {
  applyIntrinsic(objectDefinePropertySnapshot, objectConstructorSnapshot, [
    target,
    property,
    { __proto__: null, configurable: false, enumerable, value, writable: false },
  ]);
}
function barrier<T extends object>(value: T): Readonly<T> {
  defineFrozenData(value, "then", undefined, false);
  return freeze(value);
}
function defineSlot<T>(values: T[], ordinal: number, value: T): void {
  applyIntrinsic(objectDefinePropertySnapshot, objectConstructorSnapshot, [
    values,
    ordinal,
    { __proto__: null, configurable: true, enumerable: true, value, writable: true },
  ]);
}
function append<T>(values: T[], value: T): void {
  defineSlot(values, values.length, value);
}
function copy<T>(values: readonly T[]): readonly T[] {
  const result = new arrayConstructorSnapshot<T>();
  for (let ordinal = 0; ordinal < values.length; ordinal += 1)
    defineSlot(result, ordinal, values[ordinal] as T);
  return freeze(result);
}
function registerResourceFindings(
  values: readonly BundledResourceNameFinding[],
): readonly BundledResourceNameFinding[] {
  applyIntrinsic<WeakSet<object>>(weakSetAddSnapshot, resourceFindingArrays, [values]);
  return values;
}
/** Accept only complete finding inventories produced by this module. */
export function isGenuineBundledResourceNameFindings(
  value: unknown,
): value is readonly BundledResourceNameFinding[] {
  if ((typeof value !== "object" && typeof value !== "function") || value === null) return false;
  return applyIntrinsic<boolean>(weakSetHasSnapshot, resourceFindingArrays, [value]);
}
function ownDescriptor(value: object, property: PropertyKey): PropertyDescriptor | undefined {
  return applyIntrinsic<PropertyDescriptor | undefined>(
    objectGetOwnPropertyDescriptorSnapshot,
    objectConstructorSnapshot,
    [value, property],
  );
}
function ownData(value: object, property: PropertyKey): unknown {
  const descriptor = ownDescriptor(value, property);
  if (descriptor === undefined) return ABSENT;
  const valueDescriptor = ownDescriptor(descriptor, "value");
  return valueDescriptor === undefined ? ABSENT : valueDescriptor.value;
}
function isRecord(value: unknown): value is object {
  return (
    typeof value === "object" &&
    value !== null &&
    !applyIntrinsic<boolean>(isProxySnapshot, undefined, [value])
  );
}
function isPlainRecord(value: unknown): value is object {
  return (
    isRecord(value) &&
    applyIntrinsic<object | null>(objectGetPrototypeOfSnapshot, objectConstructorSnapshot, [
      value,
    ]) === objectPrototypeSnapshot
  );
}
function isArray(value: unknown): value is readonly unknown[] {
  return (
    isRecord(value) &&
    applyIntrinsic<boolean>(arrayIsArraySnapshot, arrayConstructorSnapshot, [value]) &&
    applyIntrinsic<object | null>(objectGetPrototypeOfSnapshot, objectConstructorSnapshot, [
      value,
    ]) === arrayPrototypeSnapshot
  );
}
function safeInteger(value: unknown, maximum = MAX_SAFE_INTEGER): value is number {
  return (
    typeof value === "number" &&
    applyIntrinsic<boolean>(numberIsSafeIntegerSnapshot, numberConstructorSnapshot, [value]) &&
    !applyIntrinsic<boolean>(objectIsSnapshot, objectConstructorSnapshot, [value, -0]) &&
    value >= 0 &&
    value <= maximum
  );
}
function listed(value: unknown, values: string): value is string {
  return (
    typeof value === "string" &&
    value.length <= 32 &&
    applyIntrinsic<number>(stringIndexOfSnapshot, value, ["|"]) < 0 &&
    applyIntrinsic<number>(stringIndexOfSnapshot, values, [`|${value}|`]) >= 0
  );
}
const BUDGET_MAXIMUMS = {
  files: MAX_SKILL_MARKDOWN_GRAPH_FILES,
  bytes: MAX_SKILL_MARKDOWN_GRAPH_BYTES,
  nodes: MAX_SKILL_MARKDOWN_GRAPH_NODES,
  targets: MAX_SKILL_MARKDOWN_GRAPH_TARGETS,
  work: MAX_SKILL_MARKDOWN_GRAPH_WORK,
  components: MAX_SKILL_MARKDOWN_GRAPH_COMPONENTS,
  aliasCandidates: MAX_SKILL_MARKDOWN_GRAPH_ALIAS_CANDIDATES,
} as const;
function promisePrototypeIntact(): boolean {
  try {
    const descriptor = ownDescriptor(promisePrototypeSnapshot, "constructor");
    return descriptor !== undefined && ownData(descriptor, "value") === promiseConstructorSnapshot;
  } catch {
    return false;
  }
}
function authenticPromise(value: unknown): value is Promise<unknown> {
  try {
    if (
      !isRecord(value) ||
      !applyIntrinsic<boolean>(isPromiseSnapshot, undefined, [value]) ||
      applyIntrinsic<object>(objectGetPrototypeOfSnapshot, objectConstructorSnapshot, [value]) !==
        promisePrototypeSnapshot
    ) {
      return false;
    }
    const ownConstructor = ownDescriptor(value, "constructor");
    if (
      ownConstructor !== undefined &&
      ownData(ownConstructor, "value") !== promiseConstructorSnapshot
    ) {
      return false;
    }
    return promisePrototypeIntact();
  } catch {
    return false;
  }
}
const SETTLEMENT_FAILURE: AsyncSettlement = barrier({ ok: false } as const);
function asyncCall(intrinsic: Intrinsic, args: unknown[]): AsyncCall {
  return freeze({ kind: "async", intrinsic, args: copy(args) });
}
function routineCall(routine: Routine): RoutineCall {
  return freeze({ kind: "routine", routine });
}
function invoke(intrinsic: Intrinsic, args: unknown[]): SyncResult {
  try {
    return freeze({
      ok: true,
      value: applyIntrinsic<unknown>(intrinsic, undefined, args),
    } as const);
  } catch {
    return freeze({ ok: false } as const);
  }
}

const FAILURE_REASONS = applyIntrinsic<string[]>(
  stringSplitSnapshot,
  "invalid_input|aborted|changed|invalid_inventory|invalid_metadata|unsupported_kind|too_many_entries|too_deep|paths_too_large|too_large|invalid_read|invalid_utf8|inconsistent|io",
  ["|"],
) as MarkdownResourceGraphFailureReason[];
const FAILURES = new objectConstructorSnapshot() as Record<
  MarkdownResourceGraphFailureReason,
  Failure
>;
for (let ordinal = 0; ordinal < FAILURE_REASONS.length; ordinal += 1) {
  const reason = FAILURE_REASONS[ordinal] as MarkdownResourceGraphFailureReason;
  defineFrozenData(FAILURES, reason, barrier({ ok: false, reason }), true);
}
freeze(FAILURES);
function failure(reason: MarkdownResourceGraphFailureReason): Failure {
  return FAILURES[reason];
}
function knownFailureReason(value: unknown): value is MarkdownResourceGraphFailureReason {
  for (let ordinal = 0; ordinal < FAILURE_REASONS.length; ordinal += 1)
    if (value === FAILURE_REASONS[ordinal]) return true;
  return false;
}
function checkpoint(signal: unknown): Failure | undefined {
  let sampled: AbortSignalSample;
  try {
    sampled = applyIntrinsic<AbortSignalSample>(sampleSignalSnapshot, undefined, [signal]);
  } catch {
    return failure("invalid_input");
  }
  if (sampled === "invalid") return failure("invalid_input");
  if (sampled === "aborted") return failure("aborted");
  return promisePrototypeIntact() ? undefined : failure("inconsistent");
}

function normalizedOpen(value: unknown): unknown {
  try {
    if (!isPlainRecord(value)) return ABSENT;
    const ok = ownData(value, "ok");
    if (ok === true) return freeze({ session: ownData(value, "session") });
    const reason = ok === false ? ownData(value, "reason") : ABSENT;
    return listed(reason, SESSION_FAILURES)
      ? failure(reason as ResourceTreeSessionFailureReason)
      : ABSENT;
  } catch {
    return ABSENT;
  }
}
function replaySession(session: ResourceTreeSession): EntryReplay | Failure {
  try {
    const entriesValue = ownData(session, "entries");
    if (!isArray(entriesValue)) return failure("inconsistent");
    const length = ownData(entriesValue, "length");
    if (!safeInteger(length, 8_192)) return failure("inconsistent");
    const entries = new arrayConstructorSnapshot<ReplayEntry>();
    let documentIndex = -1;
    for (let ordinal = 0; ordinal < length; ordinal += 1) {
      const entry = ownData(entriesValue, ordinal);
      if (!isPlainRecord(entry)) return failure("inconsistent");
      const role = ownData(entry, "role");
      const layout = ownData(entry, "layout");
      const metadata = ownData(entry, "metadata");
      const exactName = isPlainRecord(layout) ? ownData(layout, "exactName") : ABSENT;
      const relativePath = isPlainRecord(layout) ? ownData(layout, "relativePath") : ABSENT;
      if (
        (role !== "document" && role !== "resource-file" && role !== "directory") ||
        !isPlainRecord(layout) ||
        !isPlainRecord(metadata) ||
        !applyIntrinsic<boolean>(objectIsSnapshot, objectConstructorSnapshot, [
          ownData(layout, "entryIndex"),
          ordinal,
        ]) ||
        typeof exactName !== "string" ||
        typeof relativePath !== "string"
      ) {
        return failure("inconsistent");
      }
      const size = ownData(metadata, "size");
      const kind = ownData(metadata, "kind");
      if (typeof size !== "bigint") return failure("inconsistent");
      if (size < 0n) return failure("invalid_metadata");
      if (kind !== (role === "directory" ? "directory" : "file")) {
        return failure("inconsistent");
      }
      const replayed = freeze({
        identity: entry as CapturedResourceTreeEntry,
        layout,
        metadata,
        role: role as ReplayEntry["role"],
        exactName,
        relativePath,
        size,
      });
      append(entries, replayed);
      if (role === "document") {
        if (documentIndex >= 0) return failure("inconsistent");
        if (replayed.exactName !== "SKILL.md" || replayed.relativePath !== "SKILL.md") {
          return failure("inconsistent");
        }
        documentIndex = ordinal;
      }
    }
    if (documentIndex < 0) return failure("inconsistent");
    return freeze({
      sourceEntries: entriesValue,
      entries: copy(entries),
      documentIndex,
    });
  } catch {
    return failure("inconsistent");
  }
}

function location(line: number, column: number): MarkdownResourceGraphLocation {
  return freeze({ line, column });
}
function shifted(value: MarkdownLocation, lineOffset: number): MarkdownResourceGraphLocation {
  return location(value.line + lineOffset, value.column);
}
function charCodeAt(value: string, index: number): number {
  return applyIntrinsic<number>(stringCharCodeAtSnapshot, value, [index]);
}
function slice(value: string, start: number): string {
  return applyIntrinsic<string>(stringSliceSnapshot, value, [start]);
}
function byteLength(value: string): number {
  return applyIntrinsic<number>(bufferByteLengthSnapshot, bufferConstructorSnapshot, [
    value,
    "utf8",
  ]);
}
function markdownPath(value: string): boolean {
  const length = value.length;
  if (length < 3 || charCodeAt(value, length - 3) !== 0x2e) return false;
  const m = charCodeAt(value, length - 2);
  const d = charCodeAt(value, length - 1);
  return (m === 0x4d || m === 0x6d) && (d === 0x44 || d === 0x64);
}
function validateEnvelope(
  value: unknown,
  text: string,
): SkillDocumentEnvelope | Failure | undefined {
  try {
    if (!isPlainRecord(value)) return failure("inconsistent");
    const ok = ownData(value, "ok");
    if (ok === false) {
      const reason = ownData(value, "reason");
      if (reason === "invalid_input") return failure("inconsistent");
      return listed(reason, ENVELOPE_FAILURES) ? undefined : failure("inconsistent");
    }
    const envelope = ownData(value, "envelope");
    if (ok !== true || !isPlainRecord(envelope)) return failure("inconsistent");
    const yaml = ownData(envelope, "yaml");
    const body = ownData(envelope, "body");
    const bodyStartLine = ownData(envelope, "bodyStartLine");
    const bodyStartOffset = ownData(envelope, "bodyStartOffset");
    if (
      typeof yaml !== "string" ||
      typeof body !== "string" ||
      !safeInteger(bodyStartOffset, text.length) ||
      !safeInteger(bodyStartLine, text.length + 1) ||
      bodyStartLine < 1 ||
      body !== slice(text, bodyStartOffset)
    ) {
      return failure("inconsistent");
    }
    let line = 1;
    for (let index = 0; index < bodyStartOffset; index += 1) {
      const code = charCodeAt(text, index);
      if (code === 0x0a) line += 1;
      else if (code === 0x0d && charCodeAt(text, index + 1) !== 0x0a) line += 1;
    }
    return line === bodyStartLine
      ? freeze({ yaml, body, bodyStartLine, bodyStartOffset })
      : failure("inconsistent");
  } catch {
    return failure("inconsistent");
  }
}

function budget(
  state: GraphState,
  key: keyof MutableTotals,
  amount: number,
  file: string,
  at: MarkdownResourceGraphLocation,
): boolean {
  const maximum = BUDGET_MAXIMUMS[key];
  const limit = key === "aliasCandidates" ? ("alias_candidates" as const) : key;
  if (state.terminal) return false;
  if (state.totals[key] + amount <= maximum) {
    state.totals[key] += amount;
    return true;
  }
  append(state.findings, freeze({ kind: "budget", limit, file, location: at }));
  state.complete = false;
  state.terminal = true;
  return false;
}
function addFinding(state: GraphState, finding: MarkdownResourceGraphFinding): void {
  append(state.findings, finding);
}
function readFinding(
  state: GraphState,
  origin: VisitOrigin,
  reason: Extract<MarkdownResourceGraphFinding, Readonly<{ kind: "read" }>>["reason"],
): void {
  state.complete = false;
  addFinding(
    state,
    freeze({
      kind: "read",
      reason,
      file: origin.file,
      target: origin.target,
      location: origin.location,
    }),
  );
}
function initializeState(
  session: ResourceTreeSession,
  index: ResourceTreePathIndex,
  replay: EntryReplay,
  documentIndex: number,
): GraphState {
  const status = new arrayConstructorSnapshot<number>(replay.entries.length);
  const reachable = new arrayConstructorSnapshot<boolean>(replay.entries.length);
  for (let ordinal = 0; ordinal < replay.entries.length; ordinal += 1) {
    defineSlot(status, ordinal, 0);
    defineSlot(reachable, ordinal, false);
  }
  reachable[documentIndex] = true;
  const reachableFiles = new arrayConstructorSnapshot<string>();
  append(reachableFiles, "SKILL.md");
  return {
    session,
    index,
    sourceEntries: replay.sourceEntries,
    entries: replay.entries,
    status,
    reachable,
    documents: new arrayConstructorSnapshot<MarkdownResourceGraphDocument>(),
    edges: new arrayConstructorSnapshot<MarkdownResourceGraphEdge>(),
    reachableFiles,
    findings: new arrayConstructorSnapshot<MarkdownResourceGraphFinding>(),
    totals: {
      files: 0,
      bytes: 0,
      nodes: 0,
      targets: 0,
      work: 0,
      components: 0,
      aliasCandidates: 0,
    },
    complete: true,
    terminal: false,
    documentText: undefined,
    graphUnavailable: false,
  };
}
function boundEntry(state: GraphState, entryIndex: number): ReplayEntry | undefined {
  try {
    const entry = state.entries[entryIndex];
    if (entry === undefined) return undefined;
    return ownData(state.session, "entries") !== state.sourceEntries ||
      ownData(state.sourceEntries, entryIndex) !== entry.identity ||
      ownData(entry.identity, "layout") !== entry.layout ||
      ownData(entry.identity, "metadata") !== entry.metadata ||
      ownData(entry.identity, "role") !== entry.role ||
      !applyIntrinsic<boolean>(objectIsSnapshot, objectConstructorSnapshot, [
        ownData(entry.layout, "entryIndex"),
        entryIndex,
      ]) ||
      ownData(entry.layout, "exactName") !== entry.exactName ||
      ownData(entry.layout, "relativePath") !== entry.relativePath ||
      ownData(entry.metadata, "size") !== entry.size ||
      ownData(entry.metadata, "kind") !== (entry.role === "directory" ? "directory" : "file")
      ? undefined
      : entry;
  } catch {
    return undefined;
  }
}
function replayIntact(state: GraphState): boolean {
  if (ownData(state.sourceEntries, "length") !== state.entries.length) return false;
  for (let entryIndex = 0; entryIndex < state.entries.length; entryIndex += 1)
    if (boundEntry(state, entryIndex) === undefined) return false;
  return true;
}

function scanBundledResourceNames(
  state: GraphState,
  signal: unknown,
): readonly BundledResourceNameFinding[] | Failure {
  const findings = new arrayConstructorSnapshot<BundledResourceNameFinding>();
  for (let entryIndex = 0; entryIndex < state.entries.length; entryIndex += 1) {
    const entry = boundEntry(state, entryIndex);
    if (entry === undefined) return failure("inconsistent");
    if (entry.role !== "resource-file") continue;

    const classified = invoke(classifyResourceNameSnapshot, [entry.exactName]);
    const afterClassification = checkpoint(signal);
    if (afterClassification !== undefined) return afterClassification;
    if (!classified.ok) return failure("inconsistent");

    const genuine = invoke(genuineResourceNameClassificationSnapshot, [classified.value]);
    const afterPredicate = checkpoint(signal);
    if (afterPredicate !== undefined) return afterPredicate;
    if (!genuine.ok || genuine.value !== true || !isPlainRecord(classified.value)) {
      return failure("inconsistent");
    }

    const ok = ownData(classified.value, "ok");
    if (ok === true) continue;
    const reason = ownData(classified.value, "reason");
    if (ok !== false || (reason !== "environment_file" && reason !== "credential_file")) {
      return failure("inconsistent");
    }
    append(findings, freeze({ kind: reason, file: entry.relativePath }));
  }
  return registerResourceFindings(copy(findings));
}

function normalizeRead(value: unknown): ReadResult {
  try {
    if (!isPlainRecord(value)) return barrier({ ok: false, reason: "inconsistent" } as const);
    const ok = ownData(value, "ok");
    if (ok === false) {
      const reason = ownData(value, "reason");
      return listed(reason, MEMBER_FAILURES)
        ? barrier({ ok: false, reason } as ReadFailure)
        : barrier({ ok: false, reason: "inconsistent" } as const);
    }
    const text = ownData(value, "text");
    const bytes = ownData(value, "byteLength");
    return ok === true &&
      typeof text === "string" &&
      text.length <= MAX_SKILL_DOCUMENT_BYTES &&
      safeInteger(bytes, MAX_SKILL_DOCUMENT_BYTES) &&
      byteLength(text) === bytes
      ? barrier({ ok: true, text, byteLength: bytes })
      : barrier({ ok: false, reason: "inconsistent" } as const);
  } catch {
    return barrier({ ok: false, reason: "inconsistent" } as const);
  }
}
function* readEntry(
  state: GraphState,
  entryIndex: number,
  signal: unknown,
): Generator<Effect, ReadResult, unknown> {
  const entry = boundEntry(state, entryIndex);
  if (entry === undefined) return failure("inconsistent") as ReadFailure;
  const settled = (yield asyncCall(readMemberSnapshot, [
    state.session,
    entry.identity,
    signal,
  ])) as AsyncSettlement;
  const sampled = checkpoint(signal);
  if (sampled !== undefined) return sampled as ReadFailure;
  return settled.ok ? normalizeRead(settled.value) : (failure("inconsistent") as ReadFailure);
}
function normalizeDestination(
  value: unknown,
  signal: unknown,
): LocalDestination | "document" | "external" | MarkdownDestinationIssue | Failure {
  try {
    if (!isPlainRecord(value)) return failure("inconsistent");
    const kind = ownData(value, "kind");
    if (kind === "document" || kind === "external") return kind;
    if (kind === "invalid") {
      const reason = ownData(value, "reason");
      return listed(reason, DESTINATION_ISSUES)
        ? (reason as MarkdownDestinationIssue)
        : failure("inconsistent");
    }
    const path = ownData(value, "path");
    const componentsValue = ownData(value, "components");
    if (kind !== "local" || typeof path !== "string" || !isArray(componentsValue))
      return failure("inconsistent");
    if (path.length > 4_096 || byteLength(path) > 4_096) return failure("inconsistent");
    const length = ownData(componentsValue, "length");
    if (!safeInteger(length, 64) || length === 0) return failure("inconsistent");
    const components = new arrayConstructorSnapshot<string>();
    for (let ordinal = 0; ordinal < length; ordinal += 1) {
      const component = ownData(componentsValue, ordinal);
      if (typeof component !== "string" || component.length > 255) return failure("inconsistent");
      const checked = invoke(canonicalComponentSnapshot, [component]);
      const sampled = checkpoint(signal);
      if (sampled !== undefined) return sampled;
      if (!checked.ok || checked.value !== true) return failure("inconsistent");
      append(components, component);
    }
    const copied = copy(components);
    const joined = applyIntrinsic<string>(arrayJoinSnapshot, copied, ["/"]);
    return joined === path ? freeze({ path, components: copied }) : failure("inconsistent");
  } catch {
    return failure("inconsistent");
  }
}
function resolutionFinding(
  state: GraphState,
  value: unknown,
  local: LocalDestination,
  file: string,
  at: MarkdownResourceGraphLocation,
): number | Failure | undefined {
  try {
    if (!isPlainRecord(value)) return failure("inconsistent");
    const ok = ownData(value, "ok");
    if (ok === true) {
      const entryIndex = ownData(value, "entryIndex");
      return safeInteger(entryIndex, state.entries.length - 1)
        ? entryIndex
        : failure("inconsistent");
    }
    if (ok !== false) return failure("inconsistent");
    const reason = ownData(value, "reason");
    if (reason === "invalid_input" || reason === "inconsistent") return failure("inconsistent");
    if (reason === "missing" || reason === "not_directory") {
      const componentIndex = ownData(value, "componentIndex");
      if (!safeInteger(componentIndex, local.components.length - 1)) return failure("inconsistent");
      addFinding(
        state,
        freeze<MarkdownResourceGraphFinding>({
          kind: "resolution",
          reason,
          file,
          target: local.path,
          location: at,
          componentIndex,
        }),
      );
      return undefined;
    }
    if (reason !== "noncanonical" && reason !== "ambiguous") return failure("inconsistent");
    const componentIndex = ownData(value, "componentIndex");
    const match = ownData(value, "match");
    if (
      !safeInteger(componentIndex, local.components.length - 1) ||
      (match !== "nfc" && match !== "fold")
    ) {
      return failure("inconsistent");
    }
    if (reason === "noncanonical") {
      if (!budget(state, "aliasCandidates", 1, file, at)) {
        return undefined;
      }
      const exact = ownData(value, "exact");
      if (typeof exact !== "string" || exact.length > 255 || byteLength(exact) > 255)
        return failure("inconsistent");
      addFinding(
        state,
        freeze<MarkdownResourceGraphFinding>({
          kind: "resolution",
          reason,
          file,
          target: local.path,
          location: at,
          componentIndex,
          match,
          exact,
        }),
      );
      return undefined;
    }
    const exactsValue = ownData(value, "exacts");
    if (!isArray(exactsValue)) return failure("inconsistent");
    const length = ownData(exactsValue, "length");
    if (!safeInteger(length, 1_024) || length < 2) return failure("inconsistent");
    if (!budget(state, "aliasCandidates", length, file, at)) {
      return undefined;
    }
    const exacts = new arrayConstructorSnapshot<string>();
    for (let ordinal = 0; ordinal < length; ordinal += 1) {
      const exact = ownData(exactsValue, ordinal);
      if (typeof exact !== "string" || exact.length > 255 || byteLength(exact) > 255)
        return failure("inconsistent");
      append(exacts, exact);
    }
    addFinding(
      state,
      freeze<MarkdownResourceGraphFinding>({
        kind: "resolution",
        reason,
        file,
        target: local.path,
        location: at,
        componentIndex,
        match,
        exacts: copy(exacts),
      }),
    );
    return undefined;
  } catch {
    return failure("inconsistent");
  }
}

function* processTarget(
  state: GraphState,
  target: MarkdownTarget,
  file: string,
  depth: number,
  lineOffset: number,
  signal: unknown,
): Generator<Effect, Failure | undefined, unknown> {
  const usage = shifted(target.location, lineOffset);
  const destinationAt = shifted(target.destinationLocation, lineOffset);
  if (!budget(state, "targets", 1, file, usage) || !budget(state, "work", 1, file, usage)) {
    return undefined;
  }
  const classified = invoke(destinationSnapshot, [target.url]);
  const afterClassify = checkpoint(signal);
  if (afterClassify !== undefined) return afterClassify;
  if (!classified.ok) return failure("inconsistent");
  const destination = normalizeDestination(classified.value, signal);
  if (isFailure(destination)) return destination;
  if (destination === "document" || destination === "external") return undefined;
  if (typeof destination === "string") {
    addFinding(
      state,
      freeze({ kind: "destination", reason: destination, file, location: destinationAt }),
    );
    return undefined;
  }
  if (
    !budget(state, "components", destination.components.length, file, destinationAt) ||
    !budget(state, "work", destination.components.length + 1, file, destinationAt)
  ) {
    return undefined;
  }
  const resolved = invoke(resolvePathSnapshot, [state.index, destination.components]);
  const afterResolve = checkpoint(signal);
  if (afterResolve !== undefined) return afterResolve;
  if (!resolved.ok) return failure("inconsistent");
  const resolvedIndex = resolutionFinding(state, resolved.value, destination, file, destinationAt);
  if (isFailure(resolvedIndex)) return resolvedIndex;
  if (resolvedIndex === undefined || state.terminal) return undefined;
  const entry = boundEntry(state, resolvedIndex);
  if (entry === undefined) return failure("inconsistent");
  if (entry.relativePath !== destination.path) return failure("inconsistent");
  const to = entry.relativePath;
  if (entry.role === "directory") {
    addFinding(
      state,
      freeze<MarkdownResourceGraphFinding>({
        kind: "resolution",
        reason: "not_file",
        file,
        target: destination.path,
        location: destinationAt,
      }),
    );
    return undefined;
  }
  append(
    state.edges,
    freeze({
      from: file,
      to,
      kind: target.kind,
      form: target.form,
      location: usage,
      destinationLocation: destinationAt,
    }),
  );
  if (!state.reachable[resolvedIndex]) {
    state.reachable[resolvedIndex] = true;
    append(state.reachableFiles, to);
  }
  if (target.kind === "link" && markdownPath(to) && state.status[resolvedIndex] === 0) {
    return (yield routineCall(
      visitDocument(
        state,
        resolvedIndex,
        depth + 1,
        freeze({ file, target: to, location: destinationAt }),
        signal,
      ),
    )) as Failure | undefined;
  }
  return undefined;
}

function isFailure(value: unknown): value is Failure {
  return (
    isPlainRecord(value) &&
    ownData(value, "ok") === false &&
    knownFailureReason(ownData(value, "reason"))
  );
}
function* analyzeDocument(
  state: GraphState,
  entry: ReplayEntry,
  text: string,
  byteCount: number,
  depth: number,
  lineOffset: number,
  start: MarkdownResourceGraphLocation,
  signal: unknown,
): Generator<Effect, Failure | undefined, unknown> {
  const file = entry.relativePath;
  if (!budget(state, "work", 1, file, start)) {
    return undefined;
  }
  const analyzed = invoke(analyzeSnapshot, [text]);
  const afterAnalyze = checkpoint(signal);
  if (afterAnalyze !== undefined) return afterAnalyze;
  if (!analyzed.ok) return failure("inconsistent");
  const genuine = invoke(genuineAnalysisSnapshot, [analyzed.value]);
  const afterPredicate = checkpoint(signal);
  if (afterPredicate !== undefined) return afterPredicate;
  if (!genuine.ok || genuine.value !== true) return failure("inconsistent");
  const analysis = analyzed.value as MarkdownAnalysis;
  if (!budget(state, "nodes", analysis.nodeCount, file, start)) {
    return undefined;
  }
  append(
    state.documents,
    freeze({
      file,
      depth,
      byteLength: byteCount,
      nodeCount: analysis.nodeCount,
      targetCount: analysis.targets.length,
    }),
  );
  let issueIndex = 0;
  let targetIndex = 0;
  while (
    !state.terminal &&
    (issueIndex < analysis.issues.length || targetIndex < analysis.targets.length)
  ) {
    const issue = issueIndex < analysis.issues.length ? analysis.issues[issueIndex] : undefined;
    const target =
      targetIndex < analysis.targets.length ? analysis.targets[targetIndex] : undefined;
    const issueLocation = issue === undefined ? undefined : ownData(issue, "location");
    const hasIssueLocation = issueLocation !== undefined && issueLocation !== ABSENT;
    const issueAt = hasIssueLocation
      ? shifted(issueLocation as MarkdownLocation, lineOffset)
      : start;
    const targetAt = target === undefined ? undefined : shifted(target.location, lineOffset);
    if (
      issue !== undefined &&
      (targetAt === undefined ||
        issueAt.line < targetAt.line ||
        (issueAt.line === targetAt.line && issueAt.column <= targetAt.column))
    ) {
      if (!budget(state, "work", 1, file, issueAt)) {
        return undefined;
      }
      const finding = hasIssueLocation
        ? freeze({ kind: "markdown", code: issue.code, file, location: issueAt } as const)
        : freeze({ kind: "markdown", code: issue.code, file } as const);
      addFinding(state, finding);
      issueIndex += 1;
      if (issue.code !== "skill.markdown.duplicate_definition") {
        state.complete = false;
        return undefined;
      }
      continue;
    }
    if (target === undefined) return failure("inconsistent");
    targetIndex += 1;
    const targetFailure = (yield routineCall(
      processTarget(state, target, file, depth, lineOffset, signal),
    )) as Failure | undefined;
    if (targetFailure !== undefined) return targetFailure;
  }
  return undefined;
}

function* visitDocument(
  state: GraphState,
  entryIndex: number,
  depth: number,
  origin: VisitOrigin | undefined,
  signal: unknown,
): Generator<Effect, Failure | undefined, unknown> {
  const entry = boundEntry(state, entryIndex);
  if (entry === undefined) return failure("inconsistent");
  if (state.status[entryIndex] !== 0 || state.terminal) return undefined;
  if (entry === undefined || entry.role === "directory") return failure("inconsistent");
  state.status[entryIndex] = 1;
  const file = entry.relativePath;
  const start = location(1, 1);
  if (!budget(state, "files", 1, file, start)) {
    state.status[entryIndex] = 2;
    return undefined;
  }
  const size = entry.size;
  if (size > MAX_SKILL_DOCUMENT_BYTES_BIGINT) {
    state.status[entryIndex] = 2;
    if (origin === undefined) return failure("too_large");
    readFinding(state, origin, "too_large");
    return undefined;
  }
  const sizeNumber = applyIntrinsic<number>(numberConstructorSnapshot, undefined, [size]);
  if (!safeInteger(sizeNumber, MAX_SKILL_DOCUMENT_BYTES)) return failure("invalid_metadata");
  if (!budget(state, "bytes", sizeNumber, file, start) || !budget(state, "work", 1, file, start)) {
    state.status[entryIndex] = 2;
    return undefined;
  }
  const read = (yield routineCall(readEntry(state, entryIndex, signal))) as ReadResult;
  if (!read.ok) {
    state.status[entryIndex] = 2;
    if (read === failure("invalid_input")) return read;
    if (read.reason === "aborted" || read.reason === "changed") return failure(read.reason);
    if (
      read.reason === "invalid_input" ||
      read.reason === "unsupported_kind" ||
      read.reason === "inconsistent"
    ) {
      return failure("inconsistent");
    }
    if (origin === undefined) return failure(read.reason);
    readFinding(state, origin, read.reason);
    return undefined;
  }
  if (read.byteLength !== sizeNumber) return failure("inconsistent");
  let source = read.text;
  let lineOffset = 0;
  let documentStart = start;
  if (origin === undefined) {
    state.documentText = read.text;
    const projected = invoke(envelopeSnapshot, [read.text]);
    const afterProjection = checkpoint(signal);
    if (afterProjection !== undefined) return afterProjection;
    if (!projected.ok) return failure("inconsistent");
    const envelope = validateEnvelope(projected.value, read.text);
    if (isFailure(envelope)) return envelope;
    if (envelope === undefined) {
      state.graphUnavailable = true;
      state.status[entryIndex] = 2;
      return undefined;
    }
    source = envelope.body;
    lineOffset = envelope.bodyStartLine - 1;
    documentStart = location(envelope.bodyStartLine, 1);
  }
  const analyzed = (yield routineCall(
    analyzeDocument(
      state,
      entry,
      source,
      read.byteLength,
      depth,
      lineOffset,
      documentStart,
      signal,
    ),
  )) as Failure | undefined;
  state.status[entryIndex] = 2;
  return analyzed;
}

function* finalCurrent(state: GraphState, signal: unknown): Routine<Failure | undefined> {
  const settled = (yield asyncCall(currentSessionSnapshot, [
    state.session,
    signal,
  ])) as AsyncSettlement;
  const sampled = checkpoint(signal);
  if (sampled !== undefined) return sampled;
  if (!settled.ok) return failure("inconsistent");
  try {
    if (!isPlainRecord(settled.value)) return failure("inconsistent");
    const ok = ownData(settled.value, "ok");
    if (ok === false) {
      const reason = ownData(settled.value, "reason");
      return reason !== "invalid_input" && listed(reason, SESSION_FAILURES)
        ? failure(reason as ResourceTreeSessionFailureReason)
        : failure("inconsistent");
    }
    if (ok !== true) return failure("inconsistent");
    const current = ownData(settled.value, "current");
    return current === true
      ? replayIntact(state)
        ? undefined
        : failure("inconsistent")
      : current === false
        ? failure("changed")
        : failure("inconsistent");
  } catch {
    return failure("inconsistent");
  }
}
function freezeGraph(state: GraphState): MarkdownResourceGraph {
  return barrier({
    surface: "commonmark-links-images-v1" as const,
    complete: state.complete,
    documents: copy(state.documents),
    edges: copy(state.edges),
    reachableFiles: copy(state.reachableFiles),
    findings: copy(state.findings),
    totals: freeze({
      files: state.totals.files,
      bytes: state.totals.bytes,
      nodes: state.totals.nodes,
      targets: state.totals.targets,
      work: state.totals.work,
      components: state.totals.components,
      aliasCandidates: state.totals.aliasCandidates,
    }),
  });
}

function* build(
  documentValue: unknown,
  signalValue: unknown,
  ioValue: unknown,
): Routine<MarkdownResourceGraphResult> {
  const opened = (yield asyncCall(openSessionSnapshot, [
    documentValue,
    signalValue,
    ioValue,
  ])) as AsyncSettlement;
  const candidate = opened.ok ? normalizedOpen(opened.value) : ABSENT;
  if (isFailure(candidate)) return candidate;
  const afterOpen = checkpoint(signalValue);
  if (afterOpen !== undefined) return afterOpen;
  if (!opened.ok) return failure("inconsistent");
  if (!isPlainRecord(candidate)) return failure("inconsistent");
  const sessionValue = ownData(candidate, "session");
  const genuine = invoke(genuineSessionSnapshot, [sessionValue]);
  const afterPredicate = checkpoint(signalValue);
  if (afterPredicate !== undefined) return afterPredicate;
  if (!genuine.ok || genuine.value !== true) return failure("inconsistent");
  const session = sessionValue as ResourceTreeSession;
  const replay = replaySession(session);
  if (isFailure(replay)) return replay;

  const indexed = invoke(createIndexSnapshot, [session]);
  const afterIndex = checkpoint(signalValue);
  if (afterIndex !== undefined) return afterIndex;
  if (!indexed.ok || !isPlainRecord(indexed.value) || ownData(indexed.value, "ok") !== true) {
    return failure("inconsistent");
  }
  const index = ownData(indexed.value, "index");
  if (!isPlainRecord(index)) return failure("inconsistent");
  const documentIndex = replay.documentIndex;
  const state = initializeState(session, index as ResourceTreePathIndex, replay, documentIndex);
  const resourceFindings = scanBundledResourceNames(state, signalValue);
  if (isFailure(resourceFindings)) return resourceFindings;
  const resourceReplayIntact = replayIntact(state);
  const afterResourceScan = checkpoint(signalValue);
  if (afterResourceScan !== undefined) return afterResourceScan;
  if (!resourceReplayIntact) return failure("inconsistent");
  const visited = (yield routineCall(
    visitDocument(state, documentIndex, 0, undefined, signalValue),
  )) as Failure | undefined;
  if (visited !== undefined) return visited;
  if (state.documentText === undefined) return failure("inconsistent");
  const result: MarkdownResourceGraphResult = state.graphUnavailable
    ? barrier({ ok: true, documentText: state.documentText, resourceFindings })
    : barrier({
        ok: true,
        documentText: state.documentText,
        resourceFindings,
        graph: freezeGraph(state),
      });
  const currentFailure = (yield routineCall(finalCurrent(state, signalValue))) as
    | Failure
    | undefined;
  if (currentFailure !== undefined) return currentFailure;
  return result;
}

/** Build a bounded, inert graph through one retained two-pass resource-tree session. */
export async function buildInspectedMarkdownResourceGraph(
  documentValue: unknown,
  signalValue: unknown = undefined,
  ioValue: unknown = undefined,
): Promise<MarkdownResourceGraphResult> {
  try {
    if (!promisePrototypeIntact()) return failure("inconsistent");
    const stack = new arrayConstructorSnapshot<Routine>();
    defineSlot(stack, 0, build(documentValue, signalValue, ioValue));
    let depth = 1;
    let input: unknown;
    while (depth > 0) {
      const routine = stack[depth - 1] as Routine;
      const step = applyIntrinsic<IteratorResult<Effect, unknown>>(generatorNextSnapshot, routine, [
        input,
      ]);
      input = undefined;
      if (step.done) {
        depth -= 1;
        if (depth === 0) return step.value as MarkdownResourceGraphResult;
        input = step.value;
        continue;
      }
      const effect = step.value;
      if (effect.kind === "routine") {
        defineSlot(stack, depth, effect.routine);
        depth += 1;
        continue;
      }
      let promiseValue: unknown;
      try {
        promiseValue = applyIntrinsic(effect.intrinsic, undefined, effect.args as unknown[]);
      } catch {
        input = SETTLEMENT_FAILURE;
        continue;
      }
      if (!authenticPromise(promiseValue)) {
        input = SETTLEMENT_FAILURE;
        continue;
      }
      try {
        input = barrier({ ok: true, value: await promiseValue } as const);
      } catch {
        input = SETTLEMENT_FAILURE;
      }
    }
    return failure("inconsistent");
  } catch {
    return checkpoint(signalValue) ?? failure("inconsistent");
  }
}
