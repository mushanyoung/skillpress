import type { BigIntStats } from "node:fs";
import { lstat, realpath } from "node:fs/promises";
import { join, parse, relative, resolve, sep } from "node:path";

import { MAX_PATH_COMPONENTS } from "../path-safety.js";
import type { DiagnosticCollector } from "./diagnostics.js";

export interface PathComponentInspection {
  readonly path: string;
  readonly metadata: BigIntStats;
}

export interface RootInspection {
  readonly path: string;
  readonly canonicalPath: string;
  readonly components: readonly PathComponentInspection[];
  readonly metadata: BigIntStats;
}

export interface RootInspectionIo {
  readonly resolvePath: (path: string) => string;
  readonly lstatPath: (path: string) => Promise<BigIntStats>;
  readonly realpathPath: (path: string) => Promise<string>;
}

const DEFAULT_IO: RootInspectionIo = {
  resolvePath: resolve,
  lstatPath: (path) => lstat(path, { bigint: true }),
  realpathPath: realpath,
};

function sameIdentity(expected: BigIntStats, actual: BigIntStats): boolean {
  return expected.dev === actual.dev && expected.ino === actual.ino;
}

function isMissing(error: unknown): boolean {
  try {
    return typeof error === "object" && error !== null && Reflect.get(error, "code") === "ENOENT";
  } catch {
    return false;
  }
}

async function pathComponentsAreCurrent(
  components: readonly PathComponentInspection[],
  lstatPath: RootInspectionIo["lstatPath"],
): Promise<boolean> {
  try {
    for (const component of components) {
      const current = await lstatPath(component.path);
      if (
        !sameIdentity(component.metadata, current) ||
        !current.isDirectory() ||
        current.isSymbolicLink()
      ) {
        return false;
      }
    }
    return true;
  } catch {
    return false;
  }
}

export async function rootInspectionIsCurrent(
  root: RootInspection,
  io: RootInspectionIo = DEFAULT_IO,
): Promise<boolean> {
  try {
    return (
      (await io.realpathPath(root.path)) === root.canonicalPath &&
      (await pathComponentsAreCurrent(root.components, io.lstatPath))
    );
  } catch {
    return false;
  }
}

export async function inspectAgentSkillRoot(
  directory: string,
  diagnostics: DiagnosticCollector,
  io: RootInspectionIo = DEFAULT_IO,
): Promise<RootInspection | undefined> {
  let absolutePath: string;
  let filesystemRoot: string;
  let names: string[];
  try {
    absolutePath = io.resolvePath(directory);
    filesystemRoot = parse(absolutePath).root;
    names = relative(filesystemRoot, absolutePath).split(sep).filter(Boolean);
  } catch {
    diagnostics.add(
      "skill.document.read",
      "error",
      "skillpress",
      "skill directory cannot be resolved",
      { file: "." },
    );
    return undefined;
  }
  if (names.length > MAX_PATH_COMPONENTS) {
    diagnostics.add(
      "skill.root.too_deep",
      "error",
      "skillpress",
      `skill directory path exceeds ${MAX_PATH_COMPONENTS} components`,
      { file: "." },
    );
    return undefined;
  }
  const components: PathComponentInspection[] = [];
  let currentPath = filesystemRoot;
  try {
    for (const name of ["", ...names]) {
      if (name !== "") currentPath = join(currentPath, name);
      const metadata = await io.lstatPath(currentPath);
      if (metadata.isSymbolicLink()) {
        diagnostics.add(
          "skill.root.symlink",
          "error",
          "skillpress",
          "skill directory path must not contain symbolic links",
          { file: "." },
        );
        return undefined;
      }
      if (!metadata.isDirectory()) {
        diagnostics.add(
          "skill.root.not_directory",
          "error",
          "skillpress",
          "skill root path components must be directories",
          { file: "." },
        );
        return undefined;
      }
      components.push({ path: currentPath, metadata });
    }
  } catch (error) {
    const missing = isMissing(error);
    diagnostics.add(
      missing ? "skill.root.missing" : "skill.document.read",
      "error",
      "skillpress",
      missing ? "skill directory does not exist" : "skill directory cannot be inspected",
      { file: "." },
    );
    return undefined;
  }
  const metadata = (components[components.length - 1] as PathComponentInspection).metadata;
  let canonicalPath: string;
  try {
    canonicalPath = await io.realpathPath(absolutePath);
    const canonical = await io.lstatPath(canonicalPath);
    const current = { path: absolutePath, canonicalPath, components, metadata };
    if (!sameIdentity(metadata, canonical) || !(await rootInspectionIsCurrent(current, io))) {
      diagnostics.add(
        "skill.root.changed",
        "error",
        "skillpress",
        "skill directory changed while it was being inspected",
        { file: "." },
      );
      return undefined;
    }
  } catch {
    diagnostics.add(
      "skill.document.read",
      "error",
      "skillpress",
      "skill directory cannot be inspected safely",
      { file: "." },
    );
    return undefined;
  }
  return { path: absolutePath, canonicalPath, components, metadata };
}
