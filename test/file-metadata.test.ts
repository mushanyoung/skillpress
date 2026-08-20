import type { BigIntStats } from "node:fs";
import { lstat } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import {
  sameFileIdentity,
  sameFileSnapshot,
  snapshotFileMetadata,
} from "../src/validate/file-metadata.js";

function metadata(
  kind: "directory" | "file" | "other" | "symbolic-link",
  overrides: Partial<Record<"ctimeNs" | "dev" | "ino" | "mode" | "mtimeNs" | "size", unknown>> = {},
): BigIntStats {
  return {
    dev: 1n,
    ino: 2n,
    mode: 0o100644n,
    size: 3n,
    mtimeNs: 4n,
    ctimeNs: 5n,
    isDirectory: () => kind === "directory",
    isFile: () => kind === "file",
    isSymbolicLink: () => kind === "symbolic-link",
    ...overrides,
  } as unknown as BigIntStats;
}

describe("immutable filesystem metadata snapshots", () => {
  it.each(["directory", "file", "other", "symbolic-link"] as const)(
    "copies %s metadata into a frozen scalar record",
    (kind) => {
      const source = metadata(kind);
      const snapshot = snapshotFileMetadata(source);
      expect(snapshot).toEqual({
        dev: 1n,
        ino: 2n,
        mode: 0o100644n,
        size: 3n,
        mtimeNs: 4n,
        ctimeNs: 5n,
        kind,
      });
      expect(Object.isFrozen(snapshot)).toBe(true);
      expect(Object.isFrozen(source)).toBe(false);
    },
  );

  it("does not freeze or break the lazy Date accessors on Node BigIntStats", async () => {
    const source = await lstat(new URL(import.meta.url), { bigint: true });
    snapshotFileMetadata(source);
    expect(source.atime).toBeInstanceOf(Date);
    expect(source.mtime).toBeInstanceOf(Date);
    expect(source.ctime).toBeInstanceOf(Date);
    expect(source.birthtime).toBeInstanceOf(Date);
    expect(Object.isFrozen(source)).toBe(false);
  });

  it("compares identity separately from the complete read snapshot", () => {
    const expected = snapshotFileMetadata(metadata("file"));
    const changedTime = snapshotFileMetadata(metadata("file", { mtimeNs: 9n }));
    const changedIdentity = snapshotFileMetadata(metadata("file", { ino: 9n }));
    const changedMode = snapshotFileMetadata(metadata("file", { mode: 0o100600n }));
    const changedKind = snapshotFileMetadata(metadata("directory"));
    expect(sameFileIdentity(expected, changedTime)).toBe(true);
    expect(sameFileSnapshot(expected, changedTime)).toBe(false);
    expect(sameFileIdentity(expected, changedIdentity)).toBe(false);
    expect(sameFileSnapshot(expected, changedIdentity)).toBe(false);
    expect(sameFileSnapshot(expected, changedMode)).toBe(false);
    expect(sameFileSnapshot(expected, changedKind)).toBe(false);
    expect(sameFileSnapshot(expected, expected)).toBe(true);
  });

  it("rejects malformed and contradictory runtime metadata", () => {
    expect(() => snapshotFileMetadata(metadata("file", { dev: 1 }))).toThrow(TypeError);
    const nonBoolean = metadata("other");
    Object.assign(nonBoolean, { isFile: () => "yes" });
    expect(() => snapshotFileMetadata(nonBoolean)).toThrow(TypeError);
    const contradictory = metadata("file");
    Object.assign(contradictory, { isDirectory: () => true });
    expect(() => snapshotFileMetadata(contradictory)).toThrow(TypeError);
  });
});
