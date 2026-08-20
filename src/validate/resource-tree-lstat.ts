import type { BigIntStats } from "node:fs";
import { lstat } from "node:fs/promises";

import { sampleAbortSignal, type AbortSignalSample } from "./abort-signal.js";
import { type FileMetadataSnapshot, snapshotFileMetadata } from "./file-metadata.js";

export interface ResourceTreeLstatIo {
  readonly lstatPath: (path: string) => Promise<BigIntStats>;
}

export type ResourceTreeLstatResult =
  | Readonly<{ ok: true; metadata: FileMetadataSnapshot }>
  | Readonly<{
      ok: false;
      reason: "invalid_input" | "aborted" | "invalid_metadata" | "io";
    }>;

type LstatPath = ResourceTreeLstatIo["lstatPath"];

// Module initialization is the trust boundary for filesystem bindings, producers, and intrinsics.
const applySnapshot = Reflect.apply;
const objectRef = Object;
const freezeSnapshot = Object.freeze;
const getOwnPropertyDescriptorSnapshot = Object.getOwnPropertyDescriptor;
const lstatBuiltinSnapshot = lstat;
const sampleAbortSignalSnapshot = sampleAbortSignal;
const snapshotFileMetadataSnapshot = snapshotFileMetadata;
const BIGINT_LSTAT_OPTIONS = freezeSnapshot({ bigint: true as const });

const DEFAULT_IO: ResourceTreeLstatIo = freezeSnapshot({
  lstatPath: (path: string) => lstatBuiltinSnapshot(path, BIGINT_LSTAT_OPTIONS),
});

const INVALID_INPUT: ResourceTreeLstatResult = freezeSnapshot({
  ok: false,
  reason: "invalid_input",
});
const ABORTED: ResourceTreeLstatResult = freezeSnapshot({ ok: false, reason: "aborted" });
const INVALID_METADATA: ResourceTreeLstatResult = freezeSnapshot({
  ok: false,
  reason: "invalid_metadata",
});
const IO: ResourceTreeLstatResult = freezeSnapshot({ ok: false, reason: "io" });

function applyIntrinsic<T>(
  intrinsic: (...argumentsList: never[]) => unknown,
  receiver: unknown,
  args: unknown[],
): T {
  return applySnapshot(intrinsic, receiver, args) as T;
}

function getOwnDescriptor(value: object, property: PropertyKey): PropertyDescriptor | undefined {
  return applyIntrinsic<PropertyDescriptor | undefined>(
    getOwnPropertyDescriptorSnapshot,
    objectRef,
    [value, property],
  );
}

function sampleSignal(value: unknown): AbortSignalSample {
  try {
    return applyIntrinsic<AbortSignalSample>(sampleAbortSignalSnapshot, undefined, [value]);
  } catch {
    return "invalid";
  }
}

function captureLstatPath(value: unknown): LstatPath | undefined {
  if ((typeof value !== "object" && typeof value !== "function") || value === null) {
    return undefined;
  }
  try {
    const descriptor = getOwnDescriptor(value, "lstatPath");
    if (descriptor === undefined) return undefined;
    const valueDescriptor = getOwnDescriptor(descriptor, "value");
    if (valueDescriptor === undefined || typeof valueDescriptor.value !== "function") {
      return undefined;
    }
    return valueDescriptor.value as LstatPath;
  } catch {
    return undefined;
  }
}

/**
 * Cooperatively samples cancellation around one lstat without granting path or filesystem authority.
 * An in-flight lstat is allowed to settle; cancellation is observed only at the two checkpoints.
 */
export async function lstatResourceTreePath(
  pathValue: unknown,
  signalValue: unknown = undefined,
  io: ResourceTreeLstatIo = DEFAULT_IO,
): Promise<ResourceTreeLstatResult> {
  if (typeof pathValue !== "string") return INVALID_INPUT;

  const before = sampleSignal(signalValue);
  if (before === "invalid") return INVALID_INPUT;
  const lstatPath = captureLstatPath(io);
  if (lstatPath === undefined) return IO;
  if (before === "aborted") return ABORTED;

  let metadataValue: unknown;
  let rejected = false;
  try {
    metadataValue = await applyIntrinsic<Promise<BigIntStats>>(lstatPath, undefined, [pathValue]);
  } catch {
    rejected = true;
  }

  const after = sampleSignal(signalValue);
  if (after === "invalid") return INVALID_INPUT;
  if (after === "aborted") return ABORTED;
  if (rejected) return IO;

  try {
    const metadata = applyIntrinsic<FileMetadataSnapshot>(snapshotFileMetadataSnapshot, undefined, [
      metadataValue,
    ]);
    return freezeSnapshot({ ok: true, metadata });
  } catch {
    return INVALID_METADATA;
  }
}
