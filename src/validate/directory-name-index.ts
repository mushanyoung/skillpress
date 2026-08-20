import {
  isResourceNameProfileResult,
  profileObservedResourceName,
  type ResourceNameProfile,
  type ResourceNameProfileFailureReason,
  type ResourceNameProfileResult,
} from "./resource-name-profile.js";

export const MAX_DIRECTORY_NAME_INDEX_ENTRIES = 1_024;
export const MAX_DIRECTORY_NAME_INDEX_FINDINGS = 2_048;

export type DirectoryNameProfileFailureReason = Exclude<
  ResourceNameProfileFailureReason,
  "unsupported_runtime"
>;

export type DirectoryNameProfileFailureCount = Readonly<{
  reason: DirectoryNameProfileFailureReason;
  count: number;
}>;

export type DirectoryNameIndexEntry = Readonly<{
  exact: string;
  exactByteLength: number;
  nfc: string;
  key: string;
  isNfc: boolean;
}>;

export type DirectoryNameNfcGroup = Readonly<{
  nfc: string;
  exacts: readonly string[];
}>;

export type DirectoryNameFoldGroup = Readonly<{
  key: string;
  nfcs: readonly string[];
  exacts: readonly string[];
}>;

export type DirectoryNameNonNfcFinding = Readonly<{
  kind: "non_nfc";
  exact: string;
  nfc: string;
}>;

export type DirectoryNameNfcCollisionFinding = Readonly<{
  kind: "nfc_collision";
  nfc: string;
  exacts: readonly string[];
}>;

export type DirectoryNameFixedFoldCollisionFinding = Readonly<{
  kind: "fixed_fold_collision";
  key: string;
  nfcs: readonly string[];
  exacts: readonly string[];
}>;

export type DirectoryNameIndexFinding =
  | DirectoryNameNonNfcFinding
  | DirectoryNameNfcCollisionFinding
  | DirectoryNameFixedFoldCollisionFinding;

declare const directoryNameIndexBrand: unique symbol;
type DirectoryNameIndexBrand = { readonly [directoryNameIndexBrand]: true };

export type DirectoryNameIndex = Readonly<{
  ok: true;
  entries: readonly DirectoryNameIndexEntry[];
  nfcGroups: readonly DirectoryNameNfcGroup[];
  foldGroups: readonly DirectoryNameFoldGroup[];
  findings: readonly DirectoryNameIndexFinding[];
}> &
  DirectoryNameIndexBrand;

export type DirectoryNameIndexFailureReason =
  | "invalid_input"
  | "too_many_entries"
  | "unsupported_runtime"
  | "profile_failures"
  | "exact_duplicate"
  | "too_many_findings";

export type DirectoryNameIndexFailure =
  | Readonly<{
      ok: false;
      reason: Exclude<DirectoryNameIndexFailureReason, "profile_failures">;
    }>
  | Readonly<{
      ok: false;
      reason: "profile_failures";
      failures: readonly DirectoryNameProfileFailureCount[];
    }>;

export type DirectoryNameIndexResult = DirectoryNameIndex | DirectoryNameIndexFailure;

export type DirectoryNameLookupMatchKind = "exact" | "nfc" | "fold";

export type DirectoryNameLookupResult =
  | Readonly<{
      ok: true;
      match: DirectoryNameLookupMatchKind;
      exacts: readonly string[];
    }>
  | Readonly<{
      ok: false;
      reason: "invalid_request" | "missing";
    }>;

export type DirectoryNameIndexReprofileResult =
  | Readonly<{ ok: true; profile: ResourceNameProfile }>
  | Readonly<{ ok: false; reason: "invalid_input" | "inconsistent" }>;

// Module initialization is the trust boundary for the intrinsics below.
const applySnapshot = Reflect.apply;
const arrayRef = Array;
const arrayIsArraySnapshot = Array.isArray;
const arraySortSnapshot = Array.prototype.sort;
const charCodeAtSnapshot = String.prototype.charCodeAt;
const definePropertySnapshot = Object.defineProperty;
const freezeSnapshot = Object.freeze;
const getOwnPropertyDescriptorSnapshot = Object.getOwnPropertyDescriptor;
const numberRef = Number;
const numberIsSafeIntegerSnapshot = Number.isSafeInteger;
const objectRef = Object;
const objectIsSnapshot = Object.is;
const profileObservedResourceNameSnapshot = profileObservedResourceName;
const isResourceNameProfileResultSnapshot = isResourceNameProfileResult;
const stringConstructorSnapshot = String;
const weakSetAddSnapshot = WeakSet.prototype.add;
const weakSetHasSnapshot = WeakSet.prototype.has;

const indexProvenance = new WeakSet<object>();

const profileFailureOrder: readonly DirectoryNameProfileFailureReason[] = freezeSnapshot([
  "type",
  "empty",
  "too_large",
  "separator",
  "dot",
  "unsafe_unicode",
  "nonportable",
  "unassigned",
]);

const INVALID_INPUT: DirectoryNameIndexFailure = freezeSnapshot({
  ok: false,
  reason: "invalid_input",
});
const TOO_MANY_ENTRIES: DirectoryNameIndexFailure = freezeSnapshot({
  ok: false,
  reason: "too_many_entries",
});
const UNSUPPORTED_RUNTIME: DirectoryNameIndexFailure = freezeSnapshot({
  ok: false,
  reason: "unsupported_runtime",
});
const EXACT_DUPLICATE: DirectoryNameIndexFailure = freezeSnapshot({
  ok: false,
  reason: "exact_duplicate",
});
const TOO_MANY_FINDINGS: DirectoryNameIndexFailure = freezeSnapshot({
  ok: false,
  reason: "too_many_findings",
});
const INVALID_REQUEST: DirectoryNameLookupResult = freezeSnapshot({
  ok: false,
  reason: "invalid_request",
});
const MISSING: DirectoryNameLookupResult = freezeSnapshot({ ok: false, reason: "missing" });
const REPROFILE_INVALID_INPUT: DirectoryNameIndexReprofileResult = freezeSnapshot({
  ok: false,
  reason: "invalid_input",
});
const REPROFILE_INCONSISTENT: DirectoryNameIndexReprofileResult = freezeSnapshot({
  ok: false,
  reason: "inconsistent",
});

function applyIntrinsic<T>(
  intrinsic: (...argumentsList: never[]) => unknown,
  receiver: unknown,
  args: unknown[],
): T {
  return applySnapshot(intrinsic, receiver, args) as T;
}

function isArray(value: unknown): value is unknown[] {
  return applyIntrinsic<boolean>(arrayIsArraySnapshot, arrayRef, [value]);
}

function getOwnDescriptor(value: object, property: PropertyKey): PropertyDescriptor | undefined {
  return applyIntrinsic<PropertyDescriptor | undefined>(
    getOwnPropertyDescriptorSnapshot,
    objectRef,
    [value, property],
  );
}

function indexProperty(index: number): string {
  return applyIntrinsic<string>(stringConstructorSnapshot, undefined, [index]);
}

function appendOwnDataSlot<T>(values: T[], value: T): void {
  applyIntrinsic<T[]>(definePropertySnapshot, objectRef, [
    values,
    indexProperty(values.length),
    { __proto__: null, configurable: true, enumerable: true, value, writable: true },
  ]);
}

function isSafeInteger(value: unknown): value is number {
  return applyIntrinsic<boolean>(numberIsSafeIntegerSnapshot, numberRef, [value]);
}

function isNegativeZero(value: number): boolean {
  return applyIntrinsic<boolean>(objectIsSnapshot, objectRef, [value, -0]);
}

function codeUnitAt(value: string, index: number): number {
  return applyIntrinsic<number>(charCodeAtSnapshot, value, [index]);
}

function compareUtf16(left: string, right: string): number {
  const limit = left.length < right.length ? left.length : right.length;
  for (let index = 0; index < limit; index += 1) {
    const leftCodeUnit = codeUnitAt(left, index);
    const rightCodeUnit = codeUnitAt(right, index);
    if (leftCodeUnit < rightCodeUnit) {
      return -1;
    }
    if (leftCodeUnit > rightCodeUnit) {
      return 1;
    }
  }
  if (left.length < right.length) {
    return -1;
  }
  if (left.length > right.length) {
    return 1;
  }
  return 0;
}

function sortInPlace<T>(values: T[], compare: (left: T, right: T) => number): void {
  applyIntrinsic<T[]>(arraySortSnapshot, values, [compare]);
}

function profileFailureIndex(reason: DirectoryNameProfileFailureReason): number {
  switch (reason) {
    case "type":
      return 0;
    case "empty":
      return 1;
    case "too_large":
      return 2;
    case "separator":
      return 3;
    case "dot":
      return 4;
    case "unsafe_unicode":
      return 5;
    case "nonportable":
      return 6;
    case "unassigned":
      return 7;
  }
}

function copiedEntry(profile: ResourceNameProfile): DirectoryNameIndexEntry {
  return freezeSnapshot({
    exact: profile.exact,
    exactByteLength: profile.exactByteLength,
    nfc: profile.nfc,
    key: profile.key,
    isNfc: profile.isNfc,
  });
}

function copiedEntries(values: readonly DirectoryNameIndexEntry[]): DirectoryNameIndexEntry[] {
  const copy: DirectoryNameIndexEntry[] = [];
  for (let index = 0; index < values.length; index += 1) {
    appendOwnDataSlot(copy, values[index] as DirectoryNameIndexEntry);
  }
  return copy;
}

function frozenExactList(
  values: readonly DirectoryNameIndexEntry[],
  start: number,
  end: number,
): readonly string[] {
  const exacts: string[] = [];
  for (let index = start; index < end; index += 1) {
    const entry = values[index];
    if (entry !== undefined) {
      appendOwnDataSlot(exacts, entry.exact);
    }
  }
  sortInPlace(exacts, compareUtf16);
  return freezeSnapshot(exacts);
}

function frozenUniqueNfcList(
  values: readonly DirectoryNameIndexEntry[],
  start: number,
  end: number,
): readonly string[] {
  const nfcs: string[] = [];
  for (let index = start; index < end; index += 1) {
    const entry = values[index];
    if (entry !== undefined) {
      appendOwnDataSlot(nfcs, entry.nfc);
    }
  }
  sortInPlace(nfcs, compareUtf16);
  let writeIndex = 0;
  for (let readIndex = 0; readIndex < nfcs.length; readIndex += 1) {
    const value = nfcs[readIndex];
    if (value !== undefined && (writeIndex === 0 || value !== nfcs[writeIndex - 1])) {
      nfcs[writeIndex] = value;
      writeIndex += 1;
    }
  }
  nfcs.length = writeIndex;
  return freezeSnapshot(nfcs);
}

function buildNfcGroups(
  entries: readonly DirectoryNameIndexEntry[],
): readonly DirectoryNameNfcGroup[] {
  const sorted = copiedEntries(entries);
  sortInPlace(sorted, (left, right) => {
    const nfcOrder = compareUtf16(left.nfc, right.nfc);
    return nfcOrder === 0 ? compareUtf16(left.exact, right.exact) : nfcOrder;
  });

  const groups: DirectoryNameNfcGroup[] = [];
  let start = 0;
  while (start < sorted.length) {
    const first = sorted[start] as DirectoryNameIndexEntry;
    let end = start + 1;
    while (end < sorted.length && sorted[end]?.nfc === first.nfc) {
      end += 1;
    }
    appendOwnDataSlot(
      groups,
      freezeSnapshot({
        nfc: first.nfc,
        exacts: frozenExactList(sorted, start, end),
      }),
    );
    start = end;
  }
  return freezeSnapshot(groups);
}

function buildFoldGroups(
  entries: readonly DirectoryNameIndexEntry[],
): readonly DirectoryNameFoldGroup[] {
  const sorted = copiedEntries(entries);
  sortInPlace(sorted, (left, right) => {
    const keyOrder = compareUtf16(left.key, right.key);
    return keyOrder === 0 ? compareUtf16(left.exact, right.exact) : keyOrder;
  });

  const groups: DirectoryNameFoldGroup[] = [];
  let start = 0;
  while (start < sorted.length) {
    const first = sorted[start] as DirectoryNameIndexEntry;
    let end = start + 1;
    while (end < sorted.length && sorted[end]?.key === first.key) {
      end += 1;
    }
    appendOwnDataSlot(
      groups,
      freezeSnapshot({
        key: first.key,
        nfcs: frozenUniqueNfcList(sorted, start, end),
        exacts: frozenExactList(sorted, start, end),
      }),
    );
    start = end;
  }
  return freezeSnapshot(groups);
}

function addFinding(
  findings: DirectoryNameIndexFinding[],
  finding: DirectoryNameIndexFinding,
): boolean {
  if (findings.length >= MAX_DIRECTORY_NAME_INDEX_FINDINGS) {
    return false;
  }
  appendOwnDataSlot(findings, freezeSnapshot(finding));
  return true;
}

function buildFindings(
  entries: readonly DirectoryNameIndexEntry[],
  nfcGroups: readonly DirectoryNameNfcGroup[],
  foldGroups: readonly DirectoryNameFoldGroup[],
): readonly DirectoryNameIndexFinding[] | undefined {
  const findings: DirectoryNameIndexFinding[] = [];

  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    if (
      entry !== undefined &&
      !entry.isNfc &&
      !addFinding(findings, { kind: "non_nfc", exact: entry.exact, nfc: entry.nfc })
    ) {
      return undefined;
    }
  }
  for (let index = 0; index < nfcGroups.length; index += 1) {
    const group = nfcGroups[index];
    if (
      group !== undefined &&
      group.exacts.length > 1 &&
      !addFinding(findings, {
        kind: "nfc_collision",
        nfc: group.nfc,
        exacts: group.exacts,
      })
    ) {
      return undefined;
    }
  }
  for (let index = 0; index < foldGroups.length; index += 1) {
    const group = foldGroups[index];
    if (
      group !== undefined &&
      group.nfcs.length > 1 &&
      !addFinding(findings, {
        kind: "fixed_fold_collision",
        key: group.key,
        nfcs: group.nfcs,
        exacts: group.exacts,
      })
    ) {
      return undefined;
    }
  }
  return freezeSnapshot(findings);
}

function profileFailureResult(counts: readonly number[]): DirectoryNameIndexFailure {
  const failures: DirectoryNameProfileFailureCount[] = [];
  for (let index = 0; index < profileFailureOrder.length; index += 1) {
    const count = counts[index] ?? 0;
    const reason = profileFailureOrder[index];
    if (count > 0 && reason !== undefined) {
      appendOwnDataSlot(failures, freezeSnapshot({ reason, count }));
    }
  }
  return freezeSnapshot({
    ok: false,
    reason: "profile_failures",
    failures: freezeSnapshot(failures),
  });
}

function registerIndex(index: DirectoryNameIndex): DirectoryNameIndex {
  const frozen = freezeSnapshot(index);
  applyIntrinsic<WeakSet<object>>(weakSetAddSnapshot, indexProvenance, [frozen]);
  return frozen;
}

function isGenuineIndex(value: unknown): value is DirectoryNameIndex {
  if ((typeof value !== "object" && typeof value !== "function") || value === null) {
    return false;
  }
  return applyIntrinsic<boolean>(weakSetHasSnapshot, indexProvenance, [value]);
}

/** Rebuild one genuine indexed entry as a layout-compatible profile without granting authority. */
export function reprofileDirectoryNameIndexEntry(
  indexValue: unknown,
  ordinalValue: unknown,
): DirectoryNameIndexReprofileResult {
  if (!isGenuineIndex(indexValue)) {
    return REPROFILE_INVALID_INPUT;
  }
  if (
    typeof ordinalValue !== "number" ||
    !isSafeInteger(ordinalValue) ||
    ordinalValue < 0 ||
    isNegativeZero(ordinalValue) ||
    ordinalValue >= indexValue.entries.length
  ) {
    return REPROFILE_INVALID_INPUT;
  }

  try {
    const slotDescriptor = getOwnDescriptor(indexValue.entries, indexProperty(ordinalValue));
    if (slotDescriptor === undefined) return REPROFILE_INCONSISTENT;
    const valueDescriptor = getOwnDescriptor(slotDescriptor, "value");
    if (valueDescriptor === undefined) return REPROFILE_INCONSISTENT;
    const entry = valueDescriptor.value as DirectoryNameIndexEntry;
    const current = applyIntrinsic<ResourceNameProfileResult>(
      profileObservedResourceNameSnapshot,
      undefined,
      [entry.exact],
    );
    if (
      !applyIntrinsic<boolean>(isResourceNameProfileResultSnapshot, undefined, [current]) ||
      !current.ok
    ) {
      return REPROFILE_INCONSISTENT;
    }

    let mismatches = 0;
    if (current.exact !== entry.exact) mismatches += 1;
    if (current.exactByteLength !== entry.exactByteLength) mismatches += 1;
    if (current.nfc !== entry.nfc) mismatches += 1;
    if (current.key !== entry.key) mismatches += 1;
    if (current.isNfc !== entry.isNfc) mismatches += 1;
    if (mismatches !== 0) return REPROFILE_INCONSISTENT;

    return freezeSnapshot({ ok: true, profile: current });
  } catch {
    return REPROFILE_INCONSISTENT;
  }
}

/** Build a deterministic, filesystem-free index from one dense array of genuine name profiles. */
export function indexDirectoryNames(value: unknown): DirectoryNameIndexResult {
  let length: number;
  try {
    if (!isArray(value)) {
      return INVALID_INPUT;
    }
    const lengthDescriptor = getOwnDescriptor(value, "length");
    const observedLength = lengthDescriptor?.value;
    if (!isSafeInteger(observedLength) || observedLength < 0) {
      return INVALID_INPUT;
    }
    length = observedLength;
  } catch {
    return INVALID_INPUT;
  }

  if (length > MAX_DIRECTORY_NAME_INDEX_ENTRIES) {
    return TOO_MANY_ENTRIES;
  }

  const entries: DirectoryNameIndexEntry[] = [];
  const failureCounts = [0, 0, 0, 0, 0, 0, 0, 0];
  let hasUnsupportedRuntime = false;
  for (let index = 0; index < length; index += 1) {
    let profile: unknown;
    try {
      const descriptor = getOwnDescriptor(value, indexProperty(index));
      const valueDescriptor = descriptor && getOwnDescriptor(descriptor, "value");
      if (
        descriptor === undefined ||
        // Only an own data value identifies a dense profile slot.
        valueDescriptor === undefined
      ) {
        return INVALID_INPUT;
      }
      profile = valueDescriptor.value;
    } catch {
      return INVALID_INPUT;
    }
    if (!isResourceNameProfileResult(profile)) {
      return INVALID_INPUT;
    }
    const genuineProfile: ResourceNameProfileResult = profile;
    if (genuineProfile.ok) {
      appendOwnDataSlot(entries, copiedEntry(genuineProfile));
    } else if (genuineProfile.reason === "unsupported_runtime") {
      hasUnsupportedRuntime = true;
    } else {
      const countIndex = profileFailureIndex(genuineProfile.reason);
      failureCounts[countIndex] = (failureCounts[countIndex] ?? 0) + 1;
    }
  }

  if (hasUnsupportedRuntime) {
    return UNSUPPORTED_RUNTIME;
  }
  let failureCount = 0;
  for (let index = 0; index < failureCounts.length; index += 1) {
    failureCount += failureCounts[index] ?? 0;
  }
  if (failureCount > 0) {
    return profileFailureResult(failureCounts);
  }

  sortInPlace(entries, (left, right) => compareUtf16(left.exact, right.exact));
  for (let index = 1; index < entries.length; index += 1) {
    if (entries[index - 1]?.exact === entries[index]?.exact) {
      return EXACT_DUPLICATE;
    }
  }
  const frozenEntries: readonly DirectoryNameIndexEntry[] = freezeSnapshot(entries);
  const nfcGroups = buildNfcGroups(frozenEntries);
  const foldGroups = buildFoldGroups(frozenEntries);
  const findings = buildFindings(frozenEntries, nfcGroups, foldGroups);
  if (findings === undefined) {
    return TOO_MANY_FINDINGS;
  }

  return registerIndex(
    freezeSnapshot({
      ok: true,
      entries: frozenEntries,
      nfcGroups,
      foldGroups,
      findings,
    }) as DirectoryNameIndex,
  );
}

function findEntry(
  entries: readonly DirectoryNameIndexEntry[],
  exact: string,
): DirectoryNameIndexEntry | undefined {
  let low = 0;
  let high = entries.length - 1;
  while (low <= high) {
    const middle = (low + high) >>> 1;
    const entry = entries[middle] as DirectoryNameIndexEntry;
    const order = compareUtf16(exact, entry.exact);
    if (order < 0) {
      high = middle - 1;
    } else if (order > 0) {
      low = middle + 1;
    } else {
      return entry;
    }
  }
  return undefined;
}

function findNfcGroup(
  groups: readonly DirectoryNameNfcGroup[],
  nfc: string,
): DirectoryNameNfcGroup | undefined {
  let low = 0;
  let high = groups.length - 1;
  while (low <= high) {
    const middle = (low + high) >>> 1;
    const group = groups[middle] as DirectoryNameNfcGroup;
    const order = compareUtf16(nfc, group.nfc);
    if (order < 0) {
      high = middle - 1;
    } else if (order > 0) {
      low = middle + 1;
    } else {
      return group;
    }
  }
  return undefined;
}

function findFoldGroup(
  groups: readonly DirectoryNameFoldGroup[],
  key: string,
): DirectoryNameFoldGroup | undefined {
  let low = 0;
  let high = groups.length - 1;
  while (low <= high) {
    const middle = (low + high) >>> 1;
    const group = groups[middle] as DirectoryNameFoldGroup;
    const order = compareUtf16(key, group.key);
    if (order < 0) {
      high = middle - 1;
    } else if (order > 0) {
      low = middle + 1;
    } else {
      return group;
    }
  }
  return undefined;
}

function successfulLookup(
  match: DirectoryNameLookupMatchKind,
  exacts: readonly string[],
): DirectoryNameLookupResult {
  return freezeSnapshot({ ok: true, match, exacts });
}

/** Resolve one genuine NFC profile by exact spelling, then NFC, then fixed-fold key. */
export function lookupDirectoryName(index: unknown, request: unknown): DirectoryNameLookupResult {
  if (!isGenuineIndex(index) || !isResourceNameProfileResult(request)) {
    return INVALID_REQUEST;
  }
  const genuineRequest: ResourceNameProfileResult = request;
  if (!genuineRequest.ok || !genuineRequest.isNfc) {
    return INVALID_REQUEST;
  }

  const exactEntry = findEntry(index.entries, genuineRequest.exact);
  if (exactEntry !== undefined) {
    return successfulLookup("exact", freezeSnapshot([exactEntry.exact]));
  }
  const nfcGroup = findNfcGroup(index.nfcGroups, genuineRequest.nfc);
  if (nfcGroup !== undefined) {
    return successfulLookup("nfc", nfcGroup.exacts);
  }
  const foldGroup = findFoldGroup(index.foldGroups, genuineRequest.key);
  if (foldGroup !== undefined) {
    return successfulLookup("fold", foldGroup.exacts);
  }
  return MISSING;
}
