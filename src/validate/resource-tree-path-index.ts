import { Buffer } from "node:buffer";
import { types } from "node:util";

import {
  type DirectoryNameIndex,
  type DirectoryNameLookupResult,
  lookupDirectoryName,
  MAX_DIRECTORY_NAME_INDEX_ENTRIES,
  reprofileDirectoryNameIndexEntry,
} from "./directory-name-index.js";
import {
  isCanonicalDecodedMarkdownLocalComponent,
  MAX_SKILL_REFERENCE_DESTINATION_BYTES,
  MAX_SKILL_REFERENCE_PATH_COMPONENTS,
} from "./markdown-destination.js";
import {
  isResourceNameProfileResult,
  profileObservedResourceName,
  type ResourceNameProfile,
  type ResourceNameProfileResult,
} from "./resource-name-profile.js";
import {
  createResourceTreeLayout,
  MAX_RESOURCE_TREE_ENTRIES,
  type ResourceTreeBudgetToken,
  type ResourceTreeLocation,
  reserveResourceTreeChild,
} from "./resource-tree-layout.js";
import { isGenuineResourceTreeSession } from "./resource-tree-session.js";
declare const resourceTreePathIndexBrand: unique symbol;
export type ResourceTreePathIndex = Readonly<{
  readonly [resourceTreePathIndexBrand]: true;
}>;
export type ResourceTreePathIndexBuildResult =
  | Readonly<{ ok: true; index: ResourceTreePathIndex }>
  | Readonly<{ ok: false; reason: "invalid_input" | "inconsistent" }>;
export type ResourceTreePathResolutionResult =
  | Readonly<{ ok: true; entryIndex: number }>
  | Readonly<{ ok: false; reason: "invalid_input" | "inconsistent" }>
  | Readonly<{
      ok: false;
      reason: "missing" | "not_directory";
      componentIndex: number;
    }>
  | Readonly<{
      ok: false;
      reason: "noncanonical";
      componentIndex: number;
      match: "nfc" | "fold";
      exact: string;
    }>
  | Readonly<{
      ok: false;
      reason: "ambiguous";
      componentIndex: number;
      match: "nfc" | "fold";
      exacts: readonly string[];
    }>;
type DirectoryContext = Readonly<{
  names: DirectoryNameIndex;
  children: readonly ChildContext[];
}>;
type ChildContext = Readonly<{
  exact: string;
  entryIndex: number;
  directory: DirectoryContext | undefined;
}>;
type PathIndexContext = Readonly<{ root: DirectoryContext }>;
type ArrayView = Readonly<{ value: readonly unknown[]; length: number }>;
type RequestComponent = ResourceNameProfile | typeof IMPOSSIBLE;
interface BuildState {
  readonly entries: ArrayView;
  cursor: number;
  budget: ResourceTreeBudgetToken;
  documentSeen: boolean;
}
// Module initialization is the trust boundary for intrinsics, brands, and pure producers.
const applySnapshot = Reflect.apply;
const arrayConstructorSnapshot = Array;
const arrayIsArraySnapshot = Array.isArray;
const arrayPrototypeSnapshot = Array.prototype;
const bufferByteLengthSnapshot = Buffer.byteLength;
const bufferConstructorSnapshot = Buffer;
const definePropertySnapshot = Object.defineProperty;
const freezeSnapshot = Object.freeze;
const getOwnPropertyDescriptorSnapshot = Object.getOwnPropertyDescriptor;
const getPrototypeOfSnapshot = Object.getPrototypeOf;
const isProxySnapshot = types.isProxy;
const numberConstructorSnapshot = Number;
const numberIsSafeIntegerSnapshot = Number.isSafeInteger;
const objectConstructorSnapshot = Object;
const objectIsSnapshot = Object.is;
const weakMapGetSnapshot = WeakMap.prototype.get;
const weakMapSetSnapshot = WeakMap.prototype.set;
const canonicalComponentSnapshot = isCanonicalDecodedMarkdownLocalComponent;
const createLayoutSnapshot = createResourceTreeLayout;
const genuineSessionSnapshot = isGenuineResourceTreeSession;
const lookupNameSnapshot = lookupDirectoryName;
const profileNameSnapshot = profileObservedResourceName;
const profilePredicateSnapshot = isResourceNameProfileResult;
const reprofileEntrySnapshot = reprofileDirectoryNameIndexEntry;
const reserveChildSnapshot = reserveResourceTreeChild;
const indexContexts = new WeakMap<object, PathIndexContext>();
const ABSENT = freezeSnapshot({});
const IMPOSSIBLE = freezeSnapshot({ impossible: true } as const);
const INVALID_INPUT = freezeSnapshot({ ok: false, reason: "invalid_input" } as const);
const INCONSISTENT = freezeSnapshot({ ok: false, reason: "inconsistent" } as const);
const MISSING_LOOKUP = freezeSnapshot({ ok: false, reason: "missing" } as const);
let lookupProbe: unknown;
try {
  lookupProbe = applySnapshot(profileNameSnapshot, undefined, ["__skillpress_path_probe__"]);
} catch {
  lookupProbe = undefined;
}
function applyIntrinsic<T>(
  intrinsic: (...argumentsList: never[]) => unknown,
  receiver: unknown,
  argumentsList: unknown[],
): T {
  return applySnapshot(intrinsic, receiver, argumentsList) as T;
}
function isRecord(value: unknown): value is object {
  if (typeof value !== "object" || value === null) return false;
  return !applyIntrinsic<boolean>(isProxySnapshot, undefined, [value]);
}
function ownData(value: object, property: PropertyKey): unknown {
  const descriptor = applyIntrinsic<PropertyDescriptor | undefined>(
    getOwnPropertyDescriptorSnapshot,
    objectConstructorSnapshot,
    [value, property],
  );
  if (descriptor === undefined) return ABSENT;
  const valueDescriptor = applyIntrinsic<PropertyDescriptor | undefined>(
    getOwnPropertyDescriptorSnapshot,
    objectConstructorSnapshot,
    [descriptor, "value"],
  );
  return valueDescriptor === undefined ? ABSENT : valueDescriptor.value;
}
function arrayView(value: unknown, maximum: number): ArrayView | undefined {
  if (
    !isRecord(value) ||
    !applyIntrinsic<boolean>(arrayIsArraySnapshot, arrayConstructorSnapshot, [value]) ||
    applyIntrinsic<object | null>(getPrototypeOfSnapshot, objectConstructorSnapshot, [value]) !==
      arrayPrototypeSnapshot
  ) {
    return undefined;
  }
  const length = ownData(value, "length");
  return typeof length === "number" &&
    applyIntrinsic<boolean>(numberIsSafeIntegerSnapshot, numberConstructorSnapshot, [length]) &&
    length >= 0 &&
    length <= maximum
    ? { value: value as readonly unknown[], length }
    : undefined;
}
function slot(view: ArrayView, ordinal: number): unknown {
  return ownData(view.value, ordinal);
}
function append<T>(values: T[], value: T): void {
  applyIntrinsic<T[]>(definePropertySnapshot, objectConstructorSnapshot, [
    values,
    values.length,
    { __proto__: null, configurable: true, enumerable: true, value, writable: true },
  ]);
}
function genuineProfile(value: unknown): value is ResourceNameProfile {
  return (
    applyIntrinsic<boolean>(profilePredicateSnapshot, undefined, [value]) &&
    (value as ResourceNameProfile).ok
  );
}
function genuineProfileResult(value: unknown): value is ResourceNameProfileResult {
  return applyIntrinsic<boolean>(profilePredicateSnapshot, undefined, [value]);
}
function parsedLookup(
  index: DirectoryNameIndex,
  request: ResourceNameProfile,
): DirectoryNameLookupResult | undefined {
  const value = applyIntrinsic<DirectoryNameLookupResult>(lookupNameSnapshot, undefined, [
    index,
    request,
  ]);
  if (!isRecord(value)) return undefined;
  const ok = ownData(value, "ok");
  if (ok === false) return ownData(value, "reason") === "missing" ? MISSING_LOOKUP : undefined;
  if (ok !== true) return undefined;
  const match = ownData(value, "match");
  if (match !== "exact" && match !== "nfc" && match !== "fold") return undefined;
  const exacts = arrayView(ownData(value, "exacts"), MAX_DIRECTORY_NAME_INDEX_ENTRIES);
  if (exacts === undefined || exacts.length === 0) return undefined;
  const copied: string[] = [];
  for (let ordinal = 0; ordinal < exacts.length; ordinal += 1) {
    const exact = slot(exacts, ordinal);
    if (typeof exact !== "string") return undefined;
    append(copied, exact);
  }
  return freezeSnapshot({ ok: true, match, exacts: freezeSnapshot(copied) });
}
function indexedEntries(
  value: unknown,
): Readonly<{ index: DirectoryNameIndex; entries: ArrayView }> | undefined {
  if (!isRecord(value) || !genuineProfile(lookupProbe)) return undefined;
  const index = value as DirectoryNameIndex;
  if (parsedLookup(index, lookupProbe) === undefined) return undefined;
  const entries = arrayView(ownData(index, "entries"), MAX_DIRECTORY_NAME_INDEX_ENTRIES);
  return entries === undefined ? undefined : { index, entries };
}
function sameLayout(value: unknown, expected: ResourceTreeLocation): boolean {
  if (!isRecord(value)) return false;
  const same = (key: keyof ResourceTreeLocation) =>
    applyIntrinsic<boolean>(objectIsSnapshot, undefined, [ownData(value, key), expected[key]]);
  return (
    same("entryIndex") &&
    same("parentIndex") &&
    same("depth") &&
    same("exactName") &&
    same("exactNameByteLength") &&
    same("relativePath") &&
    same("relativePathByteLength")
  );
}
function reserve(
  state: BuildState,
  parent: ResourceTreeLocation,
  profile: ResourceNameProfile,
): ResourceTreeLocation | undefined {
  const value = applyIntrinsic<ReturnType<typeof reserveResourceTreeChild>>(
    reserveChildSnapshot,
    undefined,
    [state.budget, parent, profile],
  );
  if (!value.ok) return undefined;
  state.budget = value.budget;
  return value.entry;
}
function buildDirectory(
  namesValue: unknown,
  parent: ResourceTreeLocation,
  state: BuildState,
): DirectoryContext | undefined {
  const indexed = indexedEntries(namesValue);
  if (indexed === undefined) return undefined;
  const children: ChildContext[] = [];
  for (let ordinal = 0; ordinal < indexed.entries.length; ordinal += 1) {
    const reprofiling = applyIntrinsic<ReturnType<typeof reprofileDirectoryNameIndexEntry>>(
      reprofileEntrySnapshot,
      undefined,
      [indexed.index, ordinal],
    );
    if (!reprofiling.ok || !genuineProfile(reprofiling.profile)) return undefined;
    const profile = reprofiling.profile;
    const expected = reserve(state, parent, profile);
    if (expected === undefined || state.cursor >= state.entries.length) return undefined;
    const candidate = slot(state.entries, state.cursor);
    if (!isRecord(candidate) || !sameLayout(ownData(candidate, "layout"), expected)) {
      return undefined;
    }
    const role = ownData(candidate, "role");
    const isRootDocument = expected.parentIndex === null && expected.exactName === "SKILL.md";
    let directory: DirectoryContext | undefined;
    state.cursor += 1;
    if (role === "directory") {
      if (isRootDocument) return undefined;
      directory = buildDirectory(ownData(candidate, "names"), expected, state);
      if (directory === undefined) return undefined;
    } else if (role === (isRootDocument ? "document" : "resource-file")) {
      if (isRootDocument) state.documentSeen = true;
    } else {
      return undefined;
    }
    append(
      children,
      freezeSnapshot({
        exact: profile.exact,
        entryIndex: expected.entryIndex as number,
        directory,
      }),
    );
  }
  return freezeSnapshot({ names: indexed.index, children: freezeSnapshot(children) });
}
function buildContext(session: object): PathIndexContext | undefined {
  const root = ownData(session, "root");
  const entries = arrayView(ownData(session, "entries"), MAX_RESOURCE_TREE_ENTRIES);
  if (!isRecord(root) || entries === undefined) return undefined;
  const start = applyIntrinsic<ReturnType<typeof createResourceTreeLayout>>(
    createLayoutSnapshot,
    undefined,
    [],
  );
  if (!sameLayout(ownData(root, "layout"), start.root)) {
    return undefined;
  }
  const state: BuildState = {
    entries,
    cursor: 0,
    budget: start.budget,
    documentSeen: false,
  };
  const directory = buildDirectory(ownData(root, "names"), start.root, state);
  return directory !== undefined && state.cursor === entries.length && state.documentSeen
    ? freezeSnapshot({ root: directory })
    : undefined;
}
/**
 * Build an opaque root-relative lookup projection from one genuine session baseline.
 * The projection carries no filesystem, freshness, or reading authority.
 */
export function createResourceTreePathIndex(
  sessionValue: unknown,
): ResourceTreePathIndexBuildResult {
  try {
    if (!applyIntrinsic<boolean>(genuineSessionSnapshot, undefined, [sessionValue])) {
      return INVALID_INPUT;
    }
  } catch {
    return INVALID_INPUT;
  }
  let context: PathIndexContext | undefined;
  try {
    context = isRecord(sessionValue) ? buildContext(sessionValue) : undefined;
  } catch {
    context = undefined;
  }
  if (context === undefined) return INCONSISTENT;
  const index = freezeSnapshot({}) as ResourceTreePathIndex;
  const result = freezeSnapshot({ ok: true, index } as const);
  try {
    applyIntrinsic<WeakMap<object, PathIndexContext>>(weakMapSetSnapshot, indexContexts, [
      index,
      context,
    ]);
    return result;
  } catch {
    return INCONSISTENT;
  }
}
function requestComponents(value: unknown): readonly RequestComponent[] | undefined | null {
  const components = arrayView(value, MAX_SKILL_REFERENCE_PATH_COMPONENTS);
  if (components === undefined || components.length === 0) return undefined;
  const requests: RequestComponent[] = [];
  let pathBytes = components.length - 1;
  for (let ordinal = 0; ordinal < components.length; ordinal += 1) {
    const component = slot(components, ordinal);
    if (typeof component !== "string") return undefined;
    const compatible = applyIntrinsic<unknown>(canonicalComponentSnapshot, undefined, [component]);
    if (compatible === false) return undefined;
    if (compatible !== true) return null;
    const profile = applyIntrinsic<unknown>(profileNameSnapshot, undefined, [component]);
    if (!genuineProfileResult(profile)) return null;
    const byteLength = applyIntrinsic<number>(bufferByteLengthSnapshot, bufferConstructorSnapshot, [
      component,
      "utf8",
    ]);
    let request: RequestComponent;
    if (profile.ok) {
      if (!profile.isNfc || profile.exact !== component || profile.exactByteLength !== byteLength) {
        return null;
      }
      request = profile;
    } else if (profile.reason === "unassigned") {
      request = IMPOSSIBLE;
    } else {
      return null;
    }
    pathBytes += byteLength;
    if (pathBytes > MAX_SKILL_REFERENCE_DESTINATION_BYTES) return undefined;
    append(requests, request);
  }
  return freezeSnapshot(requests);
}
function candidatesBelongToDirectory(
  directory: DirectoryContext,
  exacts: readonly string[],
): boolean {
  let childOrdinal = 0;
  for (let ordinal = 0; ordinal < exacts.length; ordinal += 1) {
    while (
      childOrdinal < directory.children.length &&
      directory.children[childOrdinal]?.exact !== exacts[ordinal]
    ) {
      childOrdinal += 1;
    }
    if (childOrdinal === directory.children.length) return false;
    childOrdinal += 1;
  }
  return true;
}
function aliasFailure(
  lookup: Extract<DirectoryNameLookupResult, Readonly<{ ok: true }>>,
  componentIndex: number,
): ResourceTreePathResolutionResult {
  if (lookup.match === "exact") return INCONSISTENT;
  if (lookup.exacts.length === 1) {
    return freezeSnapshot({
      ok: false,
      reason: "noncanonical",
      componentIndex,
      match: lookup.match,
      exact: lookup.exacts[0] as string,
    });
  }
  return freezeSnapshot({
    ok: false,
    reason: "ambiguous",
    componentIndex,
    match: lookup.match,
    exacts: lookup.exacts,
  });
}
/**
 * Resolve fully validated classifier-compatible components within one opaque snapshot projection.
 * Success returns a non-authoritative entry ordinal; final directories are valid targets.
 */
export function resolveResourceTreePath(
  indexValue: unknown,
  componentsValue: unknown,
): ResourceTreePathResolutionResult {
  let context: PathIndexContext | undefined;
  try {
    context =
      (typeof indexValue === "object" || typeof indexValue === "function") && indexValue !== null
        ? applyIntrinsic<PathIndexContext | undefined>(weakMapGetSnapshot, indexContexts, [
            indexValue,
          ])
        : undefined;
  } catch {
    return INVALID_INPUT;
  }
  if (context === undefined) return INVALID_INPUT;
  let requests: readonly RequestComponent[] | undefined | null;
  try {
    requests = requestComponents(componentsValue);
  } catch {
    return INCONSISTENT;
  }
  if (requests === undefined) return INVALID_INPUT;
  if (requests === null) return INCONSISTENT;

  let directory = context.root;
  try {
    for (let componentIndex = 0; componentIndex < requests.length; componentIndex += 1) {
      const request = requests[componentIndex] as RequestComponent;
      if (request === IMPOSSIBLE) {
        return freezeSnapshot({ ok: false, reason: "missing", componentIndex });
      }
      if (!genuineProfile(request)) return INCONSISTENT;
      const profile = request;
      const lookup = parsedLookup(directory.names, profile);
      if (lookup === undefined) return INCONSISTENT;
      if (!lookup.ok) return freezeSnapshot({ ok: false, reason: "missing", componentIndex });
      if (!candidatesBelongToDirectory(directory, lookup.exacts)) return INCONSISTENT;
      if (lookup.match !== "exact") return aliasFailure(lookup, componentIndex);
      if (lookup.exacts.length !== 1 || lookup.exacts[0] !== profile.exact) return INCONSISTENT;
      let child: ChildContext | undefined;
      for (let ordinal = 0; ordinal < directory.children.length; ordinal += 1) {
        const candidate = directory.children[ordinal] as ChildContext;
        if (candidate.exact === profile.exact) {
          child = candidate;
          break;
        }
      }
      if (child === undefined) return INCONSISTENT;
      if (componentIndex === requests.length - 1) {
        return freezeSnapshot({ ok: true, entryIndex: child.entryIndex });
      }
      if (child.directory === undefined) {
        return freezeSnapshot({ ok: false, reason: "not_directory", componentIndex });
      }
      directory = child.directory;
    }
  } catch {
    return INCONSISTENT;
  }
  return INCONSISTENT;
}
