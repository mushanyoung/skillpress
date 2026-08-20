import { Buffer } from "node:buffer";
import type { BigIntStats } from "node:fs";
import { lstat, opendir } from "node:fs/promises";
import { TextDecoder, TextEncoder } from "node:util";

import {
  type DirectoryNameIndex,
  type DirectoryNameIndexFailure,
  indexDirectoryNames,
} from "./directory-name-index.js";
import {
  type FileMetadataSnapshot,
  sameFileSnapshot,
  snapshotFileMetadata,
} from "./file-metadata.js";
import {
  MAX_RESOURCE_NAME_BYTES,
  profileObservedResourceName,
  type ResourceNameProfileResult,
} from "./resource-name-profile.js";

export const MAX_INSPECTED_DIRECTORY_ENTRIES = 1_024;

export interface InspectedDirectory {
  readonly path: string;
  readonly metadata: FileMetadataSnapshot;
}

export interface RawDirectoryOpenOptions {
  readonly encoding: "buffer";
  readonly bufferSize: 1;
  readonly recursive: false;
}

export interface InspectedDirectoryHandle {
  read(): Promise<{ readonly name: unknown } | null>;
  close(): Promise<void>;
}

export interface InspectedDirectoryReadIo {
  readonly lstatPath: (path: string) => Promise<BigIntStats>;
  readonly openDirectory: (
    path: string,
    options: RawDirectoryOpenOptions,
  ) => Promise<InspectedDirectoryHandle>;
}

export type VerifyDirectoryContext = () => Promise<boolean>;

export type InspectedDirectoryNamesResult =
  | Readonly<{
      ok: true;
      directory: InspectedDirectory;
      names: DirectoryNameIndex;
    }>
  | Readonly<{
      ok: false;
      reason:
        | "invalid-inspection"
        | "invalid-metadata"
        | "invalid-read"
        | "name-too-large"
        | "invalid-name-encoding"
        | "too-many-entries"
        | "io";
    }>
  | Readonly<{
      ok: false;
      reason: "changed";
      subject: "context" | "directory";
      phase: "before-open" | "reading";
    }>
  | Readonly<{
      ok: false;
      reason: "name-index";
      failure: DirectoryNameIndexFailure;
    }>;

type SimpleFailureReason =
  | "invalid-inspection"
  | "invalid-metadata"
  | "invalid-read"
  | "name-too-large"
  | "invalid-name-encoding"
  | "too-many-entries"
  | "io";

type OpenDirectorySnapshot = (
  path: string,
  options: RawDirectoryOpenOptions,
) => Promise<InspectedDirectoryHandle>;

type ClosingHandleSnapshot = Readonly<{
  receiver: InspectedDirectoryHandle;
  close: InspectedDirectoryHandle["close"];
}>;

// Module initialization is the trust boundary for filesystem bindings and intrinsics.
const applySnapshot = Reflect.apply;
const objectRef = Object;
const bufferFromSnapshot = Buffer.from;
const bufferIsBufferSnapshot = Buffer.isBuffer;
const definePropertySnapshot = Object.defineProperty;
const freezeSnapshot = Object.freeze;
const getOwnPropertyDescriptorSnapshot = Object.getOwnPropertyDescriptor;
const lstatBuiltinSnapshot = lstat;
const opendirBuiltinSnapshot = opendir as unknown as OpenDirectorySnapshot;
const sameFileSnapshotSnapshot = sameFileSnapshot;
const snapshotFileMetadataSnapshot = snapshotFileMetadata;
const profileObservedResourceNameSnapshot = profileObservedResourceName;
const indexDirectoryNamesSnapshot = indexDirectoryNames;
const stringConstructorSnapshot = String;
const textDecoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
const textDecoderDecodeSnapshot = TextDecoder.prototype.decode;
const textEncoder = new TextEncoder();
const textEncoderEncodeSnapshot = TextEncoder.prototype.encode;
const typedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype) as object;
const typedArrayByteLengthGetter = Object.getOwnPropertyDescriptor(
  typedArrayPrototype,
  "byteLength",
)?.get;
const RAW_OPEN_OPTIONS: RawDirectoryOpenOptions = freezeSnapshot({
  encoding: "buffer",
  bufferSize: 1,
  recursive: false,
});
const BIGINT_LSTAT_OPTIONS = freezeSnapshot({ bigint: true as const });

const DEFAULT_IO: InspectedDirectoryReadIo = freezeSnapshot({
  lstatPath: (path: string) => lstatBuiltinSnapshot(path, BIGINT_LSTAT_OPTIONS),
  openDirectory: (path: string, options: RawDirectoryOpenOptions) =>
    opendirBuiltinSnapshot(path, options),
});

const SIMPLE_FAILURES: Readonly<Record<SimpleFailureReason, InspectedDirectoryNamesResult>> =
  freezeSnapshot({
    "invalid-inspection": freezeSnapshot({ ok: false, reason: "invalid-inspection" }),
    "invalid-metadata": freezeSnapshot({ ok: false, reason: "invalid-metadata" }),
    "invalid-read": freezeSnapshot({ ok: false, reason: "invalid-read" }),
    "name-too-large": freezeSnapshot({ ok: false, reason: "name-too-large" }),
    "invalid-name-encoding": freezeSnapshot({ ok: false, reason: "invalid-name-encoding" }),
    "too-many-entries": freezeSnapshot({ ok: false, reason: "too-many-entries" }),
    io: freezeSnapshot({ ok: false, reason: "io" }),
  });

function applyIntrinsic<T>(
  intrinsic: (...argumentsList: never[]) => unknown,
  receiver: unknown,
  args: unknown[],
): T {
  return applySnapshot(intrinsic, receiver, args) as T;
}

function failure(reason: SimpleFailureReason): InspectedDirectoryNamesResult {
  return SIMPLE_FAILURES[reason];
}

function changed(
  subject: "context" | "directory",
  phase: "before-open" | "reading",
): InspectedDirectoryNamesResult {
  return freezeSnapshot({ ok: false, reason: "changed", subject, phase });
}

function indexFailure(failureValue: DirectoryNameIndexFailure): InspectedDirectoryNamesResult {
  return freezeSnapshot({ ok: false, reason: "name-index", failure: failureValue });
}

function isObject(value: unknown): value is Record<PropertyKey, unknown> {
  return (typeof value === "object" || typeof value === "function") && value !== null;
}

function copyExpectedMetadata(value: unknown): FileMetadataSnapshot | undefined {
  if (!isObject(value)) return undefined;
  try {
    const kindDescriptor = getOwnDescriptor(value, "kind");
    if (kindDescriptor === undefined) return undefined;
    const kindValueDescriptor = getOwnDescriptor(kindDescriptor, "value");
    if (kindValueDescriptor === undefined || kindValueDescriptor.value !== "directory") {
      return undefined;
    }
    return snapshotFileMetadataSnapshot(value);
  } catch {
    return undefined;
  }
}

function snapshotDirectoryMetadata(value: unknown): FileMetadataSnapshot | undefined {
  try {
    const metadata = snapshotFileMetadataSnapshot(value);
    return metadata.kind === "directory" ? metadata : undefined;
  } catch {
    return undefined;
  }
}

function copyInspection(
  value: unknown,
):
  | Readonly<{ ok: true; directory: InspectedDirectory }>
  | Readonly<{ ok: false; reason: "invalid-inspection" | "invalid-metadata" }> {
  if (!isObject(value)) {
    return freezeSnapshot({ ok: false, reason: "invalid-inspection" });
  }
  let path: unknown;
  let metadataValue: unknown;
  try {
    path = value.path;
    metadataValue = value.metadata;
  } catch {
    return freezeSnapshot({ ok: false, reason: "invalid-inspection" });
  }
  if (typeof path !== "string" || !isObject(metadataValue)) {
    return freezeSnapshot({ ok: false, reason: "invalid-inspection" });
  }
  const metadata = copyExpectedMetadata(metadataValue);
  if (metadata === undefined) {
    return freezeSnapshot({ ok: false, reason: "invalid-metadata" });
  }
  return freezeSnapshot({
    ok: true,
    directory: freezeSnapshot({ path, metadata }),
  });
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

function getOwnDescriptor(value: object, property: PropertyKey): PropertyDescriptor | undefined {
  return applyIntrinsic<PropertyDescriptor | undefined>(
    getOwnPropertyDescriptorSnapshot,
    objectRef,
    [value, property],
  );
}

function isBuffer(value: unknown): value is Buffer {
  return applyIntrinsic<boolean>(bufferIsBufferSnapshot, Buffer, [value]);
}

function byteLength(value: Uint8Array): number | undefined {
  if (typedArrayByteLengthGetter === undefined) return undefined;
  try {
    return applyIntrinsic<number>(typedArrayByteLengthGetter, value, []);
  } catch {
    return undefined;
  }
}

function copyBuffer(value: Buffer): Buffer | undefined {
  try {
    const copy = applyIntrinsic<Buffer>(bufferFromSnapshot, Buffer, [value]);
    return isBuffer(copy) ? copy : undefined;
  } catch {
    return undefined;
  }
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  const leftLength = byteLength(left);
  const rightLength = byteLength(right);
  if (leftLength === undefined || rightLength === undefined || leftLength !== rightLength) {
    return false;
  }
  for (let index = 0; index < leftLength; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

function decodeName(value: Buffer): string | undefined {
  try {
    const decoded = applyIntrinsic<string>(textDecoderDecodeSnapshot, textDecoder, [value]);
    const encoded = applyIntrinsic<Uint8Array>(textEncoderEncodeSnapshot, textEncoder, [decoded]);
    return equalBytes(value, encoded) ? decoded : undefined;
  } catch {
    return undefined;
  }
}

function captureClosingHandle(value: unknown): ClosingHandleSnapshot | undefined {
  if (!isObject(value)) return undefined;
  try {
    const close = value.close;
    if (typeof close !== "function") return undefined;
    return freezeSnapshot({
      receiver: value as unknown as InspectedDirectoryHandle,
      close: close as InspectedDirectoryHandle["close"],
    });
  } catch {
    return undefined;
  }
}

function captureRead(value: unknown): InspectedDirectoryHandle["read"] | undefined {
  if (!isObject(value)) return undefined;
  try {
    const read = value.read;
    return typeof read === "function" ? (read as InspectedDirectoryHandle["read"]) : undefined;
  } catch {
    return undefined;
  }
}

/** @internal Reads and indexes one complete raw directory inventory without opening children. */
export async function readInspectedDirectoryNames(
  inspected: InspectedDirectory,
  contextIsCurrent: VerifyDirectoryContext,
  io: InspectedDirectoryReadIo = DEFAULT_IO,
): Promise<InspectedDirectoryNamesResult> {
  let activeHandle: ClosingHandleSnapshot | undefined;
  try {
    const copiedInspection = copyInspection(inspected);
    if (!copiedInspection.ok) return failure(copiedInspection.reason);
    const current = copiedInspection.directory;
    const verifyContext = contextIsCurrent;
    let lstatPath: InspectedDirectoryReadIo["lstatPath"];
    let openDirectory: InspectedDirectoryReadIo["openDirectory"];
    try {
      lstatPath = io.lstatPath;
      openDirectory = io.openDirectory;
    } catch {
      return failure("io");
    }
    if (
      typeof verifyContext !== "function" ||
      typeof lstatPath !== "function" ||
      typeof openDirectory !== "function"
    ) {
      return failure(typeof verifyContext === "function" ? "io" : "invalid-inspection");
    }

    const beforeContext = await applyIntrinsic<Promise<boolean>>(verifyContext, undefined, []);
    if (beforeContext !== true) return changed("context", "before-open");

    const beforeMetadata = snapshotDirectoryMetadata(
      await applyIntrinsic<Promise<BigIntStats>>(lstatPath, undefined, [current.path]),
    );
    if (beforeMetadata === undefined) return failure("invalid-metadata");
    if (!sameFileSnapshotSnapshot(current.metadata, beforeMetadata)) {
      return changed("directory", "before-open");
    }

    const opened = await applyIntrinsic<Promise<InspectedDirectoryHandle>>(
      openDirectory,
      undefined,
      [current.path, RAW_OPEN_OPTIONS],
    );
    activeHandle = captureClosingHandle(opened);
    if (activeHandle === undefined) return failure("io");
    const readEntry = captureRead(opened);
    if (readEntry === undefined) return failure("io");

    const rawNames: Buffer[] = [];
    let observedEntries = 0;
    let invalidRead = false;
    let nameTooLarge = false;
    while (true) {
      const entry = await applyIntrinsic<ReturnType<InspectedDirectoryHandle["read"]>>(
        readEntry,
        activeHandle.receiver,
        [],
      );
      if (entry === null) break;
      observedEntries += 1;
      if (observedEntries > MAX_INSPECTED_DIRECTORY_ENTRIES) {
        break;
      }
      if (!isObject(entry)) {
        invalidRead = true;
        continue;
      }

      let rawName: unknown;
      try {
        const nameDescriptor = getOwnDescriptor(entry, "name");
        if (nameDescriptor === undefined) {
          invalidRead = true;
          continue;
        }
        const valueDescriptor = getOwnDescriptor(nameDescriptor, "value");
        if (valueDescriptor === undefined) {
          invalidRead = true;
          continue;
        }
        rawName = valueDescriptor.value;
      } catch {
        invalidRead = true;
        continue;
      }
      if (!isBuffer(rawName)) {
        invalidRead = true;
        continue;
      }
      const observedLength = byteLength(rawName);
      if (observedLength === undefined) {
        invalidRead = true;
        continue;
      }
      if (observedLength > MAX_RESOURCE_NAME_BYTES) {
        nameTooLarge = true;
        continue;
      }
      const copiedName = copyBuffer(rawName);
      if (copiedName === undefined || byteLength(copiedName) !== observedLength) {
        invalidRead = true;
        continue;
      }
      appendOwnDataSlot(rawNames, copiedName);
    }

    const completedHandle = activeHandle;
    activeHandle = undefined;
    await applyIntrinsic<Promise<void>>(completedHandle.close, completedHandle.receiver, []);

    const afterMetadata = snapshotDirectoryMetadata(
      await applyIntrinsic<Promise<BigIntStats>>(lstatPath, undefined, [current.path]),
    );
    if (afterMetadata === undefined) return failure("invalid-metadata");
    const directoryChanged = !sameFileSnapshotSnapshot(current.metadata, afterMetadata);
    const afterContext = await applyIntrinsic<Promise<boolean>>(verifyContext, undefined, []);
    if (directoryChanged) return changed("directory", "reading");
    if (afterContext !== true) return changed("context", "reading");
    if (observedEntries > MAX_INSPECTED_DIRECTORY_ENTRIES) {
      return failure("too-many-entries");
    }
    if (invalidRead) return failure("invalid-read");
    if (nameTooLarge) return failure("name-too-large");

    const profiles: ResourceNameProfileResult[] = [];
    for (let index = 0; index < rawNames.length; index += 1) {
      const rawName = rawNames[index];
      if (rawName === undefined) return failure("invalid-read");
      const decoded = decodeName(rawName);
      if (decoded === undefined) return failure("invalid-name-encoding");
      appendOwnDataSlot(profiles, profileObservedResourceNameSnapshot(decoded));
    }
    const names = indexDirectoryNamesSnapshot(profiles);
    if (!names.ok) return indexFailure(names);
    return freezeSnapshot({ ok: true, directory: current, names });
  } catch {
    return failure("io");
  } finally {
    if (activeHandle !== undefined) {
      const abandoned = activeHandle;
      activeHandle = undefined;
      try {
        await applyIntrinsic<Promise<void>>(abandoned.close, abandoned.receiver, []);
      } catch {
        // The caller receives the stable IO failure from the interrupted transaction.
      }
    }
  }
}
