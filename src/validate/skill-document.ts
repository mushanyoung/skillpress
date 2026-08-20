import type { BigIntStats } from "node:fs";
import { lstat, opendir } from "node:fs/promises";
import { basename, join } from "node:path";

import type { DiagnosticCollector } from "./diagnostics.js";
import { snapshotFileMetadata } from "./file-metadata.js";
import { type DocumentInspection, readInspectedAgentSkillDocument } from "./skill-document-read.js";
import {
  inspectAgentSkillRoot,
  isGenuineRootInspection,
  type RootInspection,
  rootInspectionIsCurrent,
} from "./skill-root.js";
import { MAX_SKILL_DIRECTORY_ENTRIES } from "./types.js";

const SKILL_DOCUMENT_NAME = "SKILL.md";

export interface LoadedSkillDocument {
  readonly text: string;
  readonly directoryName: string;
  readonly inspection: DocumentInspection;
}

export interface SkillDirectoryHandle {
  read(): Promise<{ readonly name: string } | null>;
  close(): Promise<void>;
}

export interface DocumentInspectionIo {
  readonly openDirectory: (path: string) => Promise<SkillDirectoryHandle>;
  readonly lstatPath: (path: string) => Promise<BigIntStats>;
  readonly rootIsCurrent: (root: RootInspection) => Promise<boolean>;
}

// Module initialization is the trust boundary for the provenance intrinsics below.
const basenameSnapshot = basename;
const joinSnapshot = join;
const lstatSnapshot = lstat;
const opendirSnapshot = opendir;

const DEFAULT_IO: DocumentInspectionIo = {
  openDirectory: opendirSnapshot,
  lstatPath: (path) => lstatSnapshot(path, { bigint: true }),
  rootIsCurrent: rootInspectionIsCurrent,
};

const applySnapshot = Reflect.apply;
const freezeSnapshot = Object.freeze;
const weakSetAddSnapshot = WeakSet.prototype.add;
const weakSetHasSnapshot = WeakSet.prototype.has;
const genuineDocumentInspections = new WeakSet<object>();

function registerDocumentInspection(document: DocumentInspection): DocumentInspection {
  applySnapshot(weakSetAddSnapshot, genuineDocumentInspections, [document]);
  return document;
}

/** @internal Accept only identities completed by this module; no properties are inspected. */
export function isGenuineDocumentInspection(value: unknown): value is DocumentInspection {
  if ((typeof value !== "object" && typeof value !== "function") || value === null) {
    return false;
  }
  return applySnapshot(weakSetHasSnapshot, genuineDocumentInspections, [value]) as boolean;
}

export async function inspectAgentSkillDocument(
  root: RootInspection,
  diagnostics: DiagnosticCollector,
  io: DocumentInspectionIo = DEFAULT_IO,
): Promise<DocumentInspection | undefined> {
  if (!isGenuineRootInspection(root)) {
    diagnostics.add(
      "skill.root.changed",
      "error",
      "skillpress",
      "skill directory changed while it was being read",
      { file: "." },
    );
    return undefined;
  }
  let directory: SkillDirectoryHandle | undefined;
  let exact = false;
  let wrongCase = false;
  let entries = 0;
  let scanFailed = false;
  try {
    directory = await io.openDirectory(root.path);
    while (true) {
      const entry = await directory.read();
      if (entry === null) break;
      entries += 1;
      if (entries > MAX_SKILL_DIRECTORY_ENTRIES) break;
      if (entry.name === SKILL_DOCUMENT_NAME) exact = true;
      else if (entry.name.toLowerCase() === SKILL_DOCUMENT_NAME.toLowerCase()) wrongCase = true;
    }
  } catch {
    scanFailed = true;
  }
  if (directory !== undefined) {
    try {
      await directory.close();
    } catch {
      scanFailed = true;
    }
  }
  if (scanFailed) {
    diagnostics.add("skill.document.read", "error", "skillpress", "skill directory cannot be read");
    return undefined;
  }
  if (entries > MAX_SKILL_DIRECTORY_ENTRIES) {
    diagnostics.add(
      "skill.root.too_many_entries",
      "error",
      "skillpress",
      `skill directory exceeds ${MAX_SKILL_DIRECTORY_ENTRIES} immediate entries`,
    );
    return undefined;
  }
  if (!(await io.rootIsCurrent(root))) {
    diagnostics.add(
      "skill.root.changed",
      "error",
      "skillpress",
      "skill directory changed while it was being read",
      { file: "." },
    );
    return undefined;
  }
  if (exact && wrongCase) {
    diagnostics.add(
      "skill.document.case_collision",
      "error",
      "portable",
      "skill directory contains case-colliding skill document names",
    );
    return undefined;
  }
  if (!exact) {
    diagnostics.add(
      wrongCase ? "skill.document.case_mismatch" : "skill.document.missing",
      "error",
      "agent-skills",
      wrongCase
        ? "skill document must be named exactly SKILL.md"
        : "skill directory must contain SKILL.md",
    );
    return undefined;
  }
  const path = joinSnapshot(root.path, SKILL_DOCUMENT_NAME);
  let metadata: DocumentInspection["metadata"];
  try {
    metadata = freezeSnapshot(snapshotFileMetadata(await io.lstatPath(path)));
  } catch {
    diagnostics.add("skill.document.read", "error", "skillpress", "SKILL.md cannot be inspected");
    return undefined;
  }
  if (metadata.kind === "symbolic-link") {
    diagnostics.add(
      "skill.document.symlink",
      "error",
      "skillpress",
      "SKILL.md must not be a symbolic link",
    );
    return undefined;
  }
  if (metadata.kind !== "file") {
    diagnostics.add(
      "skill.document.not_file",
      "error",
      "agent-skills",
      "SKILL.md must be a regular file",
    );
    return undefined;
  }
  if (!(await io.rootIsCurrent(root))) {
    diagnostics.add(
      "skill.root.changed",
      "error",
      "skillpress",
      "skill directory changed while SKILL.md was being inspected",
      { file: "." },
    );
    return undefined;
  }
  return registerDocumentInspection(freezeSnapshot({ root, path, metadata }));
}

export async function loadAgentSkillDocument(
  directory: string,
  diagnostics: DiagnosticCollector,
): Promise<LoadedSkillDocument | undefined> {
  const root = await inspectAgentSkillRoot(directory, diagnostics);
  if (root === undefined) return undefined;
  const document = await inspectAgentSkillDocument(root, diagnostics);
  if (document === undefined) return undefined;
  const result = await readInspectedAgentSkillDocument(document);
  if (!result.ok) {
    diagnostics.add(result.code, "error", "skillpress", result.message);
    return undefined;
  }
  return Object.freeze({
    text: result.text,
    directoryName: basenameSnapshot(document.root.canonicalPath),
    inspection: document,
  });
}
