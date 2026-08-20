import { constants } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { types } from "node:util";

import { afterEach, describe, expect, it, vi } from "vitest";

import { DiagnosticCollector } from "../src/validate/diagnostics.js";
import {
  openInspectedResourceTreeSession,
  readResourceTreeSessionUtf8Member,
} from "../src/validate/resource-tree-session.js";
import { inspectAgentSkillDocument } from "../src/validate/skill-document.js";
import { inspectAgentSkillRoot } from "../src/validate/skill-root.js";
import { createSkillFixtures, skillDocument } from "./helpers/skill-fixtures.js";

const fixtures = createSkillFixtures();
const modulePaths = [
  "../src/validate/resource-tree-capture.js",
  "../src/validate/resource-tree-comparison.js",
  "../src/validate/file-read.js",
  "../src/validate/resource-tree-session-io.js",
  "../src/validate/skill-document.js",
] as const;

afterEach(async () => {
  await fixtures.cleanup();
  for (const path of modulePaths) vi.doUnmock(path);
  vi.resetModules();
});

function barrier<T extends object>(value: T): Readonly<T> {
  // biome-ignore lint/suspicious/noThenProperty: async result fixtures need the same barrier.
  Object.defineProperty(value, "then", {
    configurable: false,
    enumerable: false,
    value: undefined,
    writable: false,
  });
  return Object.freeze(value);
}

function expectBarrier(value: object, keys: readonly string[]): void {
  expect(Object.keys(value)).toEqual(keys);
  expect(Object.getOwnPropertyDescriptor(value, "then")).toEqual({
    configurable: false,
    enumerable: false,
    value: undefined,
    writable: false,
  });
  expect(Object.getPrototypeOf(value)).toBe(Object.prototype);
  expect(Object.isFrozen(value)).toBe(true);
}

const directoryMetadata = Object.freeze({
  dev: 1n,
  ino: 1n,
  mode: BigInt(constants.S_IFDIR | 0o700),
  size: 0n,
  mtimeNs: 1n,
  ctimeNs: 1n,
  kind: "directory" as const,
});
const fileMetadata = Object.freeze({
  ...directoryMetadata,
  ino: 2n,
  mode: BigInt(constants.S_IFREG | 0o600),
  size: 3n,
  kind: "file" as const,
});

type EntryRole = "document" | "resource-file" | "directory";

function entry(role: EntryRole, entryIndex: number, relativePath: string, metadata = fileMetadata) {
  return Object.freeze({
    role,
    layout: Object.freeze({ entryIndex, relativePath }),
    metadata,
  });
}

function capture(entries: readonly object[]) {
  return barrier({
    ok: true as const,
    root: Object.freeze({ marker: "root" }),
    entries,
  });
}

type ReadCall = readonly [unknown, unknown, unknown, unknown];
type MockState = {
  readonly document: { readonly root: { readonly path: string }; readonly path: string };
  readonly io: {
    readonly lstatPath: () => Promise<never>;
    readonly openDirectory: () => Promise<never>;
    readonly rootIsCurrent: (root: unknown) => Promise<boolean>;
    readonly openFile: () => Promise<never>;
    readonly capabilities: { readonly noFollow: boolean; readonly nonBlock: boolean };
  };
  readonly captureCalls: unknown[][];
  readonly readCalls: ReadCall[];
  readonly readReceivers: unknown[];
  readonly rootCalls: Array<readonly [unknown, unknown]>;
  readonly snapshotValues: unknown[];
  readonly queue: unknown[];
  readImpl: (...argumentsList: unknown[]) => unknown;
  rootImpl: () => Promise<boolean>;
};

function stateFor(entries: readonly object[], documentPath = "/trusted/root/SKILL.md"): MockState {
  let state: MockState;
  const root = Object.freeze({ path: "/trusted/root" });
  const io = Object.freeze({
    lstatPath: async (): Promise<never> => {
      throw new Error("capture must not run during member reads");
    },
    openDirectory: async (): Promise<never> => {
      throw new Error("capture must not run during member reads");
    },
    rootIsCurrent: async function (this: unknown, value: unknown): Promise<boolean> {
      state.rootCalls.push([this, value]);
      return state.rootImpl();
    },
    openFile: async (): Promise<never> => {
      throw new Error("generic reader is mocked");
    },
    capabilities: Object.freeze({ noFollow: true, nonBlock: true }),
  });
  const observed = capture(Object.freeze([entry("document", 0, "SKILL.md"), ...entries]));
  state = {
    document: Object.freeze({ root, path: documentPath }),
    io,
    captureCalls: [],
    readCalls: [],
    readReceivers: [],
    rootCalls: [],
    snapshotValues: [],
    queue: [capture(Object.freeze([])), observed],
    readImpl: async (...argumentsList: unknown[]) => {
      const current = argumentsList[2] as () => Promise<boolean>;
      if ((await current()) !== true || (await current()) !== true) {
        return barrier({ ok: false as const, reason: "changed" as const });
      }
      return barrier({ ok: true as const, text: "abc", byteLength: 3 });
    },
    rootImpl: async () => true,
  };
  return state;
}

async function mockedSession(state: MockState) {
  vi.doMock(modulePaths[0], () => ({
    captureInspectedResourceTree: function (this: unknown, ...argumentsList: unknown[]) {
      state.captureCalls.push(argumentsList);
      return Promise.resolve(state.queue.shift());
    },
  }));
  vi.doMock(modulePaths[1], () => ({
    compareResourceTreeCaptureSemantics: () => "equal",
  }));
  vi.doMock(modulePaths[2], () => ({
    readInspectedUtf8File: function (this: unknown, ...argumentsList: unknown[]) {
      state.readReceivers.push(this);
      state.readCalls.push(argumentsList as ReadCall);
      return state.readImpl(...argumentsList);
    },
  }));
  vi.doMock(modulePaths[3], () => ({
    snapshotResourceTreeSessionIo(value: unknown) {
      state.snapshotValues.push(value);
      return state.io;
    },
  }));
  vi.doMock(modulePaths[4], () => ({
    isGenuineDocumentInspection: (value: unknown) => value === state.document,
  }));
  vi.resetModules();
  return import("../src/validate/resource-tree-session.js");
}

async function openMocked(state: MockState) {
  const sessionModule = await mockedSession(state);
  const opened = await sessionModule.openInspectedResourceTreeSession(
    state.document,
    undefined,
    {},
  );
  expect(opened.ok).toBe(true);
  if (!opened.ok) throw new Error("expected mocked session");
  return { sessionModule, opened };
}

describe("resource-tree session member reads", () => {
  it("reads exact real captured members and detects replacement without accepting a clone", async () => {
    const source = skillDocument(
      "name: member-read\ndescription: Member read fixture.\nlicense: MIT",
    );
    const fixture = await fixtures.skill("member-read", source);
    await writeFile(join(fixture.directory, "resource.txt"), "first resource value", {
      mode: 0o600,
    });
    await mkdir(join(fixture.directory, "docs"));
    await writeFile(join(fixture.directory, "docs", "guide.txt"), "guide", { mode: 0o600 });
    const diagnostics = new DiagnosticCollector();
    const root = await inspectAgentSkillRoot(fixture.directory, diagnostics);
    if (root === undefined) throw new Error("expected genuine root");
    const document = await inspectAgentSkillDocument(root, diagnostics);
    if (document === undefined) throw new Error("expected genuine document");
    const opened = await openInspectedResourceTreeSession(document);
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    const documentEntry = opened.session.entries.find((value) => value.role === "document");
    const resourceEntry = opened.session.entries.find(
      (value) => value.layout.relativePath === "resource.txt",
    );
    const directoryEntry = opened.session.entries.find(
      (value) => value.layout.relativePath === "docs",
    );
    if (
      documentEntry === undefined ||
      resourceEntry === undefined ||
      directoryEntry === undefined
    ) {
      throw new Error("expected captured members");
    }
    const documentRead = await readResourceTreeSessionUtf8Member(opened.session, documentEntry);
    expect(documentRead).toEqual({
      ok: true,
      text: await readFile(document.path, "utf8"),
      byteLength: Buffer.byteLength(source),
    });
    expectBarrier(documentRead, ["ok", "text", "byteLength"]);
    expect(await readResourceTreeSessionUtf8Member(opened.session, directoryEntry)).toEqual({
      ok: false,
      reason: "unsupported_kind",
    });
    expect(
      await readResourceTreeSessionUtf8Member(opened.session, structuredClone(resourceEntry)),
    ).toEqual({ ok: false, reason: "invalid_input" });
    await writeFile(join(fixture.directory, "resource.txt"), "stable replacement value", {
      mode: 0o600,
    });
    expect(await readResourceTreeSessionUtf8Member(opened.session, resourceEntry)).toEqual({
      ok: false,
      reason: "changed",
    });
  });

  it("retains B member identities and applies session, member, signal, then role priority", async () => {
    const resource = {
      role: "resource-file" as EntryRole,
      layout: { entryIndex: 1, relativePath: "member.txt" },
      metadata: { ...fileMetadata },
    };
    const directory = entry("directory", 2, "directory", directoryMetadata);
    const state = stateFor([resource, directory]);
    const { sessionModule, opened } = await openMocked(state);
    const success = await sessionModule.readResourceTreeSessionUtf8Member(opened.session, resource);
    expect(success).toEqual({ ok: true, text: "abc", byteLength: 3 });
    expectBarrier(success, ["ok", "text", "byteLength"]);
    expect(state.captureCalls).toHaveLength(2);
    expect(state.snapshotValues).toEqual([{}]);
    expect(state.readCalls).toHaveLength(1);
    const [inspected, maxBytes, , retainedIo] = state.readCalls[0] ?? [];
    expect(inspected).toEqual({ path: "/trusted/root/member.txt", metadata: fileMetadata });
    expect(Object.isFrozen(inspected)).toBe(true);
    expect(maxBytes).toBe(512 * 1024);
    expect(retainedIo).toBe(state.io);
    expect(state.readReceivers).toEqual([undefined]);
    expect(state.rootCalls).toEqual([
      [undefined, state.document.root],
      [undefined, state.document.root],
    ]);
    resource.role = "directory";
    resource.layout.relativePath = "mutated.txt";
    resource.metadata.size = 99n;
    expect(await sessionModule.readResourceTreeSessionUtf8Member(opened.session, resource)).toEqual(
      { ok: true, text: "abc", byteLength: 3 },
    );
    expect(state.readCalls[1]?.[0]).toEqual({
      path: "/trusted/root/member.txt",
      metadata: fileMetadata,
    });

    let entryTraps = 0;
    const hostileEntry = new Proxy(resource, {
      get() {
        entryTraps += 1;
        throw new Error("entry getter");
      },
    });
    const invalidSignal = Object.create(AbortSignal.prototype) as AbortSignal;
    const controller = new AbortController();
    controller.abort();
    let sessionTraps = 0;
    const hostileSession = new Proxy(opened.session, {
      get() {
        sessionTraps += 1;
        throw new Error("session getter");
      },
    });
    expect(
      await sessionModule.readResourceTreeSessionUtf8Member(
        hostileSession,
        hostileEntry,
        invalidSignal,
      ),
    ).toEqual({ ok: false, reason: "invalid_input" });
    expect(sessionTraps).toBe(0);
    for (const unknownMember of [{}, structuredClone(resource), hostileEntry]) {
      expect(
        await sessionModule.readResourceTreeSessionUtf8Member(
          opened.session,
          unknownMember,
          invalidSignal,
        ),
      ).toEqual({ ok: false, reason: "invalid_input" });
    }
    expect(entryTraps).toBe(0);
    expect(
      await sessionModule.readResourceTreeSessionUtf8Member(
        opened.session,
        resource,
        invalidSignal,
      ),
    ).toEqual({ ok: false, reason: "invalid_input" });
    expect(
      await sessionModule.readResourceTreeSessionUtf8Member(
        opened.session,
        directory,
        controller.signal,
      ),
    ).toEqual({ ok: false, reason: "aborted" });
    expect(
      await sessionModule.readResourceTreeSessionUtf8Member(opened.session, directory),
    ).toEqual({ ok: false, reason: "unsupported_kind" });
    expect(state.readCalls).toHaveLength(2);

    const mismatchState = stateFor([], "/trusted/root/not-SKILL.md");
    const mismatch = await openMocked(mismatchState);
    const documentMember = mismatch.opened.session.entries[0];
    expect(
      await mismatch.sessionModule.readResourceTreeSessionUtf8Member(
        mismatch.opened.session,
        documentMember,
      ),
    ).toEqual({ ok: false, reason: "inconsistent" });
    expect(mismatchState.readCalls).toHaveLength(0);
  });

  it("fails closed while preparing malformed B entries before registration", async () => {
    const valid = entry("resource-file", 0, "member.txt");
    let slotGetterCalls = 0;
    const oversized: object[] = [];
    oversized.length = 8193;
    Object.defineProperty(oversized, 0, {
      get() {
        slotGetterCalls += 1;
        throw new Error("oversized slot getter");
      },
    });
    let entryTraps = 0;
    const proxiedEntry = new Proxy(valid, {
      get() {
        entryTraps += 1;
        throw new Error("entry getter");
      },
    });
    let metadataGetterCalls = 0;
    const accessorMetadata = { ...fileMetadata };
    Object.defineProperty(accessorMetadata, "kind", {
      get() {
        metadataGetterCalls += 1;
        throw new Error("metadata getter");
      },
    });
    const accessorSlots: object[] = [];
    Object.defineProperty(accessorSlots, 0, {
      get() {
        slotGetterCalls += 1;
        throw new Error("slot getter");
      },
    });
    accessorSlots.length = 1;
    const sparse = [valid];
    sparse.length = 3;
    sparse[2] = entry("resource-file", 2, "late.txt");
    const malformed = [
      oversized,
      [entry("resource-file", 0, "member.txt")],
      [entry("document", 0, "SKILL.md"), entry("document", 1, "copy.md")],
      sparse,
      accessorSlots,
      [proxiedEntry],
      [valid, valid],
      [entry("resource-file", -0, "member.txt")],
      [entry("directory", 0, "directory", fileMetadata)],
      [entry("resource-file", 0, "member.txt", accessorMetadata as never)],
      [entry("resource-file", 0, "member.txt", { ...fileMetadata, kind: undefined } as never)],
    ];
    for (const entries of malformed) {
      const state = stateFor([]);
      state.queue.splice(0, 2, capture(Object.freeze([])), capture(entries));
      const sessionModule = await mockedSession(state);
      const opened = await sessionModule.openInspectedResourceTreeSession(state.document);
      expect(opened).toEqual({ ok: false, reason: "inconsistent" });
      if (opened.ok) expect(sessionModule.isGenuineResourceTreeSession(opened.session)).toBe(false);
    }
    expect(slotGetterCalls).toBe(0);
    expect(entryTraps).toBe(0);
    expect(metadataGetterCalls).toBe(0);
  });

  it("copies every legal generic result and rejects malformed or non-Promise producers", async () => {
    const resource = entry("resource-file", 1, "member.txt");
    const state = stateFor([resource]);
    const { sessionModule, opened } = await openMocked(state);
    const cases = [
      [
        { ok: true, text: "€", byteLength: 3 },
        { ok: true, text: "€", byteLength: 3 },
      ],
      [
        { ok: false, reason: "too-large" },
        { ok: false, reason: "too_large" },
      ],
      [
        { ok: false, reason: "invalid-metadata" },
        { ok: false, reason: "invalid_metadata" },
      ],
      [
        { ok: false, reason: "invalid-read" },
        { ok: false, reason: "invalid_read" },
      ],
      [
        { ok: false, reason: "invalid-utf8" },
        { ok: false, reason: "invalid_utf8" },
      ],
      [
        { ok: false, reason: "io" },
        { ok: false, reason: "io" },
      ],
      [
        { ok: false, reason: "changed", subject: "context", phase: "reading" },
        { ok: false, reason: "changed" },
      ],
      [
        { ok: false, reason: "changed", subject: "file", phase: "opening" },
        { ok: false, reason: "changed" },
      ],
    ] as const;
    for (const [raw, expected] of cases) {
      state.readImpl = () => Promise.resolve(Object.freeze(raw));
      const result = await sessionModule.readResourceTreeSessionUtf8Member(
        opened.session,
        resource,
      );
      expect(result).toEqual(expected);
      expectBarrier(result, expected.ok ? ["ok", "text", "byteLength"] : ["ok", "reason"]);
    }

    let accessorCalls = 0;
    const accessor = Object.defineProperty({}, "ok", {
      get() {
        accessorCalls += 1;
        throw new Error("result getter");
      },
    });
    let proxyTraps = 0;
    for (const raw of [
      null,
      {},
      accessor,
      { ok: true, text: "abc", byteLength: -0 },
      { ok: true, text: "€", byteLength: 1 },
      { ok: false, reason: "changed", subject: "file", phase: "after-open" },
      { ok: false, reason: "secret", path: "/secret" },
    ]) {
      state.readImpl = () => Promise.resolve(raw);
      expect(
        await sessionModule.readResourceTreeSessionUtf8Member(opened.session, resource),
      ).toEqual({ ok: false, reason: "inconsistent" });
    }
    const proxiedPromise = new Proxy(Promise.resolve({ ok: true, text: "abc", byteLength: 3 }), {
      get() {
        proxyTraps += 1;
        throw new Error("promise proxy getter");
      },
    });
    state.readImpl = () => proxiedPromise;
    expect(await sessionModule.readResourceTreeSessionUtf8Member(opened.session, resource)).toEqual(
      { ok: false, reason: "inconsistent" },
    );
    let thenGetterCalls = 0;
    state.readImpl = () => {
      // biome-ignore lint/suspicious/noThenProperty: the producer must reject thenables unread.
      return Object.defineProperty({}, "then", {
        get() {
          thenGetterCalls += 1;
          throw new Error("then getter");
        },
      });
    };
    expect(await sessionModule.readResourceTreeSessionUtf8Member(opened.session, resource)).toEqual(
      {
        ok: false,
        reason: "inconsistent",
      },
    );
    state.readImpl = () => Promise.reject(new Error("secret rejection"));
    expect(await sessionModule.readResourceTreeSessionUtf8Member(opened.session, resource)).toEqual(
      {
        ok: false,
        reason: "inconsistent",
      },
    );
    let constructorGetterCalls = 0;
    let thenGetterCallsOnSubclass = 0;
    let thenCallsOnSubclass = 0;
    class HostilePromise<T> extends Promise<T> {}
    // biome-ignore lint/suspicious/noThenProperty: the gate must reject this without assimilation.
    Object.defineProperty(HostilePromise.prototype, "then", {
      get() {
        thenGetterCallsOnSubclass += 1;
        return () => (thenCallsOnSubclass += 1);
      },
    });
    state.readImpl = () =>
      new HostilePromise((resolve) => resolve({ ok: true, text: "abc", byteLength: 3 }));
    expect(await sessionModule.readResourceTreeSessionUtf8Member(opened.session, resource)).toEqual(
      { ok: false, reason: "inconsistent" },
    );
    const ownConstructor = Promise.resolve({ ok: true, text: "abc", byteLength: 3 });
    Object.defineProperty(ownConstructor, "constructor", {
      get() {
        constructorGetterCalls += 1;
        throw new Error("constructor getter");
      },
    });
    state.readImpl = () => ownConstructor;
    expect(await sessionModule.readResourceTreeSessionUtf8Member(opened.session, resource)).toEqual(
      { ok: false, reason: "inconsistent" },
    );
    const prototypeConstructor = Object.getOwnPropertyDescriptor(Promise.prototype, "constructor");
    const prototypePoisoned = Promise.resolve({ ok: true, text: "abc", byteLength: 3 });
    let prototypeResult: ReturnType<typeof sessionModule.readResourceTreeSessionUtf8Member>;
    try {
      Object.defineProperty(Promise.prototype, "constructor", {
        configurable: true,
        get() {
          constructorGetterCalls += 1;
          throw new Error("prototype constructor getter");
        },
      });
      state.readImpl = () => prototypePoisoned;
      prototypeResult = sessionModule.readResourceTreeSessionUtf8Member(opened.session, resource);
    } finally {
      if (prototypeConstructor !== undefined) {
        Object.defineProperty(Promise.prototype, "constructor", prototypeConstructor);
      }
    }
    expect(await prototypeResult).toEqual({ ok: false, reason: "inconsistent" });
    expect(accessorCalls).toBe(0);
    expect(proxyTraps).toBe(0);
    expect(thenGetterCalls).toBe(0);
    expect(constructorGetterCalls).toBe(0);
    expect(thenGetterCallsOnSubclass).toBe(0);
    expect(thenCallsOnSubclass).toBe(0);
  });

  it("makes sticky cancellation win and uses captured result intrinsics", async () => {
    const resource = entry("resource-file", 1, "member.txt");
    const state = stateFor([resource]);
    const { sessionModule, opened } = await openMocked(state);
    const controller = new AbortController();
    state.rootImpl = async () => {
      controller.abort();
      return true;
    };
    state.readImpl = async (...argumentsList: unknown[]) => {
      await (argumentsList[2] as () => Promise<boolean>)();
      Object.setPrototypeOf(controller.signal, null);
      return { ok: true, text: "abc", byteLength: 3 };
    };
    expect(
      await sessionModule.readResourceTreeSessionUtf8Member(
        opened.session,
        resource,
        controller.signal,
      ),
    ).toEqual({ ok: false, reason: "aborted" });

    const finalController = new AbortController();
    let settle: ((value: unknown) => void) | undefined;
    state.readImpl = () => new Promise((resolve) => (settle = resolve));
    const pending = sessionModule.readResourceTreeSessionUtf8Member(
      opened.session,
      resource,
      finalController.signal,
    );
    settle?.({ ok: false, reason: "secret" });
    finalController.abort();
    expect(await pending).toEqual({ ok: false, reason: "aborted" });

    const safeResult = Promise.resolve({ ok: true, text: "abc", byteLength: 3 });
    state.readImpl = () => safeResult;
    const targets = [
      [Reflect, "apply"],
      [Object, "defineProperty"],
      [Object, "freeze"],
      [Object, "getOwnPropertyDescriptor"],
      [Object, "getPrototypeOf"],
      [Object, "is"],
      [Array, "isArray"],
      [Number, "isSafeInteger"],
      [Buffer, "byteLength"],
      [WeakMap.prototype, "get"],
      [types, "isPromise"],
      [types, "isProxy"],
    ] as const;
    const define = Reflect.defineProperty;
    const descriptors = targets.map(
      ([target, key]) => [target, key, Object.getOwnPropertyDescriptor(target, key)] as const,
    );
    const objectPrototype = Object.prototype;
    const thenDescriptor = Object.getOwnPropertyDescriptor(objectPrototype, "then");
    const objectGlobal = Object.getOwnPropertyDescriptor(globalThis, "Object");
    const arrayGlobal = Object.getOwnPropertyDescriptor(globalThis, "Array");
    let poisonCalls = 0;
    let globalGetterCalls = 0;
    let inheritedThenCalls = 0;
    const poison = (): never => {
      poisonCalls += 1;
      throw new Error("live intrinsic used");
    };
    let result: Awaited<ReturnType<typeof sessionModule.readResourceTreeSessionUtf8Member>>;
    try {
      for (const [target, key, descriptor] of descriptors) {
        if (descriptor === undefined) throw new Error(`missing ${key}`);
        define(target, key, { ...descriptor, value: poison });
      }
      define(objectPrototype, "then", {
        configurable: true,
        get() {
          inheritedThenCalls += 1;
          return poison;
        },
      });
      for (const key of ["Object", "Array"] as const) {
        define(globalThis, key, {
          configurable: true,
          get() {
            globalGetterCalls += 1;
            throw new Error(`live global ${key} used`);
          },
        });
      }
      result = await sessionModule.readResourceTreeSessionUtf8Member(opened.session, resource);
    } finally {
      if (objectGlobal !== undefined) define(globalThis, "Object", objectGlobal);
      if (arrayGlobal !== undefined) define(globalThis, "Array", arrayGlobal);
      for (const [target, key, descriptor] of descriptors) {
        if (descriptor !== undefined) define(target, key, descriptor);
      }
      if (thenDescriptor === undefined) Reflect.deleteProperty(objectPrototype, "then");
      else define(objectPrototype, "then", thenDescriptor);
    }
    expect(result).toEqual({ ok: true, text: "abc", byteLength: 3 });
    expectBarrier(result, ["ok", "text", "byteLength"]);
    expect(poisonCalls).toBe(0);
    expect(inheritedThenCalls).toBe(0);
    expect(globalGetterCalls).toBe(0);

    const rootSource = await readFile(new URL("../src/index.ts", import.meta.url), "utf8");
    expect(rootSource).not.toContain("readResourceTreeSessionUtf8Member");
    expect(rootSource).not.toContain("ResourceTreeSessionMember");
  });
});
