import type { BigIntStats } from "node:fs";

export type FileKind = "directory" | "file" | "other" | "symbolic-link";

/** Immutable scalar metadata retained across asynchronous filesystem checks. */
export interface FileMetadataSnapshot {
  readonly dev: bigint;
  readonly ino: bigint;
  readonly mode: bigint;
  readonly size: bigint;
  readonly mtimeNs: bigint;
  readonly ctimeNs: bigint;
  readonly kind: FileKind;
}

function bigintField(value: unknown): bigint {
  if (typeof value !== "bigint")
    throw new TypeError("filesystem metadata must contain bigint fields");
  return value;
}

function booleanField(value: unknown): boolean {
  if (typeof value !== "boolean") {
    throw new TypeError("filesystem metadata type checks must return booleans");
  }
  return value;
}

/** Copies a Node BigIntStats object without retaining its mutable or lazy Date accessors. */
export function snapshotFileMetadata(metadata: BigIntStats): FileMetadataSnapshot {
  const directory = booleanField(metadata.isDirectory());
  const file = booleanField(metadata.isFile());
  const symbolicLink = booleanField(metadata.isSymbolicLink());
  if (Number(directory) + Number(file) + Number(symbolicLink) > 1) {
    throw new TypeError("filesystem metadata has contradictory file types");
  }
  const kind: FileKind = directory
    ? "directory"
    : file
      ? "file"
      : symbolicLink
        ? "symbolic-link"
        : "other";
  return Object.freeze({
    dev: bigintField(metadata.dev),
    ino: bigintField(metadata.ino),
    mode: bigintField(metadata.mode),
    size: bigintField(metadata.size),
    mtimeNs: bigintField(metadata.mtimeNs),
    ctimeNs: bigintField(metadata.ctimeNs),
    kind,
  });
}

export function sameFileIdentity(
  expected: FileMetadataSnapshot,
  actual: FileMetadataSnapshot,
): boolean {
  return expected.dev === actual.dev && expected.ino === actual.ino;
}

export function sameFileSnapshot(
  expected: FileMetadataSnapshot,
  actual: FileMetadataSnapshot,
): boolean {
  return (
    sameFileIdentity(expected, actual) &&
    expected.mode === actual.mode &&
    expected.size === actual.size &&
    expected.mtimeNs === actual.mtimeNs &&
    expected.ctimeNs === actual.ctimeNs &&
    expected.kind === actual.kind
  );
}
