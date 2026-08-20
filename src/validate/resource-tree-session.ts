import { Buffer } from "node:buffer";
import { join } from "node:path";
import { types } from "node:util";

import { sampleAbortSignal, type AbortSignalSample } from "./abort-signal.js";
import {
  type CapturedResourceTreeEntry,
  type CapturedResourceTreeRoot,
  captureInspectedResourceTree,
  type ResourceTreeCaptureFailureReason,
  type ResourceTreeCaptureResult,
} from "./resource-tree-capture.js";
import { compareResourceTreeCaptureSemantics } from "./resource-tree-comparison.js";
import { type InspectedFile, readInspectedUtf8File } from "./file-read.js";
import { type FileMetadataSnapshot, snapshotFileMetadata } from "./file-metadata.js";
import { MAX_RESOURCE_TREE_ENTRIES } from "./resource-tree-layout.js";
import {
  type ResourceTreeSessionIo,
  snapshotResourceTreeSessionIo,
} from "./resource-tree-session-io.js";
import { isGenuineDocumentInspection } from "./skill-document.js";
import type { DocumentInspection } from "./skill-document-read.js";
import { MAX_SKILL_DOCUMENT_BYTES } from "./types.js";

declare const resourceTreeSessionBrand: unique symbol;
type ResourceTreeSessionBrand = { readonly [resourceTreeSessionBrand]: true };

export type ResourceTreeSession = Readonly<{
  root: CapturedResourceTreeRoot;
  entries: readonly CapturedResourceTreeEntry[];
}> &
  ResourceTreeSessionBrand;

export type ResourceTreeSessionFailureReason = ResourceTreeCaptureFailureReason;

export type ResourceTreeSessionFailure = Readonly<{
  ok: false;
  reason: ResourceTreeSessionFailureReason;
}>;

export type ResourceTreeSessionOpenResult =
  | Readonly<{ ok: true; session: ResourceTreeSession }>
  | ResourceTreeSessionFailure;

export type ResourceTreeSessionCurrentResult =
  | Readonly<{ ok: true; current: boolean }>
  | ResourceTreeSessionFailure;

export type ResourceTreeSessionMemberReadFailureReason =
  | "invalid_input"
  | "aborted"
  | "changed"
  | "unsupported_kind"
  | "too_large"
  | "invalid_metadata"
  | "invalid_read"
  | "invalid_utf8"
  | "inconsistent"
  | "io";

export type ResourceTreeSessionMemberReadResult =
  | Readonly<{ ok: true; text: string; byteLength: number }>
  | Readonly<{ ok: false; reason: ResourceTreeSessionMemberReadFailureReason }>;

type CaptureSuccess = Extract<ResourceTreeCaptureResult, Readonly<{ ok: true }>>;
type CaptureObservation =
  | Readonly<{ ok: true; capture: CaptureSuccess }>
  | ResourceTreeSessionFailure;
type SessionContext = Readonly<{
  document: DocumentInspection;
  io: ResourceTreeSessionIo;
  baseline: CaptureSuccess;
  members: WeakMap<object, SessionMember>;
}>;
type SessionMember = Readonly<{
  role: CapturedResourceTreeEntry["role"];
  relativePath: string;
  metadata: FileMetadataSnapshot;
}>;
type SessionOpen = ResourceTreeSessionOpenResult;
type PreparedSession = readonly [ResourceTreeSession, SessionContext, SessionOpen];
type SignalFailure = Readonly<{ ok: false; reason: "invalid_input" | "aborted" }>;

// Module initialization is the trust boundary for producers, brands, and intrinsics below.
const applySnapshot = Reflect.apply;
const arrayConstructorSnapshot = Array;
const objectConstructorSnapshot = Object;
const arrayIsArraySnapshot = arrayConstructorSnapshot.isArray;
const bufferByteLengthSnapshot = Buffer.byteLength;
const definePropertySnapshot = objectConstructorSnapshot.defineProperty;
const freezeSnapshot = objectConstructorSnapshot.freeze;
const getOwnPropertyDescriptorSnapshot = objectConstructorSnapshot.getOwnPropertyDescriptor;
const getPrototypeOfSnapshot = objectConstructorSnapshot.getPrototypeOf;
const isProxySnapshot = types.isProxy;
const isPromiseSnapshot = types.isPromise;
const isSafeIntegerSnapshot = Number.isSafeInteger;
const joinSnapshot = join;
const metadataSnapshot = snapshotFileMetadata;
const objectIsSnapshot = objectConstructorSnapshot.is;
const promiseConstructorSnapshot = Promise;
const promisePrototypeSnapshot = promiseConstructorSnapshot.prototype;
const readSnapshot = readInspectedUtf8File;
const weakMapGetSnapshot = WeakMap.prototype.get;
const weakMapHasSnapshot = WeakMap.prototype.has;
const weakMapSetSnapshot = WeakMap.prototype.set;
const weakMapConstructorSnapshot = WeakMap;
const captureSnapshot = captureInspectedResourceTree;
const compareSnapshot = compareResourceTreeCaptureSemantics;
const documentPredicateSnapshot = isGenuineDocumentInspection;
const ioSnapshot = snapshotResourceTreeSessionIo;
const signalSnapshot = sampleAbortSignal;
const sessionContexts = new WeakMap<object, SessionContext>();

function applyIntrinsic<T>(
  intrinsic: (...argumentsList: never[]) => unknown,
  receiver: unknown,
  argumentsList: unknown[],
): T {
  return applySnapshot(intrinsic, receiver, argumentsList) as T;
}

function freezeBarrier<T extends object>(value: T): Readonly<T> {
  applyIntrinsic<object>(definePropertySnapshot, objectConstructorSnapshot, [
    value,
    "then",
    {
      __proto__: null,
      configurable: false,
      enumerable: false,
      value: undefined,
      writable: false,
    },
  ]);
  return freezeSnapshot(value);
}

const fixedFailure = <Reason extends string>(
  reason: Reason,
): Readonly<{ ok: false; reason: Reason }> => freezeBarrier({ ok: false, reason });

const INVALID_INPUT = fixedFailure("invalid_input");
const ABORTED = fixedFailure("aborted");
const CHANGED = fixedFailure("changed");
const INVALID_INVENTORY = fixedFailure("invalid_inventory");
const INVALID_METADATA = fixedFailure("invalid_metadata");
const UNSUPPORTED_KIND = fixedFailure("unsupported_kind");
const TOO_MANY_ENTRIES = fixedFailure("too_many_entries");
const TOO_DEEP = fixedFailure("too_deep");
const PATHS_TOO_LARGE = fixedFailure("paths_too_large");
const INCONSISTENT = fixedFailure("inconsistent");
const IO = fixedFailure("io");
const currentResult = (current: boolean): ResourceTreeSessionCurrentResult =>
  freezeBarrier({ ok: true, current });
const CURRENT_TRUE = currentResult(true);
const CURRENT_FALSE = currentResult(false);

const MEMBER_TOO_LARGE = fixedFailure("too_large");
const MEMBER_INVALID_READ = fixedFailure("invalid_read");
const MEMBER_INVALID_UTF8 = fixedFailure("invalid_utf8");

function failure(reason: unknown): ResourceTreeSessionFailure {
  switch (reason) {
    case "invalid_input":
      return INVALID_INPUT;
    case "aborted":
      return ABORTED;
    case "changed":
      return CHANGED;
    case "invalid_inventory":
      return INVALID_INVENTORY;
    case "invalid_metadata":
      return INVALID_METADATA;
    case "unsupported_kind":
      return UNSUPPORTED_KIND;
    case "too_many_entries":
      return TOO_MANY_ENTRIES;
    case "too_deep":
      return TOO_DEEP;
    case "paths_too_large":
      return PATHS_TOO_LARGE;
    case "io":
      return IO;
    default:
      return INCONSISTENT;
  }
}

function sample(value: unknown): AbortSignalSample {
  try {
    const observed = applyIntrinsic<AbortSignalSample>(signalSnapshot, undefined, [value]);
    return observed === "absent" || observed === "active" || observed === "aborted"
      ? observed
      : "invalid";
  } catch {
    return "invalid";
  }
}

function sampleFailure(value: unknown): SignalFailure | undefined {
  const observed = sample(value);
  if (observed === "invalid") return INVALID_INPUT;
  return observed === "aborted" ? ABORTED : undefined;
}

function ownDescriptor(value: object, property: PropertyKey): PropertyDescriptor | undefined {
  return applyIntrinsic<PropertyDescriptor | undefined>(
    getOwnPropertyDescriptorSnapshot,
    objectConstructorSnapshot,
    [value, property],
  );
}

function ownData(value: object, property: PropertyKey): unknown {
  const descriptor = ownDescriptor(value, property);
  return descriptor === undefined ? undefined : ownDescriptor(descriptor, "value")?.value;
}

const isPlainRecord = (value: unknown): value is object =>
  typeof value === "object" &&
  value !== null &&
  !applyIntrinsic<boolean>(isProxySnapshot, undefined, [value]);

function isAuthenticPromise(value: unknown): value is Promise<unknown> {
  try {
    if (
      !isPlainRecord(value) ||
      !applyIntrinsic<boolean>(isPromiseSnapshot, undefined, [value]) ||
      applyIntrinsic<object>(getPrototypeOfSnapshot, objectConstructorSnapshot, [value]) !==
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
    const prototypeConstructor = ownDescriptor(promisePrototypeSnapshot, "constructor");
    return (
      prototypeConstructor !== undefined &&
      ownData(prototypeConstructor, "value") === promiseConstructorSnapshot
    );
  } catch {
    return false;
  }
}

function prepareSession(
  capture: CaptureSuccess,
  document: DocumentInspection,
  io: ResourceTreeSessionIo,
): PreparedSession | undefined {
  try {
    const root = ownData(capture, "root");
    const entries = ownData(capture, "entries");
    if (
      !isPlainRecord(root) ||
      !isPlainRecord(entries) ||
      !applyIntrinsic<boolean>(arrayIsArraySnapshot, arrayConstructorSnapshot, [entries])
    ) {
      return undefined;
    }
    const length = ownData(entries, "length");
    if (typeof length !== "number" || length > MAX_RESOURCE_TREE_ENTRIES) {
      return undefined;
    }
    const members = new weakMapConstructorSnapshot<object, SessionMember>();
    let documentCount = 0;
    for (let ordinal = 0; ordinal < length; ordinal += 1) {
      const entry = ownData(entries, ordinal);
      if (!isPlainRecord(entry)) return undefined;
      if (applyIntrinsic<boolean>(weakMapHasSnapshot, members, [entry])) return undefined;
      const role = ownData(entry, "role");
      if (role !== "document" && role !== "resource-file" && role !== "directory") {
        return undefined;
      }
      if (role === "document") documentCount += 1;
      const layout = ownData(entry, "layout");
      const metadataValue = ownData(entry, "metadata");
      if (!isPlainRecord(layout) || !isPlainRecord(metadataValue)) return undefined;
      const entryIndex = ownData(layout, "entryIndex");
      const relativePath = ownData(layout, "relativePath");
      if (!objectIsSnapshot(entryIndex, ordinal) || typeof relativePath !== "string") {
        return undefined;
      }
      const metadata = applyIntrinsic<FileMetadataSnapshot>(metadataSnapshot, undefined, [
        metadataValue,
      ]);
      const expectedKind = role === "directory" ? "directory" : "file";
      if (ownData(metadataValue, "kind") !== metadata.kind || metadata.kind !== expectedKind) {
        return undefined;
      }
      const member = freezeSnapshot({ role, relativePath, metadata });
      applyIntrinsic<WeakMap<object, SessionMember>>(weakMapSetSnapshot, members, [entry, member]);
    }
    if (documentCount !== 1) return undefined;
    const session = freezeBarrier({ root, entries }) as ResourceTreeSession;
    const context = freezeSnapshot({
      document,
      io,
      baseline: capture,
      members: freezeSnapshot(members),
    });
    const result: ResourceTreeSessionOpenResult = freezeBarrier({
      ok: true,
      session,
    });
    return freezeSnapshot([session, context, result] as const);
  } catch {
    return undefined;
  }
}

function normalizeMemberRead(value: unknown): ResourceTreeSessionMemberReadResult {
  try {
    if (!isPlainRecord(value)) return INCONSISTENT;
    const ok = ownData(value, "ok");
    if (ok === true) {
      const text = ownData(value, "text");
      const byteLength = ownData(value, "byteLength");
      if (
        typeof text !== "string" ||
        text.length > MAX_SKILL_DOCUMENT_BYTES ||
        typeof byteLength !== "number" ||
        !isSafeIntegerSnapshot(byteLength) ||
        byteLength < 0 ||
        byteLength > MAX_SKILL_DOCUMENT_BYTES ||
        !objectIsSnapshot(
          applyIntrinsic<number>(bufferByteLengthSnapshot, undefined, [text, "utf8"]),
          byteLength,
        )
      ) {
        return INCONSISTENT;
      }
      return freezeBarrier({ ok: true, text, byteLength });
    }
    if (ok !== false) return INCONSISTENT;
    const reason = ownData(value, "reason");
    switch (reason) {
      case "too-large":
        return MEMBER_TOO_LARGE;
      case "invalid-metadata":
        return INVALID_METADATA;
      case "invalid-read":
        return MEMBER_INVALID_READ;
      case "invalid-utf8":
        return MEMBER_INVALID_UTF8;
      case "io":
        return IO;
      case "changed": {
        const subject = ownData(value, "subject");
        const phase = ownData(value, "phase");
        const contextChanged =
          subject === "context" && (phase === "before-open" || phase === "reading");
        const fileChanged =
          subject === "file" &&
          (phase === "before-open" || phase === "opening" || phase === "reading");
        return contextChanged || fileChanged ? CHANGED : INCONSISTENT;
      }
      default:
        return INCONSISTENT;
    }
  } catch {
    return INCONSISTENT;
  }
}

function normalizeCapture(value: unknown): CaptureSuccess | ResourceTreeSessionFailure {
  try {
    if (
      typeof value !== "object" ||
      value === null ||
      applyIntrinsic<boolean>(isProxySnapshot, undefined, [value])
    ) {
      return INCONSISTENT;
    }
    const ok = ownData(value, "ok");
    if (ok === false) return failure(ownData(value, "reason"));
    if (
      ok !== true ||
      ownData(value, "root") === undefined ||
      ownData(value, "entries") === undefined
    ) {
      return INCONSISTENT;
    }
    return value as CaptureSuccess;
  } catch {
    return INCONSISTENT;
  }
}

async function observeCapture(
  document: DocumentInspection,
  signal: unknown,
  io: ResourceTreeSessionIo,
): Promise<CaptureObservation> {
  let settled: unknown;
  let rejected = false;
  try {
    settled = await applyIntrinsic<Promise<ResourceTreeCaptureResult>>(captureSnapshot, undefined, [
      document,
      signal,
      io,
    ]);
  } catch {
    rejected = true;
  }
  if (rejected) return INCONSISTENT;
  const normalized = normalizeCapture(settled);
  return normalized.ok ? freezeBarrier({ ok: true, capture: normalized }) : normalized;
}

function compare(left: CaptureSuccess, right: CaptureSuccess): "equal" | "different" | "invalid" {
  try {
    const result = applyIntrinsic<unknown>(compareSnapshot, undefined, [left, right]);
    return result === "equal" || result === "different" ? result : "invalid";
  } catch {
    return "invalid";
  }
}

function contextOf(value: unknown): SessionContext | undefined {
  if ((typeof value !== "object" && typeof value !== "function") || value === null)
    return undefined;
  return applyIntrinsic<SessionContext | undefined>(weakMapGetSnapshot, sessionContexts, [value]);
}

/** Accept only session identities registered after two equal observations; no properties are read. */
export function isGenuineResourceTreeSession(value: unknown): value is ResourceTreeSession {
  if ((typeof value !== "object" && typeof value !== "function") || value === null) return false;
  return applyIntrinsic<boolean>(weakMapHasSnapshot, sessionContexts, [value]);
}

/** Observe twice through one caller-trusted adapter; the brand grants no lasting/openat authority. */
export async function openInspectedResourceTreeSession(
  documentValue: unknown,
  signalValue: unknown = undefined,
  ioValue: unknown = undefined,
): Promise<ResourceTreeSessionOpenResult> {
  try {
    if (!applyIntrinsic<boolean>(documentPredicateSnapshot, undefined, [documentValue])) {
      return INVALID_INPUT;
    }
  } catch {
    return INVALID_INPUT;
  }
  const document = documentValue as DocumentInspection;
  const initial = sample(signalValue);
  if (initial === "invalid") return INVALID_INPUT;
  let io: ResourceTreeSessionIo | undefined;
  try {
    io = applyIntrinsic<ResourceTreeSessionIo | undefined>(ioSnapshot, undefined, [ioValue]);
  } catch {
    return IO;
  }
  if (io === undefined) return IO;
  if (initial === "aborted") return ABORTED;

  const first = await observeCapture(document, signalValue, io);
  const firstCheckpoint = sampleFailure(signalValue);
  if (firstCheckpoint !== undefined) return firstCheckpoint;
  if (!first.ok) return first;
  const second = await observeCapture(document, signalValue, io);
  const secondCheckpoint = sampleFailure(signalValue);
  if (secondCheckpoint !== undefined) return secondCheckpoint;
  if (!second.ok) return second;
  const comparison = compare(first.capture, second.capture);
  if (comparison !== "equal") {
    const finalCheckpoint = sampleFailure(signalValue);
    if (finalCheckpoint !== undefined) return finalCheckpoint;
    return comparison === "different" ? CHANGED : INCONSISTENT;
  }

  const prepared = prepareSession(second.capture, document, io);
  if (prepared === undefined) {
    const finalCheckpoint = sampleFailure(signalValue);
    return finalCheckpoint ?? INCONSISTENT;
  }
  const preparedSession = prepared[0];
  const preparedContext = prepared[1];
  const preparedResult = prepared[2];
  const finalCheckpoint = sampleFailure(signalValue);
  if (finalCheckpoint !== undefined) return finalCheckpoint;
  applyIntrinsic<WeakMap<object, SessionContext>>(weakMapSetSnapshot, sessionContexts, [
    preparedSession,
    preparedContext,
  ]);
  return preparedResult;
}

/** Re-observe a genuine session through its retained adapter without updating the baseline. */
export async function resourceTreeSessionIsCurrent(
  sessionValue: unknown,
  signalValue: unknown = undefined,
): Promise<ResourceTreeSessionCurrentResult> {
  const context = contextOf(sessionValue);
  if (context === undefined) return INVALID_INPUT;
  const initialFailure = sampleFailure(signalValue);
  if (initialFailure !== undefined) return initialFailure;
  const fresh = await observeCapture(context.document, signalValue, context.io);
  const captureCheckpoint = sampleFailure(signalValue);
  if (captureCheckpoint !== undefined) return captureCheckpoint;
  if (!fresh.ok) return fresh;
  const comparison = compare(context.baseline, fresh.capture);
  const finalCheckpoint = sampleFailure(signalValue);
  if (finalCheckpoint !== undefined) return finalCheckpoint;
  if (comparison === "invalid") return INCONSISTENT;
  return comparison === "equal" ? CURRENT_TRUE : CURRENT_FALSE;
}

/** Read one exact captured member; the session and retained adapter grant no lasting freshness. */
export async function readResourceTreeSessionUtf8Member(
  sessionValue: unknown,
  entryValue: unknown,
  signalValue: unknown = undefined,
): Promise<ResourceTreeSessionMemberReadResult> {
  const context = contextOf(sessionValue);
  if (context === undefined) return INVALID_INPUT;
  let member: SessionMember | undefined;
  try {
    member = applyIntrinsic<SessionMember | undefined>(weakMapGetSnapshot, context.members, [
      entryValue,
    ]);
  } catch {
    return INVALID_INPUT;
  }
  if (member === undefined) return INVALID_INPUT;
  const initialFailure = sampleFailure(signalValue);
  if (initialFailure !== undefined) return initialFailure;
  if (member.role === "directory") return UNSUPPORTED_KIND;

  let inspected: InspectedFile;
  let root: DocumentInspection["root"];
  let rootIsCurrent: ResourceTreeSessionIo["rootIsCurrent"];
  try {
    root = context.document.root;
    const path = applyIntrinsic<unknown>(joinSnapshot, undefined, [root.path, member.relativePath]);
    if (
      typeof path !== "string" ||
      (member.role === "document" && path !== context.document.path)
    ) {
      return INCONSISTENT;
    }
    inspected = freezeSnapshot({
      path,
      metadata: member.metadata,
    });
    rootIsCurrent = context.io.rootIsCurrent;
  } catch {
    return INCONSISTENT;
  }

  let stickyFailure: SignalFailure | undefined;
  const inspectionIsCurrent = async (): Promise<boolean> => {
    const before = sampleFailure(signalValue);
    if (before !== undefined) {
      stickyFailure ??= before;
      return false;
    }
    let current: unknown;
    let rejection: unknown;
    let rootRejected = false;
    try {
      current = await applyIntrinsic<Promise<boolean>>(rootIsCurrent, undefined, [root]);
    } catch (error) {
      rejection = error;
      rootRejected = true;
    }
    const after = sampleFailure(signalValue);
    if (after !== undefined) stickyFailure ??= after;
    if (stickyFailure !== undefined) return false;
    if (rootRejected) throw rejection;
    return current === true;
  };

  let promiseValue: unknown;
  let callFailed = false;
  try {
    promiseValue = applyIntrinsic<unknown>(readSnapshot, undefined, [
      inspected,
      MAX_SKILL_DOCUMENT_BYTES,
      inspectionIsCurrent,
      context.io,
    ]);
  } catch {
    callFailed = true;
  }
  const authenticPromise = !callFailed && isAuthenticPromise(promiseValue);
  let settled: unknown;
  let rejected = false;
  if (authenticPromise) {
    try {
      settled = await (promiseValue as Promise<unknown>);
    } catch {
      rejected = true;
    }
  }
  const finalFailure = sampleFailure(signalValue);
  if (stickyFailure !== undefined) return stickyFailure;
  if (finalFailure !== undefined) return finalFailure;
  if (callFailed || !authenticPromise || rejected) return INCONSISTENT;
  return normalizeMemberRead(settled);
}
