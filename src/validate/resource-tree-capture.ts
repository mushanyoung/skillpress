import { lstat, opendir } from "node:fs/promises";
import { join } from "node:path";

import { sampleAbortSignal, type AbortSignalSample } from "./abort-signal.js";
import {
  type DirectoryNameIndex,
  reprofileDirectoryNameIndexEntry,
} from "./directory-name-index.js";
import {
  type InspectedDirectoryNamesResult,
  type InspectedDirectoryReadIo,
  type RawDirectoryOpenOptions,
  readInspectedDirectoryNames,
} from "./directory-read.js";
import { type FileMetadataSnapshot, sameFileSnapshot } from "./file-metadata.js";
import {
  createResourceTreeLayout,
  type ResourceTreeBudgetToken,
  type ResourceTreeEntryLayout,
  type ResourceTreeLocation,
  type ResourceTreeReservationFailure,
  type ResourceTreeRootLayout,
  reserveResourceTreeChild,
} from "./resource-tree-layout.js";
import {
  type ResourceTreeLstatIo,
  type ResourceTreeLstatResult,
  lstatResourceTreePath,
} from "./resource-tree-lstat.js";
import { isGenuineDocumentInspection } from "./skill-document.js";
import type { DocumentInspection } from "./skill-document-read.js";
import {
  isGenuineRootInspection,
  type RootInspection,
  rootInspectionIsCurrent,
} from "./skill-root.js";

export interface ResourceTreeCaptureIo extends InspectedDirectoryReadIo, ResourceTreeLstatIo {
  readonly rootIsCurrent: (root: RootInspection) => Promise<boolean>;
}

export type CapturedResourceTreeRoot = Readonly<{
  layout: ResourceTreeRootLayout;
  metadata: FileMetadataSnapshot;
  names: DirectoryNameIndex;
}>;

export type CapturedResourceTreeEntry =
  | Readonly<{
      role: "document";
      layout: ResourceTreeEntryLayout;
      metadata: FileMetadataSnapshot;
    }>
  | Readonly<{
      role: "resource-file";
      layout: ResourceTreeEntryLayout;
      metadata: FileMetadataSnapshot;
    }>
  | Readonly<{
      role: "directory";
      layout: ResourceTreeEntryLayout;
      metadata: FileMetadataSnapshot;
      names: DirectoryNameIndex;
    }>;

export type ResourceTreeCaptureFailureReason =
  | "invalid_input"
  | "aborted"
  | "changed"
  | "invalid_inventory"
  | "invalid_metadata"
  | "unsupported_kind"
  | "too_many_entries"
  | "too_deep"
  | "paths_too_large"
  | "inconsistent"
  | "io";

type ResourceTreeCaptureFailure = Readonly<{
  ok: false;
  reason: ResourceTreeCaptureFailureReason;
}>;

export type ResourceTreeCaptureResult =
  | Readonly<{
      ok: true;
      root: CapturedResourceTreeRoot;
      entries: readonly CapturedResourceTreeEntry[];
    }>
  | ResourceTreeCaptureFailure;

type DirectoryReadFailure = Exclude<InspectedDirectoryNamesResult, Readonly<{ ok: true }>>;
type DirectoryCaptureResult =
  | Readonly<{ ok: true; names: DirectoryNameIndex; metadata: FileMetadataSnapshot }>
  | ResourceTreeCaptureFailure;
type MetadataCaptureResult =
  | Readonly<{ ok: true; metadata: FileMetadataSnapshot }>
  | ResourceTreeCaptureFailure;
type BoundedResult<T> = Readonly<{ ok: true; value: T }> | ResourceTreeCaptureFailure;

// Module initialization is the trust boundary for native bindings, producers, and intrinsics.
const applySnapshot = Reflect.apply;
const definePropertySnapshot = Object.defineProperty;
const freezeSnapshot = Object.freeze;
const getOwnPropertyDescriptorSnapshot = Object.getOwnPropertyDescriptor;
const joinSnapshot = join;
const lstatBuiltinSnapshot = lstat;
const opendirBuiltinSnapshot = opendir as unknown as ResourceTreeCaptureIo["openDirectory"];
const sampleAbortSignalSnapshot = sampleAbortSignal;
const sameFileSnapshotSnapshot = sameFileSnapshot;
const isGenuineDocumentInspectionSnapshot = isGenuineDocumentInspection;
const isGenuineRootInspectionSnapshot = isGenuineRootInspection;
const rootInspectionIsCurrentSnapshot = rootInspectionIsCurrent;
const readInspectedDirectoryNamesSnapshot = readInspectedDirectoryNames;
const reprofileDirectoryNameIndexEntrySnapshot = reprofileDirectoryNameIndexEntry;
const createResourceTreeLayoutSnapshot = createResourceTreeLayout;
const reserveResourceTreeChildSnapshot = reserveResourceTreeChild;
const lstatResourceTreePathSnapshot = lstatResourceTreePath;
const BIGINT_LSTAT_OPTIONS = freezeSnapshot({ bigint: true as const });

const DEFAULT_IO: ResourceTreeCaptureIo = freezeSnapshot({
  lstatPath: (path: string) => lstatBuiltinSnapshot(path, BIGINT_LSTAT_OPTIONS),
  openDirectory: (path: string, options: RawDirectoryOpenOptions) =>
    opendirBuiltinSnapshot(path, options),
  rootIsCurrent: (root: RootInspection) => rootInspectionIsCurrentSnapshot(root),
});

function fixedFailure(reason: ResourceTreeCaptureFailureReason): ResourceTreeCaptureFailure {
  return freezeSnapshot({ ok: false, reason });
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

function applyIntrinsic<T>(
  intrinsic: (...argumentsList: never[]) => unknown,
  receiver: unknown,
  args: unknown[],
): T {
  return applySnapshot(intrinsic, receiver, args) as T;
}

function getOwnDescriptor(value: object, property: PropertyKey): PropertyDescriptor | undefined {
  return applyIntrinsic<PropertyDescriptor | undefined>(getOwnPropertyDescriptorSnapshot, Object, [
    value,
    property,
  ]);
}

function appendOwnDataSlot<T>(values: T[], value: T): void {
  applyIntrinsic<T[]>(definePropertySnapshot, Object, [
    values,
    values.length,
    { configurable: true, enumerable: true, value, writable: true },
  ]);
}

function sampleSignal(value: unknown): AbortSignalSample {
  try {
    return applyIntrinsic<AbortSignalSample>(sampleAbortSignalSnapshot, undefined, [value]);
  } catch {
    return "invalid";
  }
}

function ownCallable<T>(value: unknown, property: PropertyKey): T | undefined {
  if ((typeof value !== "object" && typeof value !== "function") || value === null) {
    return undefined;
  }
  try {
    const descriptor = getOwnDescriptor(value, property);
    if (descriptor === undefined) return undefined;
    const valueDescriptor = getOwnDescriptor(descriptor, "value");
    if (valueDescriptor === undefined || typeof valueDescriptor.value !== "function") {
      return undefined;
    }
    return valueDescriptor.value as T;
  } catch {
    return undefined;
  }
}

function captureIo(value: unknown): ResourceTreeCaptureIo | undefined {
  const lstatPath = ownCallable<ResourceTreeCaptureIo["lstatPath"]>(value, "lstatPath");
  if (lstatPath === undefined) return undefined;
  const openDirectory = ownCallable<ResourceTreeCaptureIo["openDirectory"]>(value, "openDirectory");
  if (openDirectory === undefined) return undefined;
  const rootIsCurrent = ownCallable<ResourceTreeCaptureIo["rootIsCurrent"]>(value, "rootIsCurrent");
  if (rootIsCurrent === undefined) return undefined;
  return freezeSnapshot({ lstatPath, openDirectory, rootIsCurrent });
}

function directoryFailure(value: DirectoryReadFailure): ResourceTreeCaptureFailure {
  switch (value.reason) {
    case "changed":
      return CHANGED;
    case "invalid-inspection":
      return INCONSISTENT;
    case "invalid-metadata":
      return INVALID_METADATA;
    case "too-many-entries":
      return TOO_MANY_ENTRIES;
    case "invalid-read":
    case "name-too-large":
    case "invalid-name-encoding":
    case "name-index":
      return INVALID_INVENTORY;
    case "io":
      return IO;
  }
}

function reservationFailure(value: ResourceTreeReservationFailure): ResourceTreeCaptureFailure {
  switch (value.reason) {
    case "too_many_entries":
      return TOO_MANY_ENTRIES;
    case "too_deep":
      return TOO_DEEP;
    case "paths_too_large":
      return PATHS_TOO_LARGE;
    case "invalid_input":
    case "invalid_state":
    case "duplicate_path":
      return INCONSISTENT;
  }
}

function lstatFailure(
  value: Exclude<ResourceTreeLstatResult, Readonly<{ ok: true }>>,
): ResourceTreeCaptureFailure {
  switch (value.reason) {
    case "invalid_input":
      return INVALID_INPUT;
    case "aborted":
      return ABORTED;
    case "invalid_metadata":
      return INVALID_METADATA;
    case "io":
      return IO;
  }
}

function sameKindAndSnapshot(
  expected: FileMetadataSnapshot,
  actual: FileMetadataSnapshot,
  kind: FileMetadataSnapshot["kind"],
): boolean {
  return (
    actual.kind === kind &&
    applyIntrinsic<boolean>(sameFileSnapshotSnapshot, undefined, [expected, actual])
  );
}

async function captureMetadata(
  path: string,
  signal: unknown,
  io: ResourceTreeCaptureIo,
): Promise<MetadataCaptureResult> {
  const result = await applyIntrinsic<Promise<ResourceTreeLstatResult>>(
    lstatResourceTreePathSnapshot,
    undefined,
    [path, signal, io],
  );
  return result.ok ? result : lstatFailure(result);
}

async function boundedAwait<T>(
  signal: unknown,
  callback: (...argumentsList: never[]) => unknown,
  args: unknown[],
): Promise<BoundedResult<T>> {
  const before = sampleSignal(signal);
  if (before === "invalid") return INVALID_INPUT;
  if (before === "aborted") return ABORTED;
  let value: T | undefined;
  let rejected = false;
  try {
    value = await applyIntrinsic<Promise<T>>(callback, undefined, args);
  } catch {
    rejected = true;
  }
  const after = sampleSignal(signal);
  if (after === "invalid") return INVALID_INPUT;
  if (after === "aborted") return ABORTED;
  if (rejected) return IO;
  return freezeSnapshot({ ok: true, value: value as T });
}

async function captureDirectory(
  path: string,
  metadata: FileMetadataSnapshot,
  signal: unknown,
  io: ResourceTreeCaptureIo,
  contextIsCurrent: () => Promise<boolean>,
): Promise<DirectoryCaptureResult> {
  const bounded = await boundedAwait<InspectedDirectoryNamesResult>(
    signal,
    readInspectedDirectoryNamesSnapshot,
    [freezeSnapshot({ path, metadata }), contextIsCurrent, io],
  );
  if (!bounded.ok) return bounded;
  const result = bounded.value;
  return result.ok
    ? freezeSnapshot({ ok: true, names: result.names, metadata: result.directory.metadata })
    : directoryFailure(result);
}

async function captureFinalRootCurrent(
  root: RootInspection,
  signal: unknown,
  io: ResourceTreeCaptureIo,
): Promise<ResourceTreeCaptureFailure | undefined> {
  const bounded = await boundedAwait<unknown>(signal, io.rootIsCurrent, [root]);
  if (!bounded.ok) return bounded;
  return bounded.value === true ? undefined : CHANGED;
}

interface CaptureState {
  readonly document: DocumentInspection;
  readonly signal: unknown;
  readonly io: ResourceTreeCaptureIo;
  readonly contextIsCurrent: () => Promise<boolean>;
  readonly entries: CapturedResourceTreeEntry[];
  budget: ResourceTreeBudgetToken;
  seenDocument: boolean;
}

function appendEntry(state: CaptureState, entry: CapturedResourceTreeEntry): boolean {
  if (entry.layout.entryIndex !== state.entries.length) return false;
  appendOwnDataSlot(state.entries, entry);
  return true;
}

function hasExactSkillDocument(names: DirectoryNameIndex): boolean {
  for (let ordinal = 0; ordinal < names.entries.length; ordinal += 1) {
    if (names.entries[ordinal]?.exact === "SKILL.md") return true;
  }
  return false;
}

async function captureChildren(
  directoryPath: string,
  parent: ResourceTreeLocation,
  names: DirectoryNameIndex,
  state: CaptureState,
): Promise<ResourceTreeCaptureFailure | undefined> {
  for (let ordinal = 0; ordinal < names.entries.length; ordinal += 1) {
    const reprofiling = applyIntrinsic<ReturnType<typeof reprofileDirectoryNameIndexEntry>>(
      reprofileDirectoryNameIndexEntrySnapshot,
      undefined,
      [names, ordinal],
    );
    if (!reprofiling.ok) return INCONSISTENT;

    const reservation = applyIntrinsic<ReturnType<typeof reserveResourceTreeChildSnapshot>>(
      reserveResourceTreeChildSnapshot,
      undefined,
      [state.budget, parent, reprofiling.profile],
    );
    if (!reservation.ok) return reservationFailure(reservation);
    state.budget = reservation.budget;

    let childPath: string;
    try {
      childPath = applyIntrinsic<string>(joinSnapshot, undefined, [
        directoryPath,
        reprofiling.profile.exact,
      ]);
    } catch {
      return INCONSISTENT;
    }

    const current = await captureMetadata(childPath, state.signal, state.io);
    if (!current.ok) return current;
    const layout = reservation.entry;
    const metadata = current.metadata;
    const isDocument = parent.entryIndex === null && reprofiling.profile.exact === "SKILL.md";

    if (isDocument) {
      if (childPath !== state.document.path) return INCONSISTENT;
      if (!sameKindAndSnapshot(state.document.metadata, metadata, "file")) {
        return CHANGED;
      }
      const entry = freezeSnapshot({ role: "document" as const, layout, metadata });
      if (!appendEntry(state, entry) || state.seenDocument) return INCONSISTENT;
      state.seenDocument = true;
      continue;
    }

    if (metadata.kind === "file") {
      const entry = freezeSnapshot({ role: "resource-file" as const, layout, metadata });
      if (!appendEntry(state, entry)) return INCONSISTENT;
      continue;
    }
    if (metadata.kind !== "directory") return UNSUPPORTED_KIND;

    const captured = await captureDirectory(
      childPath,
      metadata,
      state.signal,
      state.io,
      state.contextIsCurrent,
    );
    if (!captured.ok) return captured;
    const entry = freezeSnapshot({
      role: "directory" as const,
      layout,
      metadata,
      names: captured.names,
    });
    if (!appendEntry(state, entry)) return INCONSISTENT;

    const descendantFailure = await captureChildren(childPath, layout, captured.names, state);
    if (descendantFailure !== undefined) return descendantFailure;
    const after = await captureMetadata(childPath, state.signal, state.io);
    if (!after.ok) return after;
    if (!sameKindAndSnapshot(metadata, after.metadata, "directory")) {
      return CHANGED;
    }
  }
  return undefined;
}

/** Capture one deterministic, bounded DFS resource tree without granting traversal authority. */
export async function captureInspectedResourceTree(
  documentValue: unknown,
  signalValue: unknown = undefined,
  io: ResourceTreeCaptureIo = DEFAULT_IO,
): Promise<ResourceTreeCaptureResult> {
  if (!applyIntrinsic<boolean>(isGenuineDocumentInspectionSnapshot, undefined, [documentValue])) {
    return INVALID_INPUT;
  }
  const document = documentValue as DocumentInspection;
  let root: RootInspection;
  try {
    root = document.root;
  } catch {
    return INCONSISTENT;
  }
  if (!applyIntrinsic<boolean>(isGenuineRootInspectionSnapshot, undefined, [root])) {
    return INVALID_INPUT;
  }
  try {
    if (
      applyIntrinsic<string>(joinSnapshot, undefined, [root.path, "SKILL.md"]) !== document.path
    ) {
      return INCONSISTENT;
    }
  } catch {
    return INCONSISTENT;
  }

  const initial = sampleSignal(signalValue);
  if (initial === "invalid") return INVALID_INPUT;
  const capturedIo = captureIo(io);
  if (capturedIo === undefined) return IO;
  if (initial === "aborted") return ABORTED;

  try {
    const contextIsCurrent = () =>
      applyIntrinsic<Promise<boolean>>(capturedIo.rootIsCurrent, undefined, [root]);
    const rootDirectory = await captureDirectory(
      root.path,
      root.metadata,
      signalValue,
      capturedIo,
      contextIsCurrent,
    );
    if (!rootDirectory.ok) return rootDirectory;
    if (!hasExactSkillDocument(rootDirectory.names)) return CHANGED;

    const layout = applyIntrinsic<ReturnType<typeof createResourceTreeLayoutSnapshot>>(
      createResourceTreeLayoutSnapshot,
      undefined,
      [],
    );
    const state: CaptureState = {
      document,
      signal: signalValue,
      io: capturedIo,
      contextIsCurrent,
      entries: [],
      budget: layout.budget,
      seenDocument: false,
    };
    const descendantFailure = await captureChildren(
      root.path,
      layout.root,
      rootDirectory.names,
      state,
    );
    if (descendantFailure !== undefined) return descendantFailure;
    if (!state.seenDocument) return CHANGED;

    const rootAfter = await captureMetadata(root.path, signalValue, capturedIo);
    if (!rootAfter.ok) return rootAfter;
    if (!sameKindAndSnapshot(rootDirectory.metadata, rootAfter.metadata, "directory")) {
      return CHANGED;
    }

    const documentAfter = await captureMetadata(document.path, signalValue, capturedIo);
    if (!documentAfter.ok) return documentAfter;
    if (!sameKindAndSnapshot(document.metadata, documentAfter.metadata, "file")) {
      return CHANGED;
    }

    const finalCurrentFailure = await captureFinalRootCurrent(root, signalValue, capturedIo);
    if (finalCurrentFailure !== undefined) return finalCurrentFailure;

    const capturedRoot: CapturedResourceTreeRoot = freezeSnapshot({
      layout: layout.root,
      metadata: rootDirectory.metadata,
      names: rootDirectory.names,
    });
    return freezeSnapshot({
      ok: true,
      root: capturedRoot,
      entries: freezeSnapshot(state.entries),
    });
  } catch {
    return INCONSISTENT;
  }
}
