import { constants } from "node:fs";
import { open } from "node:fs/promises";

import {
  type ResourceTreeCaptureIo,
  snapshotResourceTreeCaptureIo,
} from "./resource-tree-capture.js";
import type { InspectedFileReadIo } from "./file-read.js";

export interface ResourceTreeSessionIo extends ResourceTreeCaptureIo, InspectedFileReadIo {}

// Module initialization is the trust boundary for producers, native bindings, and intrinsics.
const applySnapshot = Reflect.apply;
const objectConstructorSnapshot = Object;
const freezeSnapshot = Object.freeze;
const getOwnPropertyDescriptorSnapshot = Object.getOwnPropertyDescriptor;
const captureIoSnapshot = snapshotResourceTreeCaptureIo;
const openFileSnapshot = open as ResourceTreeSessionIo["openFile"];
const noFollowFlagSnapshot = (constants as Partial<typeof constants>).O_NOFOLLOW;
const nonBlockFlagSnapshot = (constants as Partial<typeof constants>).O_NONBLOCK;

function applyIntrinsic<T>(
  intrinsic: (...argumentsList: never[]) => unknown,
  receiver: unknown,
  argumentsList: unknown[],
): T {
  return applySnapshot(intrinsic, receiver, argumentsList) as T;
}

function freeze<T extends object>(value: T): Readonly<T> {
  return applyIntrinsic<Readonly<T>>(freezeSnapshot, objectConstructorSnapshot, [value]);
}

function ownData(value: unknown, property: PropertyKey): unknown {
  if ((typeof value !== "object" && typeof value !== "function") || value === null) {
    return undefined;
  }
  const descriptor = applyIntrinsic<PropertyDescriptor | undefined>(
    getOwnPropertyDescriptorSnapshot,
    objectConstructorSnapshot,
    [value, property],
  );
  if (descriptor === undefined) return undefined;
  const valueDescriptor = applyIntrinsic<PropertyDescriptor | undefined>(
    getOwnPropertyDescriptorSnapshot,
    objectConstructorSnapshot,
    [descriptor, "value"],
  );
  return valueDescriptor?.value;
}

function captureIo(value: unknown): ResourceTreeCaptureIo | undefined {
  let captured: unknown;
  try {
    captured = applyIntrinsic<unknown>(captureIoSnapshot, undefined, [value]);
    const lstatPath = ownData(captured, "lstatPath");
    if (typeof lstatPath !== "function") return undefined;
    const openDirectory = ownData(captured, "openDirectory");
    if (typeof openDirectory !== "function") return undefined;
    const rootIsCurrent = ownData(captured, "rootIsCurrent");
    if (typeof rootIsCurrent !== "function") return undefined;
    return { lstatPath, openDirectory, rootIsCurrent } as ResourceTreeCaptureIo;
  } catch {
    return undefined;
  }
}

const defaultCaptureIo = captureIo(undefined);
const defaultNoFollow = typeof noFollowFlagSnapshot === "number" && noFollowFlagSnapshot !== 0;
const defaultNonBlock = typeof nonBlockFlagSnapshot === "number" && nonBlockFlagSnapshot !== 0;

/**
 * Snapshot one structural session adapter without granting path, session, or filesystem authority.
 * Callbacks are retained capabilities; this helper does not invoke them.
 */
export function snapshotResourceTreeSessionIo(
  value: unknown = undefined,
): ResourceTreeSessionIo | undefined {
  try {
    const captured = value === undefined ? defaultCaptureIo : captureIo(value);
    if (captured === undefined) return undefined;
    const openFileValue = value === undefined ? openFileSnapshot : ownData(value, "openFile");
    if (typeof openFileValue !== "function") return undefined;
    const openFile = openFileValue as ResourceTreeSessionIo["openFile"];
    const sourceCapabilities = value === undefined ? undefined : ownData(value, "capabilities");
    if (
      value !== undefined &&
      ((typeof sourceCapabilities !== "object" && typeof sourceCapabilities !== "function") ||
        sourceCapabilities === null)
    ) {
      return undefined;
    }
    const noFollow =
      value === undefined ? defaultNoFollow : ownData(sourceCapabilities, "noFollow");
    if (typeof noFollow !== "boolean") return undefined;
    const nonBlock =
      value === undefined ? defaultNonBlock : ownData(sourceCapabilities, "nonBlock");
    if (typeof nonBlock !== "boolean") return undefined;
    return freeze({
      lstatPath: captured.lstatPath,
      openDirectory: captured.openDirectory,
      rootIsCurrent: captured.rootIsCurrent,
      openFile,
      capabilities: freeze({ noFollow, nonBlock }),
    });
  } catch {
    return undefined;
  }
}
