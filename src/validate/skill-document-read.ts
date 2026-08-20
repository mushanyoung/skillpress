import { type BigIntStats, constants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { TextDecoder } from "node:util";

import type { RootInspection } from "./skill-root.js";
import { rootInspectionIsCurrent } from "./skill-root.js";
import { MAX_SKILL_DOCUMENT_BYTES } from "./types.js";

const READ_BUFFER_BYTES = 64 * 1024;

export interface DocumentInspection {
  readonly root: RootInspection;
  readonly path: string;
  readonly metadata: BigIntStats;
}

type ReadFailureCode =
  | "skill.document.read"
  | "skill.document.changed"
  | "skill.document.too_large"
  | "skill.document.encoding";

export type SkillDocumentReadResult =
  | { readonly ok: true; readonly text: string }
  | { readonly ok: false; readonly code: ReadFailureCode; readonly message: string };

export interface SkillFileHandle {
  stat(options: { readonly bigint: true }): Promise<BigIntStats>;
  read(
    buffer: Buffer,
    offset: number,
    length: number,
    position: null,
  ): Promise<{ readonly bytesRead: number }>;
  close(): Promise<void>;
}

export type OpenSkillFile = (path: string, flags: number) => Promise<SkillFileHandle>;
export type VerifySkillRoot = (root: RootInspection) => Promise<boolean>;

/** @internal Cross-platform override used only by filesystem race tests. */
export interface SkillFileOpenCapabilities {
  readonly noFollow: number | undefined;
  readonly nonBlock: number | undefined;
}

function sameIdentity(expected: BigIntStats, actual: BigIntStats): boolean {
  return expected.dev === actual.dev && expected.ino === actual.ino;
}

function sameSnapshot(expected: BigIntStats, actual: BigIntStats): boolean {
  return (
    sameIdentity(expected, actual) &&
    expected.size === actual.size &&
    expected.mtimeNs === actual.mtimeNs &&
    expected.ctimeNs === actual.ctimeNs
  );
}

function failure(code: ReadFailureCode, message: string): SkillDocumentReadResult {
  return { ok: false, code, message };
}

/** @internal Reads an already-inspected document without following a replacement symlink. */
export async function readInspectedAgentSkillDocument(
  inspected: DocumentInspection,
  openFile: OpenSkillFile = open,
  capabilities: SkillFileOpenCapabilities = {
    noFollow: (constants as Partial<typeof constants>).O_NOFOLLOW,
    nonBlock: (constants as Partial<typeof constants>).O_NONBLOCK,
  },
  verifyRoot: VerifySkillRoot = rootInspectionIsCurrent,
): Promise<SkillDocumentReadResult> {
  let handle: SkillFileHandle | undefined;
  try {
    if (!(await verifyRoot(inspected.root))) {
      return failure(
        "skill.document.changed",
        "skill directory changed before SKILL.md was opened",
      );
    }
    if (inspected.metadata.size > BigInt(MAX_SKILL_DOCUMENT_BYTES)) {
      return failure(
        "skill.document.too_large",
        `SKILL.md exceeds ${MAX_SKILL_DOCUMENT_BYTES} bytes`,
      );
    }
    if (inspected.metadata.size < 0n) {
      return failure("skill.document.read", "SKILL.md has invalid filesystem metadata");
    }
    const { noFollow, nonBlock } = capabilities;
    const canNoFollow = typeof noFollow === "number" && noFollow !== 0;
    const canOpenNonBlocking = typeof nonBlock === "number" && nonBlock !== 0;
    if (!canNoFollow) {
      const beforeOpen = await lstat(inspected.path, { bigint: true });
      if (
        !sameSnapshot(inspected.metadata, beforeOpen) ||
        !beforeOpen.isFile() ||
        beforeOpen.isSymbolicLink()
      ) {
        return failure("skill.document.changed", "SKILL.md changed before it was opened");
      }
    }
    handle = await openFile(
      inspected.path,
      constants.O_RDONLY | (canNoFollow ? noFollow : 0) | (canOpenNonBlocking ? nonBlock : 0),
    );
    const opened = await handle.stat({ bigint: true });
    if (!opened.isFile() || !sameSnapshot(inspected.metadata, opened)) {
      return failure("skill.document.changed", "SKILL.md changed while it was being opened");
    }
    const chunks: Buffer[] = [];
    const buffer = Buffer.alloc(READ_BUFFER_BYTES);
    let total = 0;
    while (total <= MAX_SKILL_DOCUMENT_BYTES) {
      const requested = Math.min(buffer.length, MAX_SKILL_DOCUMENT_BYTES + 1 - total);
      const { bytesRead } = await handle.read(buffer, 0, requested, null);
      if (!Number.isSafeInteger(bytesRead) || bytesRead < 0 || bytesRead > requested) {
        return failure("skill.document.read", "SKILL.md returned an invalid read result");
      }
      if (bytesRead === 0) break;
      chunks.push(Buffer.from(buffer.subarray(0, bytesRead)));
      total += bytesRead;
    }
    if (total > MAX_SKILL_DOCUMENT_BYTES) {
      return failure(
        "skill.document.too_large",
        `SKILL.md exceeds ${MAX_SKILL_DOCUMENT_BYTES} bytes`,
      );
    }

    const afterRead = await handle.stat({ bigint: true });
    const finalPath = await lstat(inspected.path, { bigint: true });
    if (
      BigInt(total) !== opened.size ||
      !sameSnapshot(opened, afterRead) ||
      !sameSnapshot(opened, finalPath) ||
      finalPath.isSymbolicLink() ||
      !finalPath.isFile() ||
      !(await verifyRoot(inspected.root))
    ) {
      return failure("skill.document.changed", "SKILL.md changed while it was being read");
    }
    try {
      const bytes = Buffer.concat(chunks, total);
      const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
      return { ok: true, text };
    } catch {
      return failure("skill.document.encoding", "SKILL.md must contain valid UTF-8");
    }
  } catch {
    return failure("skill.document.read", "SKILL.md cannot be read safely");
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
