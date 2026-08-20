import { constants } from "node:fs";

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

// Module initialization is the trust boundary for filesystem constants and intrinsics.
const freezeSnapshot = Object.freeze;
const getOwnPropertyDescriptorSnapshot = Object.getOwnPropertyDescriptor;
const TypeErrorSnapshot = TypeError;
const modeTypeMask = BigInt(constants.S_IFMT);
const directoryMode = BigInt(constants.S_IFDIR);
const fileMode = BigInt(constants.S_IFREG);
const symbolicLinkMode = BigInt(constants.S_IFLNK);

const INVALID_METADATA_MESSAGE = "filesystem metadata must contain valid bigint fields";

function invalidMetadata(): never {
  throw new TypeErrorSnapshot(INVALID_METADATA_MESSAGE);
}

function kindFromMode(mode: bigint): FileKind {
  const type = mode & modeTypeMask;
  if (type === directoryMode) return "directory";
  if (type === fileMode) return "file";
  if (type === symbolicLinkMode) return "symbolic-link";
  return "other";
}

function descriptorDataValue(descriptor: PropertyDescriptor): unknown {
  let valueDescriptor: PropertyDescriptor | undefined;
  try {
    valueDescriptor = getOwnPropertyDescriptorSnapshot(descriptor, "value");
  } catch {
    invalidMetadata();
  }
  if (valueDescriptor === undefined) invalidMetadata();
  return valueDescriptor.value;
}

function ownDataValue(metadata: object, property: PropertyKey): unknown {
  let descriptor: PropertyDescriptor | undefined;
  try {
    descriptor = getOwnPropertyDescriptorSnapshot(metadata, property);
  } catch {
    invalidMetadata();
  }
  if (descriptor === undefined) invalidMetadata();
  return descriptorDataValue(descriptor);
}

/**
 * Copies runtime lstat metadata without retaining mutable objects or lazy Date accessors.
 * File kind is derived only from the captured POSIX mode bits.
 */
export function snapshotFileMetadata(metadata: unknown): FileMetadataSnapshot {
  if (typeof metadata !== "object" || metadata === null) invalidMetadata();

  const dev = ownDataValue(metadata, "dev");
  const ino = ownDataValue(metadata, "ino");
  const mode = ownDataValue(metadata, "mode");
  const size = ownDataValue(metadata, "size");
  const mtimeNs = ownDataValue(metadata, "mtimeNs");
  const ctimeNs = ownDataValue(metadata, "ctimeNs");

  let kindDescriptor: PropertyDescriptor | undefined;
  try {
    kindDescriptor = getOwnPropertyDescriptorSnapshot(metadata, "kind");
  } catch {
    invalidMetadata();
  }
  const declaredKind =
    kindDescriptor === undefined ? undefined : descriptorDataValue(kindDescriptor);

  if (
    typeof dev !== "bigint" ||
    typeof ino !== "bigint" ||
    typeof mode !== "bigint" ||
    typeof size !== "bigint" ||
    typeof mtimeNs !== "bigint" ||
    typeof ctimeNs !== "bigint"
  ) {
    invalidMetadata();
  }

  const kind = kindFromMode(mode);
  if (kindDescriptor !== undefined && declaredKind !== kind) invalidMetadata();

  return freezeSnapshot({
    dev,
    ino,
    mode,
    size,
    mtimeNs,
    ctimeNs,
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
