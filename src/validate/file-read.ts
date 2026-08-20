import { type BigIntStats, constants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { TextDecoder } from "node:util";

import {
  type FileMetadataSnapshot,
  sameFileSnapshot,
  snapshotFileMetadata,
} from "./file-metadata.js";
import { MAX_SKILL_DOCUMENT_BYTES } from "./types.js";

const READ_BUFFER_BYTES = 64 * 1024;

// Module initialization is the trust boundary for the result-wrapper intrinsics.
const applySnapshot = Reflect.apply;
const objectConstructorSnapshot = Object;
const definePropertySnapshot = Object.defineProperty;
const freezeSnapshot = Object.freeze;

export interface InspectedFile {
  readonly path: string;
  readonly metadata: FileMetadataSnapshot;
}

export interface InspectedFileHandle {
  stat(options: { readonly bigint: true }): Promise<BigIntStats>;
  read(
    buffer: Buffer,
    offset: number,
    length: number,
    position: null,
  ): Promise<{ readonly bytesRead: number }>;
  close(): Promise<void>;
}

export interface FileOpenCapabilities {
  readonly noFollow: boolean;
  readonly nonBlock: boolean;
}

export interface InspectedFileReadIo {
  readonly lstatPath: (path: string) => Promise<BigIntStats>;
  readonly openFile: (path: string, flags: number) => Promise<InspectedFileHandle>;
  readonly capabilities: FileOpenCapabilities;
}

export type InspectedUtf8FileReadResult =
  | { readonly ok: true; readonly text: string; readonly byteLength: number }
  | {
      readonly ok: false;
      readonly reason: "too-large" | "invalid-metadata" | "invalid-read" | "invalid-utf8" | "io";
    }
  | {
      readonly ok: false;
      readonly reason: "changed";
      readonly subject: "context";
      readonly phase: "before-open" | "reading";
    }
  | {
      readonly ok: false;
      readonly reason: "changed";
      readonly subject: "file";
      readonly phase: "before-open" | "opening" | "reading";
    };

type SimpleReadFailureReason =
  | "too-large"
  | "invalid-metadata"
  | "invalid-read"
  | "invalid-utf8"
  | "io";

const DEFAULT_IO: InspectedFileReadIo = freezeSnapshot({
  lstatPath: (path: string) => lstat(path, { bigint: true }),
  openFile: open,
  capabilities: freezeSnapshot({
    noFollow:
      typeof (constants as Partial<typeof constants>).O_NOFOLLOW === "number" &&
      (constants as Partial<typeof constants>).O_NOFOLLOW !== 0,
    nonBlock:
      typeof (constants as Partial<typeof constants>).O_NONBLOCK === "number" &&
      (constants as Partial<typeof constants>).O_NONBLOCK !== 0,
  }),
});

const NO_FOLLOW_FLAG = (constants as Partial<typeof constants>).O_NOFOLLOW;
const NON_BLOCK_FLAG = (constants as Partial<typeof constants>).O_NONBLOCK;

function copyInspectedFile(inspected: InspectedFile): InspectedFile | undefined {
  const path = inspected.path;
  const metadata = inspected.metadata;
  const { dev, ino, mode, size, mtimeNs, ctimeNs, kind } = metadata;
  if (
    typeof path !== "string" ||
    typeof dev !== "bigint" ||
    typeof ino !== "bigint" ||
    typeof mode !== "bigint" ||
    typeof size !== "bigint" ||
    typeof mtimeNs !== "bigint" ||
    typeof ctimeNs !== "bigint" ||
    kind !== "file"
  ) {
    return undefined;
  }
  return freezeSnapshot({
    path,
    metadata: freezeSnapshot({ dev, ino, mode, size, mtimeNs, ctimeNs, kind }),
  });
}

/**
 * Adds a file-read-local non-thenable barrier to an outer async result record.
 * Upstream promises, nested values, and native Promise machinery remain outside this boundary.
 */
function freezeAsyncResult<T extends object>(value: T): Readonly<T> {
  applySnapshot(definePropertySnapshot, objectConstructorSnapshot, [
    value,
    "then",
    { configurable: false, enumerable: false, value: undefined, writable: false },
  ]);
  return applySnapshot(freezeSnapshot, objectConstructorSnapshot, [value]) as Readonly<T>;
}

function failure(reason: SimpleReadFailureReason): InspectedUtf8FileReadResult {
  return freezeAsyncResult({ ok: false as const, reason });
}

function changed(
  ...change:
    | readonly [subject: "context", phase: "before-open" | "reading"]
    | readonly [subject: "file", phase: "before-open" | "opening" | "reading"]
): InspectedUtf8FileReadResult {
  const [subject, phase] = change;
  if (subject === "context") {
    return freezeAsyncResult({ ok: false as const, reason: "changed" as const, subject, phase });
  }
  return freezeAsyncResult({ ok: false as const, reason: "changed" as const, subject, phase });
}

/** @internal Reads a bounded UTF-8 file while revalidating its inspection context. */
export async function readInspectedUtf8File<T extends InspectedFile>(
  inspected: T,
  maxBytes: number,
  inspectionIsCurrent: (inspected: T) => Promise<boolean>,
  io: InspectedFileReadIo = DEFAULT_IO,
): Promise<InspectedUtf8FileReadResult> {
  let handle: InspectedFileHandle | undefined;
  try {
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 0 || maxBytes > MAX_SKILL_DOCUMENT_BYTES) {
      return failure("invalid-metadata");
    }
    const current = copyInspectedFile(inspected);
    if (current === undefined) return failure("invalid-metadata");
    const lstatPath = io.lstatPath;
    const openFile = io.openFile;
    const capabilities = io.capabilities;
    if (typeof lstatPath !== "function" || typeof openFile !== "function") return failure("io");
    const noFollow =
      capabilities.noFollow === true && typeof NO_FOLLOW_FLAG === "number" && NO_FOLLOW_FLAG !== 0
        ? NO_FOLLOW_FLAG
        : undefined;
    const nonBlock =
      capabilities.nonBlock === true && typeof NON_BLOCK_FLAG === "number" && NON_BLOCK_FLAG !== 0
        ? NON_BLOCK_FLAG
        : undefined;

    if ((await inspectionIsCurrent(inspected)) !== true) {
      return changed("context", "before-open");
    }
    const inspectedSize = current.metadata.size;
    if (inspectedSize < 0n) {
      return failure("invalid-metadata");
    }
    if (inspectedSize > BigInt(maxBytes)) {
      return failure("too-large");
    }

    const canNoFollow = noFollow !== undefined;
    const canOpenNonBlocking = nonBlock !== undefined;
    if (!canNoFollow) {
      const beforeOpen = snapshotFileMetadata(await lstatPath(current.path));
      if (!sameFileSnapshot(current.metadata, beforeOpen) || beforeOpen.kind !== "file") {
        return changed("file", "before-open");
      }
    }

    handle = await openFile(
      current.path,
      constants.O_RDONLY | (canNoFollow ? noFollow : 0) | (canOpenNonBlocking ? nonBlock : 0),
    );
    const opened = snapshotFileMetadata(await handle.stat({ bigint: true }));
    if (opened.kind !== "file" || !sameFileSnapshot(current.metadata, opened)) {
      return changed("file", "opening");
    }

    const chunks: Buffer[] = [];
    const buffer = Buffer.alloc(READ_BUFFER_BYTES);
    let total = 0;
    while (total <= maxBytes) {
      const requested = Math.min(buffer.length, maxBytes + 1 - total);
      const { bytesRead } = await handle.read(buffer, 0, requested, null);
      if (!Number.isSafeInteger(bytesRead) || bytesRead < 0 || bytesRead > requested) {
        return failure("invalid-read");
      }
      if (bytesRead === 0) break;
      chunks.push(Buffer.from(buffer.subarray(0, bytesRead)));
      total += bytesRead;
    }
    if (total > maxBytes) return failure("too-large");

    const afterRead = snapshotFileMetadata(await handle.stat({ bigint: true }));
    const completedHandle = handle;
    handle = undefined;
    try {
      await completedHandle.close();
    } catch {
      // Closing a read-only descriptor does not change the bytes copied into private memory.
    }
    const finalPath = snapshotFileMetadata(await lstatPath(current.path));
    const contextIsCurrent = (await inspectionIsCurrent(inspected)) === true;
    if (
      BigInt(total) !== opened.size ||
      !sameFileSnapshot(opened, afterRead) ||
      !sameFileSnapshot(opened, finalPath) ||
      finalPath.kind !== "file"
    ) {
      return changed("file", "reading");
    }
    if (!contextIsCurrent) return changed("context", "reading");

    let text: string;
    try {
      const bytes = Buffer.concat(chunks, total);
      text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
    } catch {
      return failure("invalid-utf8");
    }
    return freezeAsyncResult({ ok: true as const, text, byteLength: total });
  } catch {
    return failure("io");
  } finally {
    if (handle !== undefined) {
      try {
        await handle.close();
      } catch {
        // The bytes are already copied into private memory; closing does not change them.
      }
    }
  }
}
