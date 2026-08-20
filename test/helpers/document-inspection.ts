import { lstat, realpath } from "node:fs/promises";
import { join, parse, relative, resolve, sep } from "node:path";

import type { DocumentInspection } from "../../src/validate/skill-document-read.js";

export async function inspectSkillFixture(
  directory: string,
  path: string,
): Promise<DocumentInspection> {
  const absolute = resolve(directory);
  const filesystemRoot = parse(absolute).root;
  const names = relative(filesystemRoot, absolute).split(sep).filter(Boolean);
  let current = filesystemRoot;
  const components = [];
  for (const name of ["", ...names]) {
    if (name !== "") current = join(current, name);
    components.push({ path: current, metadata: await lstat(current, { bigint: true }) });
  }
  return {
    root: {
      path: absolute,
      canonicalPath: await realpath(absolute),
      components,
      metadata: (components[components.length - 1] as (typeof components)[number]).metadata,
    },
    path,
    metadata: await lstat(path, { bigint: true }),
  };
}
