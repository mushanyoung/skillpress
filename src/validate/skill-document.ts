import type { BigIntStats } from "node:fs";
import { lstat, opendir } from "node:fs/promises";
import { basename, join } from "node:path";

import type { DiagnosticCollector } from "./diagnostics.js";
import { type DocumentInspection, readInspectedAgentSkillDocument } from "./skill-document-read.js";
import {
  inspectAgentSkillRoot,
  type RootInspection,
  rootInspectionIsCurrent,
} from "./skill-root.js";
import { MAX_SKILL_DIRECTORY_ENTRIES } from "./types.js";

const SKILL_DOCUMENT_NAME = "SKILL.md";

export interface LoadedSkillDocument {
  readonly text: string;
  readonly directoryName: string;
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

const DEFAULT_IO: DocumentInspectionIo = {
  openDirectory: opendir,
  lstatPath: (path) => lstat(path, { bigint: true }),
  rootIsCurrent: rootInspectionIsCurrent,
};

export async function inspectAgentSkillDocument(
  root: RootInspection,
  diagnostics: DiagnosticCollector,
  io: DocumentInspectionIo = DEFAULT_IO,
): Promise<DocumentInspection | undefined> {
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
  const path = join(root.path, SKILL_DOCUMENT_NAME);
  let metadata: BigIntStats;
  try {
    metadata = await io.lstatPath(path);
  } catch {
    diagnostics.add("skill.document.read", "error", "skillpress", "SKILL.md cannot be inspected");
    return undefined;
  }
  if (metadata.isSymbolicLink()) {
    diagnostics.add(
      "skill.document.symlink",
      "error",
      "skillpress",
      "SKILL.md must not be a symbolic link",
    );
    return undefined;
  }
  if (!metadata.isFile()) {
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
  return { root, path, metadata };
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
  return { text: result.text, directoryName: basename(root.canonicalPath) };
}
