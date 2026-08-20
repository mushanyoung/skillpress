import { Buffer } from "node:buffer";
import { type BigIntStats, Stats } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { TextDecoder, TextEncoder } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

import {
  type InspectedDirectory,
  type InspectedDirectoryHandle,
  type InspectedDirectoryReadIo,
  MAX_INSPECTED_DIRECTORY_ENTRIES,
  type RawDirectoryOpenOptions,
  readInspectedDirectoryNames,
} from "../src/validate/directory-read.js";
import { snapshotFileMetadata } from "../src/validate/file-metadata.js";
import { createSkillFixtures } from "./helpers/skill-fixtures.js";

const fixtures = createSkillFixtures();
afterEach(() => fixtures.cleanup());

interface HandleOptions {
  readonly closeFails?: boolean;
  readonly onClose?: () => void;
  readonly onRead?: (call: number) => void;
  readonly readFailsAt?: number;
}

function handleFor(
  entries: readonly unknown[],
  options: HandleOptions = {},
): InspectedDirectoryHandle {
  let position = 0;
  return {
    async read() {
      const call = position + 1;
      options.onRead?.(call);
      if (options.readFailsAt === call) throw new Error("read failed");
      const value = position < entries.length ? entries[position] : null;
      position += 1;
      return value as { readonly name: unknown } | null;
    },
    async close() {
      options.onClose?.();
      if (options.closeFails === true) throw new Error("close failed");
    },
  };
}

function rawEntry(value: Uint8Array | string): { readonly name: unknown } {
  return { name: typeof value === "string" ? Buffer.from(value, "utf8") : Buffer.from(value) };
}

function ioFor(
  stats: BigIntStats,
  entries: readonly unknown[],
  options: HandleOptions = {},
): InspectedDirectoryReadIo {
  return {
    lstatPath: async () => stats,
    openDirectory: async () => handleFor(entries, options),
  };
}

async function inspectedFixture(
  name: string,
): Promise<{ readonly inspected: InspectedDirectory; readonly stats: BigIntStats }> {
  const parent = await fixtures.parent();
  const path = join(parent, name);
  await mkdir(path);
  const stats = await import("node:fs/promises").then(({ lstat }) => lstat(path, { bigint: true }));
  return {
    inspected: Object.freeze({
      path,
      metadata: snapshotFileMetadata(stats),
    }),
    stats,
  };
}

function changedStats(stats: BigIntStats): BigIntStats {
  return {
    ...stats,
    mtimeNs: stats.mtimeNs + 1n,
    isDirectory: () => true,
    isFile: () => false,
    isSymbolicLink: () => false,
  } as BigIntStats;
}

function expectDeepFrozen(value: unknown, seen = new WeakSet<object>()): void {
  if ((typeof value !== "object" && typeof value !== "function") || value === null) return;
  if (seen.has(value)) return;
  seen.add(value);
  expect(Object.isFrozen(value)).toBe(true);
  for (const property of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, property);
    if (descriptor !== undefined && "value" in descriptor) {
      expectDeepFrozen(descriptor.value, seen);
    }
  }
}

describe("bounded raw directory reads", () => {
  it("uses raw one-entry non-recursive reads and returns a deep-frozen canonical index", async () => {
    const { inspected, stats } = await inspectedFixture("adapter-options");
    let observedPath = "";
    let observedOptions: RawDirectoryOpenOptions | undefined;
    let contextChecks = 0;
    const result = await readInspectedDirectoryNames(
      inspected,
      async () => {
        contextChecks += 1;
        return true;
      },
      {
        lstatPath: async (path) => {
          expect(path).toBe(inspected.path);
          return stats;
        },
        openDirectory: async (path, options) => {
          observedPath = path;
          observedOptions = options;
          return handleFor([rawEntry("z.md"), rawEntry("a.md")]);
        },
      },
    );

    expect(observedPath).toBe(inspected.path);
    expect(observedOptions).toEqual({ encoding: "buffer", bufferSize: 1, recursive: false });
    expect(Object.isFrozen(observedOptions)).toBe(true);
    expect(contextChecks).toBe(2);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.directory).not.toBe(inspected);
      expect(result.directory).toEqual(inspected);
      expect(result.names.entries.map((entry) => entry.exact)).toEqual(["a.md", "z.md"]);
    }
    expectDeepFrozen(result);
  });

  it("reads real filesystem entries as byte buffers with the default adapter", async () => {
    const { inspected } = await inspectedFixture("real-directory");
    await writeFile(join(inspected.path, "z.md"), "z");
    await writeFile(join(inspected.path, "a.txt"), "a");
    const currentStats = await import("node:fs/promises").then(({ lstat }) =>
      lstat(inspected.path, { bigint: true }),
    );
    const current = Object.freeze({
      path: inspected.path,
      metadata: snapshotFileMetadata(currentStats),
    });

    const result = await readInspectedDirectoryNames(current, async () => true);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.names.entries.map((entry) => entry.exact)).toEqual(["a.txt", "z.md"]);
    }
  });

  it("snapshots the inspection and injected IO functions before the first await", async () => {
    const safe = await inspectedFixture("snapshot-safe");
    const other = await inspectedFixture("snapshot-other");
    const mutable = {
      path: safe.inspected.path,
      metadata: safe.inspected.metadata,
    };
    const io = ioFor(safe.stats, [rawEntry("safe.md")]);
    const result = await readInspectedDirectoryNames(
      mutable,
      async () => {
        mutable.path = other.inspected.path;
        mutable.metadata = other.inspected.metadata;
        Object.assign(io, ioFor(other.stats, [rawEntry("other.md")]));
        return true;
      },
      io,
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.directory.path).toBe(safe.inspected.path);
      expect(result.names.entries.map((entry) => entry.exact)).toEqual(["safe.md"]);
    }
  });

  it("survives post-import pollution of captured byte and object intrinsics", async () => {
    const { inspected, stats } = await inspectedFixture("captured-intrinsics");
    const descriptors = [
      [Buffer, "from", Object.getOwnPropertyDescriptor(Buffer, "from")],
      [Buffer, "isBuffer", Object.getOwnPropertyDescriptor(Buffer, "isBuffer")],
      [
        TextDecoder.prototype,
        "decode",
        Object.getOwnPropertyDescriptor(TextDecoder.prototype, "decode"),
      ],
      [
        TextEncoder.prototype,
        "encode",
        Object.getOwnPropertyDescriptor(TextEncoder.prototype, "encode"),
      ],
      [Object, "defineProperty", Object.getOwnPropertyDescriptor(Object, "defineProperty")],
      [Object, "freeze", Object.getOwnPropertyDescriptor(Object, "freeze")],
      [Reflect, "apply", Object.getOwnPropertyDescriptor(Reflect, "apply")],
      [
        Stats.prototype,
        "isDirectory",
        Object.getOwnPropertyDescriptor(Stats.prototype, "isDirectory"),
      ],
      [Stats.prototype, "isFile", Object.getOwnPropertyDescriptor(Stats.prototype, "isFile")],
      [
        Stats.prototype,
        "isSymbolicLink",
        Object.getOwnPropertyDescriptor(Stats.prototype, "isSymbolicLink"),
      ],
    ] as const;
    const poison = (): never => {
      throw new Error("polluted intrinsic used");
    };
    try {
      for (const [target, key] of descriptors) {
        Reflect.defineProperty(target, key, { configurable: true, value: poison, writable: true });
      }
      const result = await readInspectedDirectoryNames(
        inspected,
        async () => true,
        ioFor(stats, [{ name: Buffer.alloc(0) }]),
      );
      expect(result).toEqual({
        ok: false,
        reason: "name-index",
        failure: {
          ok: false,
          reason: "profile_failures",
          failures: [{ reason: "empty", count: 1 }],
        },
      });
    } finally {
      for (const [target, key, descriptor] of descriptors) {
        if (descriptor === undefined) {
          Reflect.deleteProperty(target, key);
        } else {
          Reflect.defineProperty(target, key, descriptor);
        }
      }
    }
  });

  it("accepts exactly 1024 entries and proves EOF with a 1025th read", async () => {
    const { inspected, stats } = await inspectedFixture("exact-entry-limit");
    const entries = Array.from({ length: MAX_INSPECTED_DIRECTORY_ENTRIES }, (_, index) =>
      rawEntry(`entry-${String(index).padStart(4, "0")}`),
    );
    let reads = 0;
    const result = await readInspectedDirectoryNames(
      inspected,
      async () => true,
      ioFor(stats, entries, { onRead: () => (reads += 1) }),
    );

    expect(result.ok).toBe(true);
    expect(reads).toBe(MAX_INSPECTED_DIRECTORY_ENTRIES + 1);
    if (result.ok) expect(result.names.entries).toHaveLength(MAX_INSPECTED_DIRECTORY_ENTRIES);
  });

  it("counts the 1025th entry before its name getter and closes immediately", async () => {
    const { inspected, stats } = await inspectedFixture("overflow-priority");
    let forbiddenNameReads = 0;
    let totalReads = 0;
    let closed = false;
    const entries: unknown[] = [{ name: "not-a-buffer" }];
    for (let index = 1; index < MAX_INSPECTED_DIRECTORY_ENTRIES; index += 1) {
      entries.push(rawEntry(`entry-${index}`));
    }
    entries.push(
      Object.defineProperty({}, "name", {
        get() {
          forbiddenNameReads += 1;
          throw new Error("must not inspect overflow names");
        },
      }),
      Object.defineProperty({}, "name", {
        get() {
          forbiddenNameReads += 1;
          throw new Error("must keep skipping overflow names");
        },
      }),
    );
    const result = await readInspectedDirectoryNames(inspected, async () => true, {
      lstatPath: async () => stats,
      openDirectory: async () =>
        handleFor(entries, {
          onRead: () => {
            totalReads += 1;
          },
          onClose: () => {
            closed = true;
          },
        }),
    });

    expect(result).toEqual({ ok: false, reason: "too-many-entries" });
    expect(forbiddenNameReads).toBe(0);
    expect(totalReads).toBe(MAX_INSPECTED_DIRECTORY_ENTRIES + 1);
    expect(closed).toBe(true);
  });

  it.each([
    ["undefined", undefined],
    ["false", false],
    ["string", "entry"],
    ["missing name", {}],
    ["string name", { name: "entry" }],
  ])("accepts only null as EOF and a Buffer-valued name: %s", async (_label, entry) => {
    const { inspected, stats } = await inspectedFixture(`invalid-read-${String(_label)}`);
    const result = await readInspectedDirectoryNames(
      inspected,
      async () => true,
      ioFor(stats, [entry]),
    );
    expect(result).toEqual({ ok: false, reason: "invalid-read" });
    expect(Object.isFrozen(result)).toBe(true);
  });

  it("never invokes own or inherited name accessors and rejects descriptor traps", async () => {
    const { inspected, stats } = await inspectedFixture("name-descriptors");
    let getterCalls = 0;
    let trapCalls = 0;
    const inherited = Object.create(
      Object.defineProperty({}, "name", {
        get() {
          getterCalls += 1;
          return Buffer.from("inherited");
        },
      }),
    );
    const ownAccessor = Object.defineProperty({}, "name", {
      get() {
        getterCalls += 1;
        return Buffer.from("accessor");
      },
    });
    const trapped = new Proxy(
      { name: Buffer.from("trapped") },
      {
        getOwnPropertyDescriptor() {
          trapCalls += 1;
          throw new Error("descriptor trap");
        },
      },
    );

    for (const entry of [inherited, ownAccessor, trapped]) {
      expect(
        await readInspectedDirectoryNames(inspected, async () => true, ioFor(stats, [entry])),
      ).toEqual({ ok: false, reason: "invalid-read" });
    }
    expect(getterCalls).toBe(0);
    expect(trapCalls).toBe(1);
  });

  it("accepts an exact 255-byte multibyte name and rejects one additional byte", async () => {
    const boundary = await inspectedFixture("name-byte-boundary");
    const exactBoundary = "界".repeat(85);
    const accepted = await readInspectedDirectoryNames(
      boundary.inspected,
      async () => true,
      ioFor(boundary.stats, [rawEntry(exactBoundary)]),
    );
    expect(accepted.ok).toBe(true);
    if (accepted.ok) expect(accepted.names.entries[0]?.exact).toBe(exactBoundary);

    let checks = 0;
    let closed = false;
    const rejected = await readInspectedDirectoryNames(
      boundary.inspected,
      async () => {
        checks += 1;
        return true;
      },
      ioFor(boundary.stats, [rawEntry(`${exactBoundary}a`)], {
        onClose: () => {
          closed = true;
        },
      }),
    );
    expect(rejected).toEqual({ ok: false, reason: "name-too-large" });
    expect(checks).toBe(2);
    expect(closed).toBe(true);
  });

  it("copies each observed name before the next read can mutate its source buffer", async () => {
    const { inspected, stats } = await inspectedFixture("immediate-copy");
    const source = Buffer.from("safe.md");
    let reads = 0;
    const result = await readInspectedDirectoryNames(inspected, async () => true, {
      lstatPath: async () => stats,
      openDirectory: async () => ({
        async read() {
          reads += 1;
          if (reads === 1) return { name: source };
          source.fill(0x78);
          return null;
        },
        async close() {},
      }),
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.names.entries.map((entry) => entry.exact)).toEqual(["safe.md"]);
  });

  it("integrates NFC and fixed-fold collisions independently of enumeration order", async () => {
    const { inspected, stats } = await inspectedFixture("collision-index");
    const result = await readInspectedDirectoryNames(
      inspected,
      async () => true,
      ioFor(stats, [rawEntry("å"), rawEntry("A\u030a"), rawEntry("Å")]),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.names.entries.map((entry) => entry.exact)).toEqual(["A\u030a", "Å", "å"]);
    expect(result.names.findings).toEqual([
      { kind: "non_nfc", exact: "A\u030a", nfc: "Å" },
      { kind: "nfc_collision", nfc: "Å", exacts: ["A\u030a", "Å"] },
      {
        kind: "fixed_fold_collision",
        key: "a\u030a",
        nfcs: ["Å", "å"],
        exacts: ["A\u030a", "Å", "å"],
      },
    ]);
  });

  it.each([[0xc0, 0xaf], [0x80], [0xe2, 0x82], [0xed, 0xa0, 0x80], [0xf4, 0x90, 0x80, 0x80]])(
    "rejects non-canonical or malformed UTF-8 bytes %#",
    async (...bytes) => {
      const { inspected, stats } = await inspectedFixture(`invalid-utf8-${bytes.join("-")}`);
      const result = await readInspectedDirectoryNames(
        inspected,
        async () => true,
        ioFor(stats, [rawEntry(Uint8Array.from(bytes))]),
      );
      expect(result).toEqual({ ok: false, reason: "invalid-name-encoding" });
    },
  );

  it("preserves a UTF-8 BOM for the name profiler instead of stripping it", async () => {
    const { inspected, stats } = await inspectedFixture("bom-preserved");
    const result = await readInspectedDirectoryNames(
      inspected,
      async () => true,
      ioFor(stats, [rawEntry(Uint8Array.from([0xef, 0xbb, 0xbf]))]),
    );
    expect(result).toEqual({
      ok: false,
      reason: "name-index",
      failure: {
        ok: false,
        reason: "profile_failures",
        failures: [{ reason: "unsafe_unicode", count: 1 }],
      },
    });
    expectDeepFrozen(result);
  });

  it("returns the complete deterministic name-index failure without leaking raw entries", async () => {
    const { inspected, stats } = await inspectedFixture("profile-failure");
    const raw = rawEntry("CON");
    const result = await readInspectedDirectoryNames(
      inspected,
      async () => true,
      ioFor(stats, [raw]),
    );
    expect(result).toEqual({
      ok: false,
      reason: "name-index",
      failure: {
        ok: false,
        reason: "profile_failures",
        failures: [{ reason: "nonportable", count: 1 }],
      },
    });
    expect(JSON.stringify(result)).not.toContain(inspected.path);
    expect(JSON.stringify(result)).not.toContain("Buffer");
    expectDeepFrozen(result);
  });

  it("reports strict context and directory changes in transaction order", async () => {
    const before = await inspectedFixture("changes-before");
    expect(
      await readInspectedDirectoryNames(
        before.inspected,
        async () => "true" as unknown as boolean,
        ioFor(before.stats, []),
      ),
    ).toEqual({
      ok: false,
      reason: "changed",
      subject: "context",
      phase: "before-open",
    });
    expect(
      await readInspectedDirectoryNames(
        before.inspected,
        async () => true,
        ioFor(changedStats(before.stats), []),
      ),
    ).toEqual({
      ok: false,
      reason: "changed",
      subject: "directory",
      phase: "before-open",
    });

    const after = await inspectedFixture("changes-after");
    let statCalls = 0;
    let contextCalls = 0;
    const result = await readInspectedDirectoryNames(
      after.inspected,
      async () => {
        contextCalls += 1;
        return contextCalls === 1;
      },
      {
        lstatPath: async () => {
          statCalls += 1;
          return statCalls === 1 ? after.stats : changedStats(after.stats);
        },
        openDirectory: async () => handleFor([]),
      },
    );
    expect(result).toEqual({
      ok: false,
      reason: "changed",
      subject: "directory",
      phase: "reading",
    });
    expect(contextCalls).toBe(2);
  });

  it("reports a context-only change after the closed inventory transaction", async () => {
    const { inspected, stats } = await inspectedFixture("context-change-after");
    let checks = 0;
    const result = await readInspectedDirectoryNames(
      inspected,
      async () => {
        checks += 1;
        return checks === 1;
      },
      ioFor(stats, [rawEntry("a")]),
    );
    expect(result).toEqual({
      ok: false,
      reason: "changed",
      subject: "context",
      phase: "reading",
    });
  });

  it("rejects malformed post-read metadata after closing the handle", async () => {
    const { inspected, stats } = await inspectedFixture("post-metadata");
    let statCalls = 0;
    let closes = 0;
    const result = await readInspectedDirectoryNames(inspected, async () => true, {
      lstatPath: async () => {
        statCalls += 1;
        return (statCalls === 1 ? stats : { ...stats, size: 1 }) as BigIntStats;
      },
      openDirectory: async () =>
        handleFor([], {
          onClose: () => {
            closes += 1;
          },
        }),
    });
    expect(result).toEqual({ ok: false, reason: "invalid-metadata" });
    expect(closes).toBe(1);
  });

  it.each(["read", "close", "post-lstat", "context"])(
    "collapses native %s failures to a frozen IO result and closes when possible",
    async (failurePoint) => {
      const { inspected, stats } = await inspectedFixture(`io-${failurePoint}`);
      let closed = 0;
      let statCalls = 0;
      let contextCalls = 0;
      const result = await readInspectedDirectoryNames(
        inspected,
        async () => {
          contextCalls += 1;
          if (failurePoint === "context" && contextCalls === 2) throw new Error(inspected.path);
          return true;
        },
        {
          lstatPath: async () => {
            statCalls += 1;
            if (failurePoint === "post-lstat" && statCalls === 2) throw new Error(inspected.path);
            return stats;
          },
          openDirectory: async () =>
            handleFor([rawEntry("a")], {
              closeFails: failurePoint === "close",
              readFailsAt: failurePoint === "read" ? 1 : undefined,
              onClose: () => {
                closed += 1;
              },
            }),
        },
      );
      expect(result).toEqual({ ok: false, reason: "io" });
      expect(JSON.stringify(result)).not.toContain(inspected.path);
      expect(Object.isFrozen(result)).toBe(true);
      expect(closed).toBe(1);
    },
  );

  it("makes close IO failures dominate prior semantic and overflow findings", async () => {
    const { inspected, stats } = await inspectedFixture("close-priority");
    const overflowEntries = Array.from(
      { length: MAX_INSPECTED_DIRECTORY_ENTRIES + 1 },
      (_, index) => rawEntry(`entry-${index}`),
    );
    for (const entries of [[{ name: "invalid" }], overflowEntries]) {
      const result = await readInspectedDirectoryNames(
        inspected,
        async () => true,
        ioFor(stats, entries, { closeFails: true }),
      );
      expect(result).toEqual({ ok: false, reason: "io" });
    }
  });

  it("closes exactly once when the opened handle has no readable data method", async () => {
    const { inspected, stats } = await inspectedFixture("malformed-handle");
    let closes = 0;
    const result = await readInspectedDirectoryNames(inspected, async () => true, {
      lstatPath: async () => stats,
      openDirectory: async () =>
        ({
          close: async () => {
            closes += 1;
          },
        }) as InspectedDirectoryHandle,
    });
    expect(result).toEqual({ ok: false, reason: "io" });
    expect(closes).toBe(1);
  });

  it("closes exactly once when reading the opened handle property throws", async () => {
    const { inspected, stats } = await inspectedFixture("throwing-read-property");
    let closes = 0;
    const opened = Object.defineProperties(
      {},
      {
        close: {
          value: async () => {
            closes += 1;
          },
        },
        read: {
          get() {
            throw new Error("read property failed");
          },
        },
      },
    );
    const result = await readInspectedDirectoryNames(inspected, async () => true, {
      lstatPath: async () => stats,
      openDirectory: async () => opened as InspectedDirectoryHandle,
    });
    expect(result).toEqual({ ok: false, reason: "io" });
    expect(closes).toBe(1);
  });

  it.each([
    null,
    {},
    Object.defineProperty({}, "close", {
      get: () => {
        throw new Error("close");
      },
    }),
  ])("rejects an unclosable opened handle without leaking its error: %#", async (opened) => {
    const { inspected, stats } = await inspectedFixture("unclosable-handle");
    const result = await readInspectedDirectoryNames(inspected, async () => true, {
      lstatPath: async () => stats,
      openDirectory: async () => opened as InspectedDirectoryHandle,
    });
    expect(result).toEqual({ ok: false, reason: "io" });
  });

  it("rejects invalid verifier and IO adapter capabilities before their use", async () => {
    const { inspected, stats } = await inspectedFixture("invalid-adapters");
    expect(
      await readInspectedDirectoryNames(
        inspected,
        null as unknown as () => Promise<boolean>,
        ioFor(stats, []),
      ),
    ).toEqual({ ok: false, reason: "invalid-inspection" });
    expect(
      await readInspectedDirectoryNames(inspected, async () => true, {
        lstatPath: null as unknown as InspectedDirectoryReadIo["lstatPath"],
        openDirectory: async () => handleFor([]),
      }),
    ).toEqual({ ok: false, reason: "io" });
    expect(
      await readInspectedDirectoryNames(inspected, async () => true, {
        get lstatPath(): InspectedDirectoryReadIo["lstatPath"] {
          throw new Error("adapter getter");
        },
        openDirectory: async () => handleFor([]),
      }),
    ).toEqual({ ok: false, reason: "io" });
  });

  it("validates every bigint field returned by lstat without retaining the object", async () => {
    const { inspected, stats } = await inspectedFixture("invalid-returned-metadata");
    for (const field of ["dev", "ino", "mode", "size", "mtimeNs", "ctimeNs"] as const) {
      const result = await readInspectedDirectoryNames(
        inspected,
        async () => true,
        ioFor({ ...stats, [field]: 1 } as unknown as BigIntStats, []),
      );
      expect(result).toEqual({ ok: false, reason: "invalid-metadata" });
    }
    expect(
      await readInspectedDirectoryNames(
        inspected,
        async () => true,
        ioFor(null as unknown as BigIntStats, []),
      ),
    ).toEqual({ ok: false, reason: "invalid-metadata" });
  });

  it("surfaces impossible duplicate raw entries only as a frozen index failure", async () => {
    const { inspected, stats } = await inspectedFixture("duplicate-raw-entry");
    const result = await readInspectedDirectoryNames(
      inspected,
      async () => true,
      ioFor(stats, [rawEntry("same"), rawEntry("same")]),
    );
    expect(result).toEqual({
      ok: false,
      reason: "name-index",
      failure: { ok: false, reason: "exact_duplicate" },
    });
    expectDeepFrozen(result);
  });

  it("rejects malformed inspections before any callback or filesystem IO", async () => {
    const { inspected, stats } = await inspectedFixture("invalid-inspection");
    const malformed = [
      null,
      {},
      { path: 1, metadata: inspected.metadata },
      { path: inspected.path, metadata: null },
      Object.defineProperty({}, "path", {
        get() {
          throw new Error("inspection getter");
        },
      }),
    ];
    const malformedMetadata = [
      { ...inspected.metadata, dev: 1 },
      { ...inspected.metadata, ino: 1 },
      { ...inspected.metadata, mode: 1 },
      { ...inspected.metadata, size: 1 },
      { ...inspected.metadata, mtimeNs: 1 },
      { ...inspected.metadata, ctimeNs: 1 },
      { ...inspected.metadata, kind: "file" },
      {
        ...inspected.metadata,
        mode: (inspected.metadata.mode & ~BigInt(0o170000)) | BigInt(0o100000),
      },
    ];
    let calls = 0;
    const io: InspectedDirectoryReadIo = {
      lstatPath: async () => {
        calls += 1;
        return stats;
      },
      openDirectory: async () => {
        calls += 1;
        return handleFor([]);
      },
    };
    for (const value of malformed) {
      expect(
        await readInspectedDirectoryNames(
          value as unknown as InspectedDirectory,
          async () => {
            calls += 1;
            return true;
          },
          io,
        ),
      ).toEqual({ ok: false, reason: "invalid-inspection" });
    }
    for (const metadata of malformedMetadata) {
      expect(
        await readInspectedDirectoryNames(
          { path: inspected.path, metadata } as unknown as InspectedDirectory,
          async () => {
            calls += 1;
            return true;
          },
          io,
        ),
      ).toEqual({ ok: false, reason: "invalid-metadata" });
    }
    expect(calls).toBe(0);
  });
});
