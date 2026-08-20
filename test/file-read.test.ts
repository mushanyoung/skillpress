import bufferModule from "node:buffer";
import type { BigIntStats } from "node:fs";
import { constants } from "node:fs";
import fsPromisesModule, { lstat, open, readFile } from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import utilModule, { TextDecoder as NodeTextDecoder } from "node:util";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  type FileOpenCapabilities,
  type InspectedFile,
  type InspectedFileHandle,
  type InspectedFileReadIo,
  readInspectedUtf8File,
} from "../src/validate/file-read.js";
import { snapshotFileMetadata } from "../src/validate/file-metadata.js";
import { MAX_SKILL_DOCUMENT_BYTES } from "../src/validate/types.js";
import { createSkillFixtures } from "./helpers/skill-fixtures.js";

const fixtures = createSkillFixtures();
afterEach(() => fixtures.cleanup());

const NO_FOLLOW_FLAG = (constants as Partial<typeof constants>).O_NOFOLLOW;
const NON_BLOCK_FLAG = (constants as Partial<typeof constants>).O_NONBLOCK;
const HAS_NO_FOLLOW = typeof NO_FOLLOW_FLAG === "number" && NO_FOLLOW_FLAG !== 0;
const HAS_NON_BLOCK = typeof NON_BLOCK_FLAG === "number" && NON_BLOCK_FLAG !== 0;
const THEN_PROPERTY = "then";
const definePropertyIntrinsic = Object.defineProperty;
const deletePropertyIntrinsic = Reflect.deleteProperty;
const getOwnPropertyDescriptorIntrinsic = Object.getOwnPropertyDescriptor;

type PropertyMutation = readonly [object, PropertyKey, PropertyDescriptor];

async function withPropertyMutations<T>(
  mutations: readonly PropertyMutation[],
  operation: () => Promise<T>,
): Promise<T> {
  const previous = mutations.map(([target, key]) => getOwnPropertyDescriptorIntrinsic(target, key));
  let applied = 0;
  try {
    for (; applied < mutations.length; applied += 1) {
      const [target, key, descriptor] = mutations[applied] as PropertyMutation;
      definePropertyIntrinsic(target, key, descriptor);
    }
    return await operation();
  } finally {
    for (let index = applied - 1; index >= 0; index -= 1) {
      const [target, key] = mutations[index] as PropertyMutation;
      const descriptor = previous[index];
      if (descriptor === undefined) deletePropertyIntrinsic(target, key);
      else definePropertyIntrinsic(target, key, descriptor);
    }
  }
}

interface HandleOptions {
  readonly afterStats?: BigIntStats;
  readonly closeFails?: boolean;
  readonly detachAfterRead?: boolean;
  readonly maxReadBytes?: number;
  readonly onClose?: () => void;
  readonly onRead?: (requested: number) => number | undefined;
  readonly onStat?: (call: number) => void;
}

function handleFor(
  openedStats: BigIntStats,
  bytes: Uint8Array,
  options: HandleOptions = {},
): InspectedFileHandle {
  let position = 0;
  let statCalls = 0;
  return {
    async stat() {
      statCalls += 1;
      options.onStat?.(statCalls);
      return statCalls === 1 ? openedStats : (options.afterStats ?? openedStats);
    },
    async read(buffer, offset, length) {
      const overridden = options.onRead?.(length);
      if (overridden !== undefined) return { bytesRead: overridden };
      const available = bytes.length - position;
      let bytesRead = length < available ? length : available;
      if (options.maxReadBytes !== undefined && options.maxReadBytes < bytesRead) {
        bytesRead = options.maxReadBytes;
      }
      for (let index = 0; index < bytesRead; index += 1) {
        buffer[offset + index] = bytes[position + index] as number;
      }
      position += bytesRead;
      if (options.detachAfterRead === true) {
        structuredClone(buffer.buffer, { transfer: [buffer.buffer as ArrayBuffer] });
      }
      return { bytesRead };
    },
    async close() {
      options.onClose?.();
      if (options.closeFails === true) throw new Error("close failed");
    },
  };
}

function ioFor(
  stats: BigIntStats,
  handle: InspectedFileHandle,
  capabilities: FileOpenCapabilities = {
    noFollow: HAS_NO_FOLLOW,
    nonBlock: HAS_NON_BLOCK,
  },
): InspectedFileReadIo {
  return {
    lstatPath: async () => stats,
    openFile: async () => handle,
    capabilities,
  };
}

async function inspectedFixture(
  name: string,
  bytes: string | Uint8Array,
): Promise<{ readonly inspected: InspectedFile; readonly stats: BigIntStats }> {
  const fixture = await fixtures.skill(name, bytes);
  const stats = await lstat(fixture.path, { bigint: true });
  return {
    inspected: Object.freeze({
      path: fixture.path,
      metadata: snapshotFileMetadata(stats),
    }),
    stats,
  };
}

function expectAsyncResultRecord(value: object, enumerable: Record<string, unknown>): void {
  expect(Object.getOwnPropertyDescriptor(value, THEN_PROPERTY)).toEqual({
    configurable: false,
    enumerable: false,
    value: undefined,
    writable: false,
  });
  expect(Object.keys(value)).toEqual(Object.keys(enumerable));
  expect(JSON.parse(JSON.stringify(value))).toEqual(enumerable);
  expect(Object.getPrototypeOf(value)).toBe(Object.prototype);
  expect(Object.isFrozen(value)).toBe(true);
}

function restoreInheritedThen(descriptor: PropertyDescriptor | undefined): void {
  if (descriptor === undefined) Reflect.deleteProperty(Object.prototype, THEN_PROPERTY);
  else Object.defineProperty(Object.prototype, THEN_PROPERTY, descriptor);
}

function installInheritedThen(onGet: () => void, onCall: () => void): void {
  Object.defineProperty(Object.prototype, THEN_PROPERTY, {
    configurable: true,
    get() {
      onGet();
      return (resolve: (value: unknown) => void) => {
        onCall();
        resolve("poisoned");
      };
    },
  });
}

async function restoringInheritedThen<T>(operation: () => Promise<T>): Promise<T> {
  const inherited = Object.getOwnPropertyDescriptor(Object.prototype, THEN_PROPERTY);
  try {
    return await operation();
  } finally {
    restoreInheritedThen(inherited);
  }
}

describe("bounded inspected UTF-8 file reads", () => {
  it("reads the exact byte boundary, reports bytes, and freezes success", async () => {
    const bytes = Buffer.from("café", "utf8");
    const { inspected } = await inspectedFixture("generic-success", bytes);
    let checks = 0;
    const result = await readInspectedUtf8File(inspected, bytes.length, async (current) => {
      expect(current).toBe(inspected);
      checks += 1;
      return true;
    });

    const expected = { ok: true, text: "café", byteLength: bytes.length };
    expectAsyncResultRecord(result, expected);
    expect(checks).toBe(2);
  });

  it("accepts an empty file with a zero-byte budget", async () => {
    const { inspected } = await inspectedFixture("generic-empty", "");
    const result = await readInspectedUtf8File(inspected, 0, async () => true);
    expect(result).toEqual({ ok: true, text: "", byteLength: 0 });
  });

  it("preserves a BOM across an exact 64 KiB plus 17-byte split UTF-8 sequence", async () => {
    const text = `\uFEFF${"a".repeat(64 * 1024 - 4)}€${"b".repeat(15)}`;
    const bytes = Buffer.from(text, "utf8");
    const { inspected } = await inspectedFixture("generic-chunks", bytes);
    const result = await readInspectedUtf8File(inspected, bytes.length, async () => true);
    expect(result).toEqual({ ok: true, text, byteLength: bytes.length });
  });

  it("snapshots the inspected file and IO adapter before the first await", async () => {
    const safe = await inspectedFixture("snapshot-safe", "safe");
    const secret = await inspectedFixture("snapshot-secret", "secret");
    const mutable = {
      path: safe.inspected.path,
      metadata: safe.inspected.metadata,
    };
    const io = ioFor(safe.stats, handleFor(safe.stats, Buffer.from("safe")));
    const result = await readInspectedUtf8File(
      mutable,
      6,
      async () => {
        mutable.path = secret.inspected.path;
        mutable.metadata = secret.inspected.metadata;
        Object.assign(io, ioFor(secret.stats, handleFor(secret.stats, Buffer.from("secret"))));
        return true;
      },
      io,
    );
    expect(result).toEqual({ ok: true, text: "safe", byteLength: 4 });
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, 0.5, 2 ** 32, constants.O_TRUNC])(
    "treats the invalid no-follow flag %s as unavailable",
    async (noFollow) => {
      const { inspected, stats } = await inspectedFixture(`invalid-flag-${String(noFollow)}`, "x");
      let lstats = 0;
      let flags = -1;
      const result = await readInspectedUtf8File(inspected, 1, async () => true, {
        lstatPath: async () => {
          lstats += 1;
          return stats;
        },
        openFile: async (_path, value) => {
          flags = value;
          return handleFor(stats, Buffer.from("x"));
        },
        capabilities: { noFollow, nonBlock: noFollow } as unknown as FileOpenCapabilities,
      });
      expect(result).toEqual({ ok: true, text: "x", byteLength: 1 });
      expect(lstats).toBe(2);
      expect(flags).toBe(constants.O_RDONLY);
    },
  );

  it("never incorporates an injected numeric flag into a real open", async () => {
    const { inspected, stats } = await inspectedFixture("destructive-flag", "SAFE");
    const result = await readInspectedUtf8File(inspected, 4, async () => true, {
      lstatPath: async () => stats,
      openFile: (path, flags) => open(path, flags),
      capabilities: {
        noFollow: constants.O_TRUNC,
        nonBlock: constants.O_TRUNC,
      } as unknown as FileOpenCapabilities,
    });
    expect(result).toEqual({ ok: true, text: "SAFE", byteLength: 4 });
    expect(await readFile(inspected.path, "utf8")).toBe("SAFE");
  });

  it("requires the context verifier to return the boolean true", async () => {
    const { inspected } = await inspectedFixture("strict-context", "x");
    const result = await readInspectedUtf8File(
      inspected,
      1,
      async () => "false" as unknown as boolean,
    );
    expect(result).toEqual({
      ok: false,
      reason: "changed",
      subject: "context",
      phase: "before-open",
    });
  });

  it.each([-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY, MAX_SKILL_DOCUMENT_BYTES + 1])(
    "rejects the invalid byte budget %s before filesystem callbacks",
    async (maxBytes) => {
      const { inspected, stats } = await inspectedFixture(`invalid-limit-${String(maxBytes)}`, "x");
      let calls = 0;
      const result = await readInspectedUtf8File(
        inspected,
        maxBytes,
        async () => {
          calls += 1;
          return true;
        },
        {
          lstatPath: async () => {
            calls += 1;
            return stats;
          },
          openFile: async () => {
            calls += 1;
            return handleFor(stats, Buffer.from("x"));
          },
          capabilities: { noFollow: false, nonBlock: false },
        },
      );
      const expected = { ok: false, reason: "invalid-metadata" };
      expectAsyncResultRecord(result, expected);
      expect(calls).toBe(0);
    },
  );

  it("checks context before inspected size limits", async () => {
    const { inspected } = await inspectedFixture("context-first", "x");
    const oversized = {
      ...inspected,
      metadata: { ...inspected.metadata, size: 2n },
    } as InspectedFile;
    const result = await readInspectedUtf8File(oversized, 1, async () => false);
    expectAsyncResultRecord(result, {
      ok: false,
      reason: "changed",
      subject: "context",
      phase: "before-open",
    });
  });

  it("rejects invalid and oversized inspected metadata before opening", async () => {
    const { inspected, stats } = await inspectedFixture("metadata-limits", "x");
    let opens = 0;
    const io = ioFor(stats, handleFor(stats, Buffer.from("x")));
    const countingIo: InspectedFileReadIo = {
      ...io,
      openFile: async (path, flags) => {
        opens += 1;
        return io.openFile(path, flags);
      },
    };

    for (const size of [-1n, "1"] as const) {
      const malformed = {
        ...inspected,
        metadata: { ...inspected.metadata, size },
      } as unknown as InspectedFile;
      expect(await readInspectedUtf8File(malformed, 1, async () => true, countingIo)).toEqual({
        ok: false,
        reason: "invalid-metadata",
      });
    }
    const oversized = {
      ...inspected,
      metadata: { ...inspected.metadata, size: 2n },
    } as InspectedFile;
    expect(await readInspectedUtf8File(oversized, 1, async () => true, countingIo)).toEqual({
      ok: false,
      reason: "too-large",
    });
    const wrongKind = {
      ...inspected,
      metadata: { ...inspected.metadata, kind: "directory" },
    } as InspectedFile;
    expect(await readInspectedUtf8File(wrongKind, 1, async () => true, countingIo)).toEqual({
      ok: false,
      reason: "invalid-metadata",
    });
    expect(opens).toBe(0);
  });

  it("uses the no-follow fallback before opening and preserves operation order", async () => {
    const bytes = Buffer.from("abc");
    const { inspected, stats } = await inspectedFixture("fallback-order", bytes);
    const operations: string[] = [];
    let statsCalls = 0;
    const handle = handleFor(stats, bytes, {
      onClose: () => operations.push("close"),
      onRead: (requested) => {
        operations.push(`read:${requested}`);
        return undefined;
      },
      onStat: () => {
        statsCalls += 1;
        operations.push(`fstat:${statsCalls}`);
      },
    });
    let lstatCalls = 0;
    let contextCalls = 0;
    let flags = 0;
    const result = await readInspectedUtf8File(
      inspected,
      bytes.length,
      async () => {
        contextCalls += 1;
        operations.push(`context:${contextCalls}`);
        return true;
      },
      {
        async lstatPath() {
          lstatCalls += 1;
          operations.push(`lstat:${lstatCalls}`);
          return stats;
        },
        async openFile(_path, openFlags) {
          operations.push("open");
          flags = openFlags;
          return handle;
        },
        capabilities: { noFollow: false, nonBlock: HAS_NON_BLOCK },
      },
    );

    expect(result).toEqual({ ok: true, text: "abc", byteLength: 3 });
    expect(operations).toEqual([
      "context:1",
      "lstat:1",
      "open",
      "fstat:1",
      "read:4",
      "read:1",
      "fstat:2",
      "close",
      "lstat:2",
      "context:2",
    ]);
    if (typeof NON_BLOCK_FLAG === "number") {
      expect(flags & NON_BLOCK_FLAG).toBe(NON_BLOCK_FLAG);
    }
    expect(flags & constants.O_RDONLY).toBe(constants.O_RDONLY);
  });

  it("classifies fallback and opening identity changes by phase", async () => {
    const expected = await inspectedFixture("phase-expected", "abc");
    const replacement = await inspectedFixture("phase-replacement", "abc");
    let opened = false;
    const beforeOpen = await readInspectedUtf8File(expected.inspected, 3, async () => true, {
      lstatPath: async () => replacement.stats,
      openFile: async () => {
        opened = true;
        return handleFor(replacement.stats, Buffer.from("abc"));
      },
      capabilities: { noFollow: false, nonBlock: false },
    });
    expect(beforeOpen).toEqual({
      ok: false,
      reason: "changed",
      subject: "file",
      phase: "before-open",
    });
    expect(opened).toBe(false);

    let closes = 0;
    let getterCalls = 0;
    let callableCalls = 0;
    const opening = await restoringInheritedThen(() =>
      readInspectedUtf8File(
        expected.inspected,
        3,
        async () => true,
        ioFor(
          expected.stats,
          handleFor(replacement.stats, Buffer.from("abc"), {
            onClose: () => {
              closes += 1;
              installInheritedThen(
                () => (getterCalls += 1),
                () => (callableCalls += 1),
              );
            },
          }),
        ),
      ),
    );
    expectAsyncResultRecord(opening, {
      ok: false,
      reason: "changed",
      subject: "file",
      phase: "opening",
    });
    expect(closes).toBe(1);
    expect({ callableCalls, getterCalls }).toEqual({ callableCalls: 0, getterCalls: 0 });
  });

  it.runIf(HAS_NO_FOLLOW && HAS_NON_BLOCK)(
    "opens with no-follow and non-blocking flags when supported",
    async () => {
      const { inspected, stats } = await inspectedFixture("generic-flags", "x");
      let flags = 0;
      let lstats = 0;
      const result = await readInspectedUtf8File(inspected, 1, async () => true, {
        lstatPath: async () => {
          lstats += 1;
          return stats;
        },
        openFile: async (_path, openFlags) => {
          flags = openFlags;
          return handleFor(stats, Buffer.from("x"));
        },
        capabilities: { noFollow: true, nonBlock: true },
      });
      expect(result.ok).toBe(true);
      expect(flags & (NO_FOLLOW_FLAG as number)).toBe(NO_FOLLOW_FLAG);
      expect(flags & (NON_BLOCK_FLAG as number)).toBe(NON_BLOCK_FLAG);
      expect(lstats).toBe(1);
    },
  );

  it.each([Number.NaN, -1, 0.5, 3])("rejects the invalid read count %s", async (bytesRead) => {
    const { inspected, stats } = await inspectedFixture(`invalid-read-${String(bytesRead)}`, "x");
    let closes = 0;
    const result = await readInspectedUtf8File(
      inspected,
      1,
      async () => true,
      ioFor(
        stats,
        handleFor(stats, Buffer.from("x"), {
          onClose: () => (closes += 1),
          onRead: () => bytesRead,
        }),
      ),
    );
    expect(result).toEqual({ ok: false, reason: "invalid-read" });
    expect(closes).toBe(1);
  });

  it("rejects a detached read buffer before copying any non-number source byte", async () => {
    const { inspected, stats } = await inspectedFixture("detached-read", "x");
    let closes = 0;
    const result = await readInspectedUtf8File(
      inspected,
      1,
      async () => true,
      ioFor(
        stats,
        handleFor(stats, Buffer.from("x"), {
          detachAfterRead: true,
          onClose: () => (closes += 1),
        }),
      ),
    );
    expect(result).toEqual({ ok: false, reason: "invalid-read" });
    expect(closes).toBe(1);
  });

  it("reads only maxBytes plus one and returns too-large without post-read checks", async () => {
    const { inspected, stats } = await inspectedFixture("growth-limit", "abc");
    let contextCalls = 0;
    let statCalls = 0;
    let lstatCalls = 0;
    let closes = 0;
    const result = await readInspectedUtf8File(
      inspected,
      3,
      async () => {
        contextCalls += 1;
        return true;
      },
      {
        lstatPath: async () => {
          lstatCalls += 1;
          return stats;
        },
        openFile: async () =>
          handleFor(stats, Buffer.alloc(0), {
            closeFails: true,
            onClose: () => (closes += 1),
            onRead: (requested) => requested,
            onStat: () => (statCalls += 1),
          }),
        capabilities: { noFollow: HAS_NO_FOLLOW, nonBlock: false },
      },
    );
    expect(result).toEqual({ ok: false, reason: "too-large" });
    expect({ contextCalls, statCalls, lstatCalls, closes }).toEqual({
      contextCalls: 1,
      statCalls: 1,
      lstatCalls: HAS_NO_FOLLOW ? 0 : 1,
      closes: 1,
    });
  });

  it("classifies all post-read file changes before a context change", async () => {
    const expected = await inspectedFixture("reading-expected", "abc");
    const replacement = await inspectedFixture("reading-replacement", "abc");
    const cases = [
      {
        name: "length",
        bytes: Buffer.from("ab"),
        afterStats: expected.stats,
        pathStats: expected.stats,
      },
      {
        name: "descriptor",
        bytes: Buffer.from("abc"),
        afterStats: replacement.stats,
        pathStats: expected.stats,
      },
      {
        name: "path",
        bytes: Buffer.from("abc"),
        afterStats: expected.stats,
        pathStats: replacement.stats,
      },
    ] as const;
    for (const scenario of cases) {
      let contextCalls = 0;
      const result = await readInspectedUtf8File(
        expected.inspected,
        3,
        async () => {
          contextCalls += 1;
          return contextCalls === 1;
        },
        ioFor(
          scenario.pathStats,
          handleFor(expected.stats, scenario.bytes, { afterStats: scenario.afterStats }),
        ),
      );
      expect(result, scenario.name).toEqual({
        ok: false,
        reason: "changed",
        subject: "file",
        phase: "reading",
      });
      expect(contextCalls).toBe(2);
    }
  });

  it("reports a post-read context change after stable file checks", async () => {
    const { inspected, stats } = await inspectedFixture("reading-context", "abc");
    let checks = 0;
    const result = await readInspectedUtf8File(
      inspected,
      3,
      async () => {
        checks += 1;
        return checks === 1;
      },
      ioFor(stats, handleFor(stats, Buffer.from("abc"))),
    );
    expect(result).toEqual({
      ok: false,
      reason: "changed",
      subject: "context",
      phase: "reading",
    });
  });

  it("revalidates the context after the read handle closes", async () => {
    const { inspected, stats } = await inspectedFixture("close-revalidate", "abc");
    let current = true;
    const result = await readInspectedUtf8File(
      inspected,
      3,
      async () => current,
      ioFor(
        stats,
        handleFor(stats, Buffer.from("abc"), {
          onClose: () => {
            current = false;
          },
        }),
      ),
    );
    expect(result).toEqual({
      ok: false,
      reason: "changed",
      subject: "context",
      phase: "reading",
    });
  });

  it("rejects malformed UTF-8 only after stable post-read checks", async () => {
    const bytes = Uint8Array.from([0xc3, 0x28]);
    const { inspected, stats } = await inspectedFixture("invalid-utf8", bytes);
    let checks = 0;
    const result = await readInspectedUtf8File(
      inspected,
      bytes.length,
      async () => {
        checks += 1;
        return true;
      },
      ioFor(stats, handleFor(stats, bytes)),
    );
    expect(result).toEqual({ ok: false, reason: "invalid-utf8" });
    expect(Object.isFrozen(result)).toBe(true);
    expect(checks).toBe(2);
  });

  it("normalizes callback and filesystem failures without exposing errors", async () => {
    const { inspected, stats } = await inspectedFixture("generic-io", "x");
    const callbackFailure = await readInspectedUtf8File(inspected, 1, async () => {
      throw new Error("secret callback failure");
    });
    expect(callbackFailure).toEqual({ ok: false, reason: "io" });
    expect(JSON.stringify(callbackFailure)).not.toContain("secret");

    const fallbackFailure = await readInspectedUtf8File(inspected, 1, async () => true, {
      lstatPath: async () => {
        throw new Error("secret lstat failure");
      },
      openFile: async () => handleFor(stats, Buffer.from("x")),
      capabilities: { noFollow: false, nonBlock: false },
    });
    expect(fallbackFailure).toEqual({ ok: false, reason: "io" });

    const openFailure = await readInspectedUtf8File(inspected, 1, async () => true, {
      lstatPath: async () => stats,
      openFile: async () => {
        throw new Error("secret open failure");
      },
      capabilities: { noFollow: HAS_NO_FOLLOW, nonBlock: false },
    });
    expect(openFailure).toEqual({ ok: false, reason: "io" });

    const invalidAdapter = await readInspectedUtf8File(inspected, 1, async () => true, {
      lstatPath: async () => stats,
      openFile: undefined as unknown as InspectedFileReadIo["openFile"],
      capabilities: { noFollow: false, nonBlock: false },
    });
    expect(invalidAdapter).toEqual({ ok: false, reason: "io" });
  });

  it("closes an opened handle exactly once for stat failures and successful reads", async () => {
    const { inspected, stats } = await inspectedFixture("close-once", "x");
    let failedCloses = 0;
    let getterCalls = 0;
    let callableCalls = 0;
    const failed = await restoringInheritedThen(() =>
      readInspectedUtf8File(inspected, 1, async () => true, {
        lstatPath: async () => stats,
        openFile: async () => ({
          async stat() {
            throw new Error("stat failed");
          },
          async read() {
            return { bytesRead: 0 };
          },
          async close() {
            failedCloses += 1;
            installInheritedThen(
              () => (getterCalls += 1),
              () => (callableCalls += 1),
            );
          },
        }),
        capabilities: { noFollow: HAS_NO_FOLLOW, nonBlock: false },
      }),
    );
    expectAsyncResultRecord(failed, { ok: false, reason: "io" });
    expect(failedCloses).toBe(1);
    expect({ callableCalls, getterCalls }).toEqual({ callableCalls: 0, getterCalls: 0 });

    let successCloses = 0;
    const success = await readInspectedUtf8File(
      inspected,
      1,
      async () => true,
      ioFor(
        stats,
        handleFor(stats, Buffer.from("x"), {
          closeFails: true,
          onClose: () => (successCloses += 1),
        }),
      ),
    );
    expect(success).toEqual({ ok: true, text: "x", byteLength: 1 });
    expect(successCloses).toBe(1);
  });

  it("blocks inherited callable then values on early failures without touching IO", async () => {
    for (const mode of ["data", "getter"] as const) {
      const inherited = Object.getOwnPropertyDescriptor(Object.prototype, THEN_PROPERTY);
      let getterCalls = 0;
      let callableCalls = 0;
      let ioCalls = 0;
      const callable = (resolve: (value: unknown) => void) => {
        callableCalls += 1;
        resolve("poisoned");
      };
      Object.defineProperty(Object.prototype, THEN_PROPERTY, {
        configurable: true,
        ...(mode === "data"
          ? { value: callable }
          : {
              get: () => {
                getterCalls += 1;
                return callable;
              },
            }),
      });
      const touchIo = () => {
        ioCalls += 1;
        throw new Error("unexpected IO");
      };
      let result: Awaited<ReturnType<typeof readInspectedUtf8File>> | undefined;
      try {
        result = await readInspectedUtf8File({} as InspectedFile, -1, async () => touchIo(), {
          lstatPath: async () => touchIo(),
          openFile: async () => touchIo(),
          capabilities: { noFollow: false, nonBlock: false },
        });
      } finally {
        restoreInheritedThen(inherited);
      }
      if (result === undefined) throw new Error("missing file-read result");
      expectAsyncResultRecord(result, { ok: false, reason: "invalid-metadata" });
      expect({ callableCalls, getterCalls, ioCalls }).toEqual({
        callableCalls: 0,
        getterCalls: 0,
        ioCalls: 0,
      });
    }
  });

  it("keeps SAFE bytes across individual and combined live FORGED intrinsic pollution", async () => {
    const safeBytes = Uint8Array.from([0x53, 0x41, 0x46, 0x45]);
    const { inspected, stats } = await inspectedFixture("captured-copy-intrinsics", safeBytes);
    let poisonCalls = 0;
    const poison = () => {
      poisonCalls += 1;
      return "FORGED";
    };
    const mutations: readonly PropertyMutation[] = [
      [Number, "isSafeInteger", { configurable: true, value: poison }],
      [globalThis, "Number", { configurable: true, value: poison }],
      [globalThis, "BigInt", { configurable: true, value: poison }],
      [Buffer, "alloc", { configurable: true, value: poison }],
      [Buffer, "from", { configurable: true, value: poison }],
      [Buffer, "concat", { configurable: true, value: poison }],
      [Buffer.prototype, "subarray", { configurable: true, value: poison }],
      ...(["valueOf", "buffer", "byteOffset", "length", "0"] as const).map(
        (key) => [Buffer.prototype, key, { configurable: true, get: poison }] as const,
      ),
      [Buffer, "poolSize", { configurable: true, get: poison }],
      [Buffer, Symbol.species, { configurable: true, get: poison }],
      [Math, "min", { configurable: true, value: poison }],
      [Array.prototype, "push", { configurable: true, value: poison }],
      [Array.prototype, "0", { configurable: true, set: poison }],
      [NodeTextDecoder.prototype, "decode", { configurable: true, value: poison }],
      [Reflect, "apply", { configurable: true, value: poison }],
      [Object, "defineProperty", { configurable: true, value: poison }],
      [Object, "freeze", { configurable: true, value: poison }],
    ];

    const readSafe = () =>
      readInspectedUtf8File(
        inspected,
        4,
        async () => true,
        ioFor(stats, handleFor(stats, safeBytes), {
          noFollow: false,
          nonBlock: false,
        }),
      );

    for (let index = 0; index <= mutations.length; index += 1) {
      const before = poisonCalls;
      const selected =
        index === mutations.length ? mutations : [mutations[index] as PropertyMutation];
      const observed = await withPropertyMutations(selected, readSafe);
      expect(observed).toEqual({ ok: true, text: "SAFE", byteLength: 4 });
      expect(poisonCalls).toBe(before);
    }
  });

  it("retains captured native lstat, open, Buffer, and TextDecoder bindings", async () => {
    const { inspected, stats } = await inspectedFixture("captured-native-bindings", "SAFE");
    const allocDescriptor = getOwnPropertyDescriptorIntrinsic(Buffer, "alloc");
    if (allocDescriptor === undefined) throw new Error("missing Buffer.alloc");
    const nativeAlloc = Buffer.alloc;
    const allocSizes: number[] = [];
    let allocCalls = 0;
    function countedAlloc(this: unknown, size: number): Buffer {
      if (this !== undefined) throw new Error("unexpected Buffer.alloc receiver");
      allocSizes[allocCalls] = size;
      allocCalls += 1;
      return Reflect.apply(nativeAlloc, undefined, [size]);
    }
    definePropertyIntrinsic(Buffer, "alloc", { ...allocDescriptor, value: countedAlloc });
    vi.resetModules();
    let isolated: typeof import("../src/validate/file-read.js");
    try {
      isolated = await import("../src/validate/file-read.js");
    } finally {
      definePropertyIntrinsic(Buffer, "alloc", allocDescriptor);
    }
    let readCalls = 0;
    const shortRead = await isolated.readInspectedUtf8File(
      inspected,
      4,
      async () => true,
      ioFor(
        stats,
        handleFor(stats, Buffer.from("SAFE"), {
          maxReadBytes: 1,
          onRead: () => {
            readCalls += 1;
            return undefined;
          },
        }),
      ),
    );
    expect(shortRead).toEqual({ ok: true, text: "SAFE", byteLength: 4 });
    expect({ allocSizes, readCalls }).toEqual({
      allocSizes: [64 * 1024, 4],
      readCalls: 5,
    });
    let poisonCalls = 0;
    const poison = (): never => {
      poisonCalls += 1;
      throw new Error("synchronized builtin binding used");
    };
    const mutations: readonly PropertyMutation[] = [
      [fsPromisesModule, "lstat", { configurable: true, value: poison }],
      [fsPromisesModule, "open", { configurable: true, value: poison }],
      [bufferModule, "Buffer", { configurable: true, value: poison }],
      [utilModule, "TextDecoder", { configurable: true, value: poison }],
    ];
    let result: Awaited<ReturnType<typeof readInspectedUtf8File>> | undefined;
    try {
      result = await withPropertyMutations(mutations, async () => {
        syncBuiltinESMExports();
        return isolated.readInspectedUtf8File(inspected, 4, async () => true);
      });
    } finally {
      syncBuiltinESMExports();
    }
    if (result === undefined) throw new Error("missing file-read result");
    expectAsyncResultRecord(result, { ok: true, text: "SAFE", byteLength: 4 });
    expect([allocCalls, poisonCalls]).toEqual([4, 0]);
  });

  it("uses captured result intrinsics after live Reflect and Object pollution", async () => {
    const objectConstructor = Object;
    const apply = Reflect.apply;
    const defineProperty = Object.defineProperty;
    const freeze = Object.freeze;
    let poisonCalls = 0;
    const poison = () => {
      poisonCalls += 1;
      throw new Error("live intrinsic used");
    };
    let result: Awaited<ReturnType<typeof readInspectedUtf8File>> | undefined;
    try {
      Reflect.apply = poison as typeof Reflect.apply;
      objectConstructor.defineProperty = poison as typeof Object.defineProperty;
      objectConstructor.freeze = poison as typeof Object.freeze;
      globalThis.Object = poison as unknown as ObjectConstructor;
      result = await readInspectedUtf8File({} as InspectedFile, -1, async () => true);
    } finally {
      globalThis.Object = objectConstructor;
      objectConstructor.defineProperty = defineProperty;
      objectConstructor.freeze = freeze;
      Reflect.apply = apply;
    }
    if (result === undefined) throw new Error("missing file-read result");
    expectAsyncResultRecord(result, { ok: false, reason: "invalid-metadata" });
    expect(poisonCalls).toBe(0);
  });
});
