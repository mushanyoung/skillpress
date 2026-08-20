import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";

import {
  type FileOpenCapabilities,
  type InspectedFile,
  type InspectedFileHandle,
  readInspectedUtf8File,
} from "./file-read.js";
import type { RootInspection } from "./skill-root.js";
import { rootInspectionIsCurrent } from "./skill-root.js";
import { MAX_SKILL_DOCUMENT_BYTES } from "./types.js";

export interface DocumentInspection extends InspectedFile {
  readonly root: RootInspection;
}

type ReadFailureCode =
  | "skill.document.read"
  | "skill.document.changed"
  | "skill.document.too_large"
  | "skill.document.encoding";

export type SkillDocumentReadResult =
  | { readonly ok: true; readonly text: string }
  | { readonly ok: false; readonly code: ReadFailureCode; readonly message: string };

export type SkillFileHandle = InspectedFileHandle;
export type OpenSkillFile = (path: string, flags: number) => Promise<InspectedFileHandle>;
export type VerifySkillRoot = (root: RootInspection) => Promise<boolean>;

/** @internal Cross-platform override used only by filesystem race tests. */
export type SkillFileOpenCapabilities = FileOpenCapabilities;

function failure(code: ReadFailureCode, message: string): SkillDocumentReadResult {
  return Object.freeze({ ok: false, code, message });
}

/** @internal Reads an already-inspected document without following a replacement symlink. */
export async function readInspectedAgentSkillDocument(
  inspected: DocumentInspection,
  openFile: OpenSkillFile = open,
  capabilities: SkillFileOpenCapabilities = {
    noFollow:
      typeof (constants as Partial<typeof constants>).O_NOFOLLOW === "number" &&
      (constants as Partial<typeof constants>).O_NOFOLLOW !== 0,
    nonBlock:
      typeof (constants as Partial<typeof constants>).O_NONBLOCK === "number" &&
      (constants as Partial<typeof constants>).O_NONBLOCK !== 0,
  },
  verifyRoot: VerifySkillRoot = rootInspectionIsCurrent,
): Promise<SkillDocumentReadResult> {
  let root: RootInspection;
  try {
    root = inspected.root;
  } catch {
    return failure("skill.document.read", "SKILL.md cannot be read safely");
  }
  const result = await readInspectedUtf8File(
    inspected,
    MAX_SKILL_DOCUMENT_BYTES,
    () => verifyRoot(root),
    {
      lstatPath: (path) => lstat(path, { bigint: true }),
      openFile,
      capabilities,
    },
  );
  if (result.ok) return Object.freeze({ ok: true, text: result.text });
  switch (result.reason) {
    case "changed":
      if (result.subject === "context" && result.phase === "before-open") {
        return failure(
          "skill.document.changed",
          "skill directory changed before SKILL.md was opened",
        );
      }
      if (result.subject === "file" && result.phase === "before-open") {
        return failure("skill.document.changed", "SKILL.md changed before it was opened");
      }
      if (result.subject === "file" && result.phase === "opening") {
        return failure("skill.document.changed", "SKILL.md changed while it was being opened");
      }
      return failure("skill.document.changed", "SKILL.md changed while it was being read");
    case "too-large":
      return failure(
        "skill.document.too_large",
        `SKILL.md exceeds ${MAX_SKILL_DOCUMENT_BYTES} bytes`,
      );
    case "invalid-metadata":
      return failure("skill.document.read", "SKILL.md has invalid filesystem metadata");
    case "invalid-read":
      return failure("skill.document.read", "SKILL.md returned an invalid read result");
    case "invalid-utf8":
      return failure("skill.document.encoding", "SKILL.md must contain valid UTF-8");
    case "io":
      return failure("skill.document.read", "SKILL.md cannot be read safely");
  }
}
