import { Buffer } from "node:buffer";
import { types } from "node:util";

import {
  MAX_DIRECTORY_NAME_INDEX_ENTRIES,
  MAX_DIRECTORY_NAME_INDEX_FINDINGS,
} from "./directory-name-index.js";
import { type FileMetadataSnapshot, snapshotFileMetadata } from "./file-metadata.js";
import { MAX_RESOURCE_NAME_BYTES } from "./resource-name-profile.js";
import {
  MAX_RESOURCE_TREE_DEPTH,
  MAX_RESOURCE_TREE_ENTRIES,
  MAX_RESOURCE_TREE_TOTAL_RELATIVE_PATH_BYTES,
} from "./resource-tree-layout.js";

type Token = string | number | bigint | boolean | null;
type State = {
  readonly tokens: Token[];
  workItems: number;
  stringUnits: number;
  indexed: number;
  totalPathBytes: number;
};

const MAX_COMPARISON_WORK_ITEMS = 1_048_576;
const MAX_COMPARISON_STRING_UNITS = 64 * 1024 * 1024;
const MAX_INDEX_STRING_CODE_UNITS = 1_024;
const INVALID = Symbol("invalid");
const applySnapshot = Reflect.apply;
const arrayIsArraySnapshot = Array.isArray;
const arrayPrototypeSnapshot = Array.prototype;
const bufferByteLengthSnapshot = Buffer.byteLength;
const bufferConstructorSnapshot = Buffer;
const definePropertySnapshot = Object.defineProperty;
const getOwnPropertyDescriptorSnapshot = Object.getOwnPropertyDescriptor;
const getPrototypeOfSnapshot = Object.getPrototypeOf;
const isProxySnapshot = types.isProxy;
const numberIsSafeIntegerSnapshot = Number.isSafeInteger;
const objectIsSnapshot = Object.is;
const objectPrototypeSnapshot = Object.prototype;
const snapshotFileMetadataSnapshot = snapshotFileMetadata;

const LAYOUT_KEYS = [
  "entryIndex",
  "parentIndex",
  "depth",
  "exactName",
  "exactNameByteLength",
  "relativePath",
  "relativePathByteLength",
] as const;
const METADATA_KEYS = ["dev", "ino", "mode", "size", "mtimeNs", "ctimeNs", "kind"] as const;
const INDEX_KEYS = ["ok", "entries", "nfcGroups", "foldGroups", "findings"] as const;

function applyIntrinsic<T>(
  fn: (...args: never[]) => unknown,
  receiver: unknown,
  args: unknown[],
): T {
  return applySnapshot(fn, receiver, args) as T;
}

function spend(state: State, amount = 1): boolean {
  state.workItems += amount;
  return state.workItems <= MAX_COMPARISON_WORK_ITEMS;
}

function append(state: State, value: Token): boolean {
  if (!spend(state)) return false;
  if (typeof value === "string") {
    state.stringUnits += value.length;
    if (state.stringUnits > MAX_COMPARISON_STRING_UNITS) return false;
  }
  applyIntrinsic(definePropertySnapshot, Object, [
    state.tokens,
    state.tokens.length,
    { __proto__: null, configurable: true, enumerable: true, value, writable: true },
  ]);
  return true;
}

function descriptorValue(
  descriptor: PropertyDescriptor,
  key: PropertyKey,
): unknown | typeof INVALID {
  const field = applyIntrinsic<PropertyDescriptor | undefined>(
    getOwnPropertyDescriptorSnapshot,
    Object,
    [descriptor, key],
  );
  return field === undefined ? INVALID : field.value;
}

function data(value: object, key: PropertyKey): unknown | typeof INVALID {
  const descriptor = applyIntrinsic<PropertyDescriptor | undefined>(
    getOwnPropertyDescriptorSnapshot,
    Object,
    [value, key],
  );
  if (descriptor === undefined || descriptorValue(descriptor, "value") === INVALID) {
    return INVALID;
  }
  return descriptorValue(descriptor, "value");
}

function isProxy(value: object): boolean {
  return applyIntrinsic<boolean>(isProxySnapshot, undefined, [value]);
}

function record(state: State, value: unknown, keys: readonly string[]): object | undefined {
  if (typeof value !== "object" || value === null || isProxy(value)) return undefined;
  if (
    applyIntrinsic<boolean>(arrayIsArraySnapshot, Array, [value]) ||
    applyIntrinsic(getPrototypeOfSnapshot, Object, [value]) !== objectPrototypeSnapshot ||
    !spend(state, keys.length + 1)
  ) {
    return undefined;
  }
  for (let index = 0; index < keys.length; index += 1) {
    if (data(value, keys[index] as string) === INVALID) return undefined;
  }
  return value;
}

function array(
  state: State,
  value: unknown,
  maximum: number,
  minimum = 0,
): readonly unknown[] | undefined {
  if (typeof value !== "object" || value === null || isProxy(value)) return undefined;
  if (
    !applyIntrinsic<boolean>(arrayIsArraySnapshot, Array, [value]) ||
    applyIntrinsic(getPrototypeOfSnapshot, Object, [value]) !== arrayPrototypeSnapshot
  ) {
    return undefined;
  }
  const length = data(value, "length");
  if (!safeNumber(length, minimum, maximum)) return undefined;
  if (!spend(state, length + 1)) return undefined;
  for (let index = 0; index < length; index += 1) {
    if (data(value, index) === INVALID) return undefined;
  }
  return value as readonly unknown[];
}

function safeNumber(value: unknown, minimum: number, maximum: number): value is number {
  return !(
    typeof value !== "number" ||
    !applyIntrinsic<boolean>(numberIsSafeIntegerSnapshot, Number, [value]) ||
    applyIntrinsic<boolean>(objectIsSnapshot, Object, [value, -0]) ||
    value < minimum ||
    value > maximum
  );
}

function number(state: State, value: unknown, minimum: number, maximum: number): value is number {
  return safeNumber(value, minimum, maximum) && append(state, value);
}

function text(state: State, value: unknown, maximum: number, minimum = 0): value is string {
  return (
    typeof value === "string" &&
    value.length >= minimum &&
    value.length <= maximum &&
    append(state, value)
  );
}

function stringArray(state: State, value: unknown, minimum: number): value is readonly string[] {
  const values = array(state, value, MAX_DIRECTORY_NAME_INDEX_ENTRIES, minimum);
  if (values === undefined || !append(state, values.length)) return false;
  for (let index = 0; index < values.length; index += 1) {
    if (!text(state, data(values, index), MAX_INDEX_STRING_CODE_UNITS, 1)) return false;
  }
  return true;
}

function metadata(state: State, value: unknown): string | undefined {
  const observed = record(state, value, METADATA_KEYS);
  if (observed === undefined) return undefined;
  const snapshot = applyIntrinsic<FileMetadataSnapshot>(snapshotFileMetadataSnapshot, undefined, [
    observed,
  ]);
  for (let index = 0; index < 6; index += 1) {
    const current = snapshot[METADATA_KEYS[index] as keyof FileMetadataSnapshot];
    if (typeof current !== "bigint" || !append(state, current)) return undefined;
  }
  return append(state, snapshot.kind) ? snapshot.kind : undefined;
}

function rootLayout(state: State, value: unknown): boolean {
  const layout = record(state, value, LAYOUT_KEYS);
  const expected: readonly Token[] = [null, null, 0, "", 0, "", 0];
  if (layout === undefined) return false;
  for (let index = 0; index < LAYOUT_KEYS.length; index += 1) {
    const expectedValue = expected[index] as Token;
    if (
      !applyIntrinsic<boolean>(objectIsSnapshot, Object, [
        data(layout, LAYOUT_KEYS[index] as string),
        expectedValue,
      ]) ||
      !append(state, expectedValue)
    ) {
      return false;
    }
  }
  return true;
}

function entryLayout(state: State, value: unknown, ordinal: number): boolean {
  const layout = record(state, value, LAYOUT_KEYS);
  if (layout === undefined) return false;
  const entryIndex = data(layout, "entryIndex");
  const parentIndex = data(layout, "parentIndex");
  const depth = data(layout, "depth");
  const exact = data(layout, "exactName");
  const exactBytes = data(layout, "exactNameByteLength");
  const path = data(layout, "relativePath");
  const pathBytes = data(layout, "relativePathByteLength");
  if (!number(state, entryIndex, ordinal, ordinal)) return false;
  if (parentIndex === null) {
    if (!append(state, null)) return false;
  } else if (!number(state, parentIndex, 0, ordinal - 1)) return false;
  if (!number(state, depth, 1, MAX_RESOURCE_TREE_DEPTH)) return false;
  if (!text(state, exact, MAX_RESOURCE_NAME_BYTES, 1)) return false;
  if (!number(state, exactBytes, 1, MAX_RESOURCE_NAME_BYTES)) return false;
  if (
    applyIntrinsic<number>(bufferByteLengthSnapshot, bufferConstructorSnapshot, [exact, "utf8"]) !==
      exactBytes ||
    !text(state, path, MAX_RESOURCE_TREE_TOTAL_RELATIVE_PATH_BYTES, 1) ||
    !number(state, pathBytes, 1, MAX_RESOURCE_TREE_TOTAL_RELATIVE_PATH_BYTES) ||
    applyIntrinsic<number>(bufferByteLengthSnapshot, bufferConstructorSnapshot, [path, "utf8"]) !==
      pathBytes
  ) {
    return false;
  }
  state.totalPathBytes += pathBytes;
  return state.totalPathBytes <= MAX_RESOURCE_TREE_TOTAL_RELATIVE_PATH_BYTES;
}

function nameIndex(state: State, value: unknown): boolean {
  const index = record(state, value, INDEX_KEYS);
  if (index === undefined || data(index, "ok") !== true || !append(state, true)) return false;
  const entries = array(state, data(index, "entries"), MAX_DIRECTORY_NAME_INDEX_ENTRIES);
  if (entries === undefined || !append(state, entries.length)) return false;
  state.indexed += entries.length;
  if (state.indexed > MAX_RESOURCE_TREE_ENTRIES) return false;
  for (let ordinal = 0; ordinal < entries.length; ordinal += 1) {
    const entry = record(state, data(entries, ordinal), [
      "exact",
      "exactByteLength",
      "nfc",
      "key",
      "isNfc",
    ]);
    if (entry === undefined) return false;
    const exact = data(entry, "exact");
    const bytes = data(entry, "exactByteLength");
    if (
      !text(state, exact, MAX_RESOURCE_NAME_BYTES, 1) ||
      !number(state, bytes, 1, MAX_RESOURCE_NAME_BYTES) ||
      applyIntrinsic<number>(bufferByteLengthSnapshot, bufferConstructorSnapshot, [
        exact,
        "utf8",
      ]) !== bytes ||
      !text(state, data(entry, "nfc"), MAX_INDEX_STRING_CODE_UNITS, 1) ||
      !text(state, data(entry, "key"), MAX_INDEX_STRING_CODE_UNITS, 1)
    )
      return false;
    const isNfc = data(entry, "isNfc");
    if (typeof isNfc !== "boolean" || !append(state, isNfc)) return false;
  }
  const nfcGroups = array(state, data(index, "nfcGroups"), entries.length);
  if (nfcGroups === undefined || !append(state, nfcGroups.length)) return false;
  for (let ordinal = 0; ordinal < nfcGroups.length; ordinal += 1) {
    const group = record(state, data(nfcGroups, ordinal), ["nfc", "exacts"]);
    if (
      group === undefined ||
      !text(state, data(group, "nfc"), MAX_INDEX_STRING_CODE_UNITS, 1) ||
      !stringArray(state, data(group, "exacts"), 1)
    )
      return false;
  }
  const foldGroups = array(state, data(index, "foldGroups"), entries.length);
  if (foldGroups === undefined || !append(state, foldGroups.length)) return false;
  for (let ordinal = 0; ordinal < foldGroups.length; ordinal += 1) {
    const group = record(state, data(foldGroups, ordinal), ["key", "nfcs", "exacts"]);
    if (
      group === undefined ||
      !text(state, data(group, "key"), MAX_INDEX_STRING_CODE_UNITS, 1) ||
      !stringArray(state, data(group, "nfcs"), 1) ||
      !stringArray(state, data(group, "exacts"), 1)
    )
      return false;
  }
  const findings = array(state, data(index, "findings"), MAX_DIRECTORY_NAME_INDEX_FINDINGS);
  if (findings === undefined || !append(state, findings.length)) return false;
  for (let ordinal = 0; ordinal < findings.length; ordinal += 1) {
    const candidate = data(findings, ordinal);
    if (typeof candidate !== "object" || candidate === null || isProxy(candidate)) return false;
    const kind = data(candidate, "kind");
    const keys =
      kind === "non_nfc"
        ? ["kind", "exact", "nfc"]
        : kind === "nfc_collision"
          ? ["kind", "nfc", "exacts"]
          : kind === "fixed_fold_collision"
            ? ["kind", "key", "nfcs", "exacts"]
            : undefined;
    const finding = keys === undefined ? undefined : record(state, candidate, keys);
    if (finding === undefined || !append(state, kind as string)) return false;
    if (kind === "non_nfc") {
      if (
        !text(state, data(finding, "exact"), MAX_RESOURCE_NAME_BYTES, 1) ||
        !text(state, data(finding, "nfc"), MAX_INDEX_STRING_CODE_UNITS, 1)
      )
        return false;
    } else if (kind === "nfc_collision") {
      if (
        !text(state, data(finding, "nfc"), MAX_INDEX_STRING_CODE_UNITS, 1) ||
        !stringArray(state, data(finding, "exacts"), 2)
      )
        return false;
    } else if (
      !text(state, data(finding, "key"), MAX_INDEX_STRING_CODE_UNITS, 1) ||
      !stringArray(state, data(finding, "nfcs"), 2) ||
      !stringArray(state, data(finding, "exacts"), 2)
    )
      return false;
  }
  return true;
}

function validate(value: unknown): Token[] | undefined {
  const state: State = {
    tokens: [],
    workItems: 0,
    stringUnits: 0,
    indexed: 0,
    totalPathBytes: 0,
  };
  const outer = record(state, value, ["ok", "root", "entries"]);
  if (outer === undefined || data(outer, "ok") !== true || !append(state, true)) return undefined;
  const root = record(state, data(outer, "root"), ["layout", "metadata", "names"]);
  if (
    root === undefined ||
    !rootLayout(state, data(root, "layout")) ||
    metadata(state, data(root, "metadata")) !== "directory" ||
    !nameIndex(state, data(root, "names"))
  )
    return undefined;
  const entries = array(state, data(outer, "entries"), MAX_RESOURCE_TREE_ENTRIES, 1);
  if (entries === undefined || !append(state, entries.length)) return undefined;
  for (let ordinal = 0; ordinal < entries.length; ordinal += 1) {
    const candidate = data(entries, ordinal);
    if (typeof candidate !== "object" || candidate === null || isProxy(candidate)) return undefined;
    const role = data(candidate, "role");
    const keys =
      role === "directory"
        ? ["role", "layout", "metadata", "names"]
        : role === "document" || role === "resource-file"
          ? ["role", "layout", "metadata"]
          : undefined;
    const entry = keys === undefined ? undefined : record(state, candidate, keys);
    if (entry === undefined || !append(state, role as string)) return undefined;
    const validLayout = entryLayout(state, data(entry, "layout"), ordinal);
    const kind = metadata(state, data(entry, "metadata"));
    if (
      !validLayout ||
      (role === "directory"
        ? kind !== "directory" || !nameIndex(state, data(entry, "names"))
        : kind !== "file")
    )
      return undefined;
  }
  return state.indexed === entries.length ? state.tokens : undefined;
}

function safeValidate(value: unknown): Token[] | undefined {
  try {
    return validate(value);
  } catch {
    return undefined;
  }
}

/**
 * Compare the bounded, required-field projections of two current-realm capture-success structures.
 * Extra fields and mutability do not affect the instantaneous result. `equal` proves no provenance,
 * freshness, or authority; foreign-realm records are invalid.
 */
export function compareResourceTreeCaptureSemantics(
  left: unknown,
  right: unknown,
): "equal" | "different" | "invalid" {
  const leftTokens = safeValidate(left);
  const rightTokens = safeValidate(right);
  if (leftTokens === undefined || rightTokens === undefined) return "invalid";
  if (leftTokens.length !== rightTokens.length) return "different";
  for (let index = 0; index < leftTokens.length; index += 1) {
    if (leftTokens[index] !== rightTokens[index]) return "different";
  }
  return "equal";
}
