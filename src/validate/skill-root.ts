import type { BigIntStats } from "node:fs";
import { lstat, realpath } from "node:fs/promises";
import { parse, relative, resolve, sep } from "node:path";

import { MAX_PATH_COMPONENTS } from "../path-safety.js";
import type { DiagnosticCollector } from "./diagnostics.js";
import {
  type FileMetadataSnapshot,
  sameFileIdentity,
  snapshotFileMetadata,
} from "./file-metadata.js";

export interface PathComponentInspection {
  readonly path: string;
  readonly metadata: FileMetadataSnapshot;
}

export interface RootInspection {
  readonly path: string;
  readonly canonicalPath: string;
  readonly components: readonly PathComponentInspection[];
  readonly metadata: FileMetadataSnapshot;
}

export interface RootInspectionIo {
  readonly resolvePath: (path: string) => string;
  readonly lstatPath: (path: string) => Promise<BigIntStats>;
  readonly realpathPath: (path: string) => Promise<string>;
}

// Module initialization is the trust boundary for the provenance intrinsics below.
const lstatSnapshot = lstat;
const parseSnapshot = parse;
const realpathSnapshot = realpath;
const relativeSnapshot = relative;
const resolveSnapshot = resolve;
const separatorSnapshot = sep;

const DEFAULT_IO: RootInspectionIo = {
  resolvePath: resolveSnapshot,
  lstatPath: (path) => lstatSnapshot(path, { bigint: true }),
  realpathPath: realpathSnapshot,
};

const applySnapshot = Reflect.apply;
const definePropertySnapshot = Object.defineProperty;
const freezeSnapshot = Object.freeze;
const splitSnapshot = String.prototype.split;
const weakSetAddSnapshot = WeakSet.prototype.add;
const weakSetHasSnapshot = WeakSet.prototype.has;
const genuineRootInspections = new WeakSet<object>();

function registerRootInspection(root: RootInspection): RootInspection {
  applySnapshot(weakSetAddSnapshot, genuineRootInspections, [root]);
  return root;
}

function appendOwnDataSlot<T>(values: T[], value: T): void {
  applySnapshot(definePropertySnapshot, Object, [
    values,
    values.length,
    { __proto__: null, configurable: true, enumerable: true, value, writable: true },
  ]);
}

function splitPath(value: string): string[] {
  return applySnapshot(splitSnapshot, value, [separatorSnapshot]) as string[];
}

/** @internal Accept only identities completed by this module; no properties are inspected. */
export function isGenuineRootInspection(value: unknown): value is RootInspection {
  if ((typeof value !== "object" && typeof value !== "function") || value === null) {
    return false;
  }
  return applySnapshot(weakSetHasSnapshot, genuineRootInspections, [value]) as boolean;
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
    for (let index = 0; index < components.length; index += 1) {
      const component = components[index] as PathComponentInspection;
      const current = snapshotFileMetadata(await lstatPath(component.path));
      if (!sameFileIdentity(component.metadata, current) || current.kind !== "directory") {
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
    const resolvedPath: unknown = io.resolvePath(directory);
    if (typeof resolvedPath !== "string") throw new TypeError("resolved path must be a string");
    absolutePath = resolvedPath;
    filesystemRoot = parseSnapshot(absolutePath).root;
    const pathParts = splitPath(relativeSnapshot(filesystemRoot, absolutePath));
    names = [];
    for (let index = 0; index < pathParts.length; index += 1) {
      const name = pathParts[index];
      if (name !== undefined && name !== "") {
        appendOwnDataSlot(names, name);
      }
    }
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
    for (let index = 0; index <= names.length; index += 1) {
      const name = index === 0 ? "" : (names[index - 1] as string);
      if (name !== "") {
        currentPath =
          index === 1 ? `${filesystemRoot}${name}` : `${currentPath}${separatorSnapshot}${name}`;
      }
      const metadata = freezeSnapshot(snapshotFileMetadata(await io.lstatPath(currentPath)));
      if (metadata.kind === "symbolic-link") {
        diagnostics.add(
          "skill.root.symlink",
          "error",
          "skillpress",
          "skill directory path must not contain symbolic links",
          { file: "." },
        );
        return undefined;
      }
      if (metadata.kind !== "directory") {
        diagnostics.add(
          "skill.root.not_directory",
          "error",
          "skillpress",
          "skill root path components must be directories",
          { file: "." },
        );
        return undefined;
      }
      appendOwnDataSlot(components, freezeSnapshot({ path: currentPath, metadata }));
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
    const resolvedCanonicalPath: unknown = await io.realpathPath(absolutePath);
    if (typeof resolvedCanonicalPath !== "string") {
      throw new TypeError("canonical path must be a string");
    }
    canonicalPath = resolvedCanonicalPath;
    const canonical = snapshotFileMetadata(await io.lstatPath(canonicalPath));
    const frozenComponents = freezeSnapshot(components);
    const current = freezeSnapshot({
      path: absolutePath,
      canonicalPath,
      components: frozenComponents,
      metadata,
    });
    if (!sameFileIdentity(metadata, canonical) || !(await rootInspectionIsCurrent(current, io))) {
      diagnostics.add(
        "skill.root.changed",
        "error",
        "skillpress",
        "skill directory changed while it was being inspected",
        { file: "." },
      );
      return undefined;
    }
    return registerRootInspection(current);
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
}
