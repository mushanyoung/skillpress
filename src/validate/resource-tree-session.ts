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
import {
  type ResourceTreeSessionIo,
  snapshotResourceTreeSessionIo,
} from "./resource-tree-session-io.js";
import { isGenuineDocumentInspection } from "./skill-document.js";
import type { DocumentInspection } from "./skill-document-read.js";

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

type CaptureSuccess = Extract<ResourceTreeCaptureResult, Readonly<{ ok: true }>>;
type CaptureObservation =
  | Readonly<{ ok: true; capture: CaptureSuccess }>
  | ResourceTreeSessionFailure;
type SessionContext = Readonly<{
  document: DocumentInspection;
  io: ResourceTreeSessionIo;
  baseline: CaptureSuccess;
}>;

// Module initialization is the trust boundary for producers, brands, and intrinsics below.
const applySnapshot = Reflect.apply;
const definePropertySnapshot = Object.defineProperty;
const freezeSnapshot = Object.freeze;
const getOwnPropertyDescriptorSnapshot = Object.getOwnPropertyDescriptor;
const isProxySnapshot = types.isProxy;
const weakMapGetSnapshot = WeakMap.prototype.get;
const weakMapHasSnapshot = WeakMap.prototype.has;
const weakMapSetSnapshot = WeakMap.prototype.set;
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
  applyIntrinsic<object>(definePropertySnapshot, Object, [
    value,
    "then",
    { configurable: false, enumerable: false, value: undefined, writable: false },
  ]);
  return freezeSnapshot(value);
}

function fixedFailure(reason: ResourceTreeSessionFailureReason): ResourceTreeSessionFailure {
  return freezeBarrier({ ok: false, reason });
}

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
const CURRENT_TRUE: ResourceTreeSessionCurrentResult = freezeBarrier({ ok: true, current: true });
const CURRENT_FALSE: ResourceTreeSessionCurrentResult = freezeBarrier({ ok: true, current: false });

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

function sampleFailure(value: unknown): ResourceTreeSessionFailure | undefined {
  const observed = sample(value);
  if (observed === "invalid") return INVALID_INPUT;
  return observed === "aborted" ? ABORTED : undefined;
}

function ownData(value: object, property: PropertyKey): unknown {
  const descriptor = applyIntrinsic<PropertyDescriptor | undefined>(
    getOwnPropertyDescriptorSnapshot,
    Object,
    [value, property],
  );
  if (descriptor === undefined) return undefined;
  const valueDescriptor = applyIntrinsic<PropertyDescriptor | undefined>(
    getOwnPropertyDescriptorSnapshot,
    Object,
    [descriptor, "value"],
  );
  return valueDescriptor?.value;
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

  const session = freezeBarrier({
    root: second.capture.root,
    entries: second.capture.entries,
  }) as ResourceTreeSession;
  const context = freezeSnapshot({ document, io, baseline: second.capture });
  const result: ResourceTreeSessionOpenResult = freezeBarrier({ ok: true, session });
  const finalCheckpoint = sampleFailure(signalValue);
  if (finalCheckpoint !== undefined) return finalCheckpoint;
  applyIntrinsic<WeakMap<object, SessionContext>>(weakMapSetSnapshot, sessionContexts, [
    session,
    context,
  ]);
  return result;
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
