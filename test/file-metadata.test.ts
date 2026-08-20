import { type BigIntStats, Stats } from "node:fs";
import { lstat } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import {
  sameFileIdentity,
  sameFileSnapshot,
  snapshotFileMetadata,
} from "../src/validate/file-metadata.js";

const KIND_MODES = {
  directory: 0o040755n,
  file: 0o100644n,
  other: 0o010644n,
  "symbolic-link": 0o120777n,
} as const;

type MetadataField = "ctimeNs" | "dev" | "ino" | "kind" | "mode" | "mtimeNs" | "size";

function metadata(
  kind: keyof typeof KIND_MODES,
  overrides: Partial<Record<MetadataField, unknown>> = {},
): BigIntStats {
  return {
    dev: 1n,
    ino: 2n,
    mode: KIND_MODES[kind],
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
        mode: KIND_MODES[kind],
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

  it.each([
    [0o000644n, "other"],
    [0o010644n, "other"],
    [0o020644n, "other"],
    [0o060644n, "other"],
    [0o140644n, "other"],
    [0o040755n, "directory"],
    [0o100644n, "file"],
    [0o120777n, "symbolic-link"],
  ] as const)("derives mode %# as %s without Stats type predicates", (mode, kind) => {
    let predicateReads = 0;
    const source = metadata("file", { mode });
    for (const name of ["isDirectory", "isFile", "isSymbolicLink"] as const) {
      Object.defineProperty(source, name, {
        configurable: true,
        get() {
          predicateReads += 1;
          throw new Error("type predicate must not be read");
        },
      });
    }
    expect(snapshotFileMetadata(source).kind).toBe(kind);
    expect(predicateReads).toBe(0);
  });

  it("preserves bigint values beyond the safe integer range exactly", () => {
    const high = 9_007_199_254_740_993n;
    const mode = (1n << 80n) | 0o100600n;
    expect(
      snapshotFileMetadata(
        metadata("file", {
          dev: high,
          ino: high + 1n,
          mode,
          size: high + 2n,
          mtimeNs: high + 3n,
          ctimeNs: high + 4n,
        }),
      ),
    ).toEqual({
      dev: high,
      ino: high + 1n,
      mode,
      size: high + 2n,
      mtimeNs: high + 3n,
      ctimeNs: high + 4n,
      kind: "file",
    });
  });

  it("accepts a consistent snapshot kind and rejects present mismatches", () => {
    const source = snapshotFileMetadata(metadata("directory"));
    expect(snapshotFileMetadata(source)).toEqual(source);
    expect(() => snapshotFileMetadata({ ...metadata("directory"), kind: "file" })).toThrowError(
      new TypeError("filesystem metadata must contain valid bigint fields"),
    );
    expect(() => snapshotFileMetadata({ ...metadata("directory"), kind: undefined })).toThrowError(
      new TypeError("filesystem metadata must contain valid bigint fields"),
    );
  });

  it("normalizes every malformed field and property trap to one safe TypeError", () => {
    const fields = ["dev", "ino", "mode", "size", "mtimeNs", "ctimeNs"] as const;
    let scalarGetterCalls = 0;
    const assertNormalized = (run: () => unknown) => {
      let observed: unknown;
      try {
        run();
      } catch (error) {
        observed = error;
      }
      expect(observed).toBeInstanceOf(TypeError);
      expect(observed).toMatchObject({
        message: "filesystem metadata must contain valid bigint fields",
      });
      expect(Object.hasOwn(observed as object, "cause")).toBe(false);
      expect(String(observed)).not.toContain("secret-path");
    };

    for (const field of fields) {
      assertNormalized(() => snapshotFileMetadata(metadata("file", { [field]: 1 })));
      const missing = metadata("file") as unknown as Record<PropertyKey, unknown>;
      Reflect.deleteProperty(missing, field);
      assertNormalized(() => snapshotFileMetadata(missing));
      const inherited = metadata("file") as unknown as Record<PropertyKey, unknown>;
      const inheritedValue = inherited[field];
      Reflect.deleteProperty(inherited, field);
      Object.setPrototypeOf(inherited, { [field]: inheritedValue });
      assertNormalized(() => snapshotFileMetadata(inherited));
      const trapped = metadata("file");
      Object.defineProperty(trapped, field, {
        get() {
          scalarGetterCalls += 1;
          throw new Error(`secret-path:${field}`);
        },
      });
      assertNormalized(() => snapshotFileMetadata(trapped));
    }
    expect(scalarGetterCalls).toBe(0);

    const prototypeDevDescriptor = Object.getOwnPropertyDescriptor(Object.prototype, "dev");
    const prototypePolluted = metadata("file") as unknown as Record<PropertyKey, unknown>;
    const inheritedDev = prototypePolluted.dev;
    Reflect.deleteProperty(prototypePolluted, "dev");
    try {
      Reflect.defineProperty(Object.prototype, "dev", {
        configurable: true,
        value: inheritedDev,
        writable: true,
      });
      assertNormalized(() => snapshotFileMetadata(prototypePolluted));
    } finally {
      if (prototypeDevDescriptor === undefined) Reflect.deleteProperty(Object.prototype, "dev");
      else Reflect.defineProperty(Object.prototype, "dev", prototypeDevDescriptor);
    }

    let kindGetterCalls = 0;
    const kindGetter = metadata("file");
    Object.defineProperty(kindGetter, "kind", {
      get() {
        kindGetterCalls += 1;
        throw new Error("secret-path:kind");
      },
    });
    assertNormalized(() => snapshotFileMetadata(kindGetter));
    expect(kindGetterCalls).toBe(0);
    assertNormalized(() =>
      snapshotFileMetadata(
        new Proxy(metadata("file"), {
          getOwnPropertyDescriptor() {
            throw new Error("secret-path:descriptor");
          },
        }),
      ),
    );
    for (const value of [null, undefined, false, 1, "metadata", () => undefined]) {
      assertNormalized(() => snapshotFileMetadata(value));
    }
  });

  it("uses captured mode and object intrinsics after post-import pollution", () => {
    const statsPrototype = Stats.prototype as unknown as Record<PropertyKey, unknown>;
    const inheritedKindDescriptor = Object.getOwnPropertyDescriptor(Object.prototype, "kind");
    const targets = [
      [Object, "freeze", Object.getOwnPropertyDescriptor(Object, "freeze")],
      [
        Object,
        "getOwnPropertyDescriptor",
        Object.getOwnPropertyDescriptor(Object, "getOwnPropertyDescriptor"),
      ],
      [globalThis, "BigInt", Object.getOwnPropertyDescriptor(globalThis, "BigInt")],
      [
        statsPrototype,
        "isDirectory",
        Object.getOwnPropertyDescriptor(statsPrototype, "isDirectory"),
      ],
      [statsPrototype, "isFile", Object.getOwnPropertyDescriptor(statsPrototype, "isFile")],
      [
        statsPrototype,
        "isSymbolicLink",
        Object.getOwnPropertyDescriptor(statsPrototype, "isSymbolicLink"),
      ],
    ] as const;
    const poison = (): never => {
      throw new Error("polluted builtin used");
    };
    let snapshot: ReturnType<typeof snapshotFileMetadata> | undefined;
    try {
      Reflect.defineProperty(Object.prototype, "kind", {
        configurable: true,
        value: "file",
        writable: true,
      });
      for (const [target, key] of targets) {
        Reflect.defineProperty(target, key, {
          configurable: true,
          value: poison,
          writable: true,
        });
      }
      snapshot = snapshotFileMetadata(metadata("symbolic-link"));
    } finally {
      for (const [target, key, descriptor] of targets) {
        if (descriptor === undefined) Reflect.deleteProperty(target, key);
        else Reflect.defineProperty(target, key, descriptor);
      }
      if (inheritedKindDescriptor === undefined) Reflect.deleteProperty(Object.prototype, "kind");
      else Reflect.defineProperty(Object.prototype, "kind", inheritedKindDescriptor);
    }
    expect(snapshot?.kind).toBe("symbolic-link");
    expect(Object.isFrozen(snapshot)).toBe(true);
  });
});
