import fsPromisesModule, { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { types } from "node:util";

import { afterEach, describe, expect, it, vi } from "vitest";

import { DiagnosticCollector } from "../src/validate/diagnostics.js";
import type { ResourceTreeCaptureFailureReason } from "../src/validate/resource-tree-capture.js";
import {
  isGenuineResourceTreeSession,
  openInspectedResourceTreeSession,
  resourceTreeSessionIsCurrent,
  type ResourceTreeSessionFailure,
} from "../src/validate/resource-tree-session.js";
import {
  type ResourceTreeSessionIo,
  snapshotResourceTreeSessionIo,
} from "../src/validate/resource-tree-session-io.js";
import { inspectAgentSkillDocument } from "../src/validate/skill-document.js";
import type { DocumentInspection } from "../src/validate/skill-document-read.js";
import { inspectAgentSkillRoot } from "../src/validate/skill-root.js";
import { createSkillFixtures, skillDocument } from "./helpers/skill-fixtures.js";

const fixtures = createSkillFixtures();
const modulePaths = [
  "../src/validate/resource-tree-capture.js",
  "../src/validate/resource-tree-comparison.js",
  "../src/validate/skill-document.js",
  "../src/validate/resource-tree-session-io.js",
] as const;

afterEach(async () => {
  await fixtures.cleanup();
  for (const path of modulePaths) vi.doUnmock(path);
  vi.resetModules();
});

function barrier<T extends object>(value: T): Readonly<T> {
  // biome-ignore lint/suspicious/noThenProperty: session boundaries intentionally require this.
  Object.defineProperty(value, "then", {
    configurable: false,
    enumerable: false,
    value: undefined,
    writable: false,
  });
  return Object.freeze(value);
}

function expectBarrier(value: object): void {
  expect(Object.getOwnPropertyDescriptor(value, "then")).toEqual({
    configurable: false,
    enumerable: false,
    value: undefined,
    writable: false,
  });
  expect(Object.isFrozen(value)).toBe(true);
}

function failure(reason: ResourceTreeCaptureFailureReason) {
  return barrier({ ok: false as const, reason });
}

const mockFileMetadata = Object.freeze({
  dev: 1n,
  ino: 2n,
  mode: 0o100600n,
  size: 1n,
  mtimeNs: 1n,
  ctimeNs: 1n,
  kind: "file" as const,
});

function captureSuccess(marker: string) {
  const documentEntry = Object.freeze({
    role: "document" as const,
    layout: Object.freeze({ entryIndex: 0, relativePath: "SKILL.md" }),
    metadata: mockFileMetadata,
  });
  return barrier({
    ok: true as const,
    root: Object.freeze({ marker }),
    entries: Object.freeze([documentEntry]),
  });
}

function expectFailure(value: unknown, reason: ResourceTreeCaptureFailureReason): void {
  expect(value).toEqual({ ok: false, reason });
  expect(Object.keys(value as object).sort()).toEqual(["ok", "reason"]);
  expectBarrier(value as object);
}

async function genuineDocument(
  name: string,
): Promise<{ document: DocumentInspection; directory: string }> {
  const fixture = await fixtures.skill(
    name,
    skillDocument(`name: ${name}\ndescription: Session fixture.\nlicense: MIT`),
  );
  await writeFile(join(fixture.directory, "resource.txt"), "first resource value", {
    mode: 0o600,
  });
  const diagnostics = new DiagnosticCollector();
  const root = await inspectAgentSkillRoot(fixture.directory, diagnostics);
  if (root === undefined) throw new Error("expected genuine root");
  const document = await inspectAgentSkillDocument(root, diagnostics);
  if (document === undefined) throw new Error("expected genuine document");
  return { document, directory: fixture.directory };
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

type QueueItem = unknown | (() => unknown);
type Comparison = "equal" | "different" | "invalid" | "throw";
type MockState = {
  readonly document: object;
  readonly sourceIo: object;
  readonly retainedIo: ResourceTreeSessionIo;
  readonly queue: QueueItem[];
  readonly captureCalls: Array<readonly [unknown, unknown, unknown]>;
  readonly captureReceivers: unknown[];
  readonly snapshotValues: unknown[];
  readonly comparisons: Array<readonly [unknown, unknown]>;
  comparison: Comparison;
  comparisonEffect?: () => void;
};

function mockState(queue: QueueItem[] = []): MockState {
  return {
    document: Object.freeze({ marker: "genuine-document" }),
    sourceIo: Object.freeze({ marker: "source-io" }),
    retainedIo: Object.freeze({
      lstatPath: async () => ({}) as never,
      openDirectory: async () => ({}) as never,
      rootIsCurrent: async () => true,
      openFile: async () => ({}) as never,
      capabilities: Object.freeze({ noFollow: false, nonBlock: false }),
    }),
    queue,
    captureCalls: [],
    captureReceivers: [],
    snapshotValues: [],
    comparisons: [],
    comparison: "equal",
  };
}

async function mockedSession(state: MockState) {
  vi.doMock(modulePaths[0], () => ({
    captureInspectedResourceTree: function (this: unknown, ...args: unknown[]) {
      state.captureReceivers.push(this);
      state.captureCalls.push(args as unknown as readonly [unknown, unknown, unknown]);
      const next = state.queue.shift();
      if (typeof next === "function") return next();
      return next;
    },
  }));
  vi.doMock(modulePaths[3], () => ({
    snapshotResourceTreeSessionIo(value: unknown) {
      state.snapshotValues.push(value);
      return state.retainedIo;
    },
  }));
  vi.doMock(modulePaths[1], () => ({
    compareResourceTreeCaptureSemantics(left: unknown, right: unknown) {
      state.comparisons.push([left, right]);
      state.comparisonEffect?.();
      if (state.comparison === "throw") throw new Error("secret comparison error");
      return state.comparison;
    },
  }));
  vi.doMock(modulePaths[2], () => ({
    isGenuineDocumentInspection(value: unknown) {
      return value === state.document;
    },
  }));
  vi.resetModules();
  return import("../src/validate/resource-tree-session.js");
}

async function waitForCaptureCalls(state: MockState, count: number): Promise<void> {
  for (let checkpoint = 0; checkpoint < 8 && state.captureCalls.length < count; checkpoint += 1) {
    await Promise.resolve();
  }
  expect(state.captureCalls).toHaveLength(count);
}

describe("resource-tree sessions", () => {
  it("opens two equal real observations and detects a later stable resource change", async () => {
    const { document, directory } = await genuineDocument("session-real");
    const opened = await openInspectedResourceTreeSession(document);
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    expect(isGenuineResourceTreeSession(opened.session)).toBe(true);
    expect(Object.keys(opened.session)).toEqual(["root", "entries"]);
    expectBarrier(opened);
    expectBarrier(opened.session);
    expectDeepFrozen(opened);
    expect(await resourceTreeSessionIsCurrent(opened.session)).toEqual({ ok: true, current: true });

    await writeFile(join(directory, "resource.txt"), "a longer stable replacement value", {
      mode: 0o600,
    });
    const changed = await resourceTreeSessionIsCurrent(opened.session);
    expect(changed).toEqual({ ok: true, current: false });
    expectBarrier(changed);
    expect(
      JSON.stringify(opened.session, (_key, value) =>
        typeof value === "bigint" ? `${value}` : value,
      ),
    ).not.toContain(directory);
  });

  it("brands only registered identities and enforces document, signal, then IO priority", async () => {
    const { document } = await genuineDocument("session-input");
    let documentTraps = 0;
    const documentProxy = new Proxy(document, {
      get() {
        documentTraps += 1;
        throw new Error("document getter");
      },
    });
    let ioGetterCalls = 0;
    const invalidIo = {
      get lstatPath() {
        ioGetterCalls += 1;
        throw new Error("IO getter");
      },
    };
    expectFailure(
      await openInspectedResourceTreeSession(documentProxy, {}, invalidIo),
      "invalid_input",
    );
    expect(documentTraps).toBe(0);
    expect(ioGetterCalls).toBe(0);
    expectFailure(await openInspectedResourceTreeSession(document, {}, invalidIo), "invalid_input");
    expect(ioGetterCalls).toBe(0);

    const controller = new AbortController();
    controller.abort();
    expectFailure(
      await openInspectedResourceTreeSession(document, controller.signal, invalidIo),
      "io",
    );
    expect(ioGetterCalls).toBe(0);
    let ioCalls = 0;
    const captureOnly = {
      lstatPath: async () => {
        ioCalls += 1;
        return {} as never;
      },
      openDirectory: async () => {
        ioCalls += 1;
        return {} as never;
      },
      rootIsCurrent: async () => {
        ioCalls += 1;
        return true;
      },
    };
    expectFailure(
      await openInspectedResourceTreeSession(document, controller.signal, captureOnly),
      "io",
    );
    const validIo: ResourceTreeSessionIo = {
      ...captureOnly,
      openFile: async () => {
        ioCalls += 1;
        return {} as never;
      },
      capabilities: Object.freeze({ noFollow: false, nonBlock: false }),
    };
    expectFailure(
      await openInspectedResourceTreeSession(document, controller.signal, {
        ...validIo,
        capabilities: { noFollow: false } as never,
      }),
      "io",
    );
    expectFailure(
      await openInspectedResourceTreeSession(document, controller.signal, validIo),
      "aborted",
    );
    expect(ioCalls).toBe(0);

    const opened = await openInspectedResourceTreeSession(document);
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    const clone = structuredClone(opened.session);
    let sessionTraps = 0;
    const proxy = new Proxy(opened.session, {
      get() {
        sessionTraps += 1;
        throw new Error("session getter");
      },
    });
    const revoked = Proxy.revocable(opened.session, {});
    revoked.revoke();
    for (const value of [null, {}, clone, proxy, revoked.proxy, () => undefined]) {
      expect(isGenuineResourceTreeSession(value)).toBe(false);
      expectFailure(await resourceTreeSessionIsCurrent(value), "invalid_input");
    }
    expect(sessionTraps).toBe(0);
  });

  it("retains the second baseline and the single IO snapshot without updating either", async () => {
    const first = captureSuccess("first");
    const second = captureSuccess("second");
    const freshOne = captureSuccess("fresh-one");
    const freshTwo = captureSuccess("fresh-two");
    const state = mockState([first, second, freshOne, freshTwo]);
    const sessionModule = await mockedSession(state);
    const opened = await sessionModule.openInspectedResourceTreeSession(
      state.document,
      undefined,
      state.sourceIo,
    );
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    expect(opened.session.root).toBe(second.root);
    expect(opened.session.entries).toBe(second.entries);
    expect(state.captureReceivers).toEqual([undefined, undefined]);
    expect(state.comparisons).toEqual([[first, second]]);

    state.comparison = "different";
    expect(await sessionModule.resourceTreeSessionIsCurrent(opened.session)).toEqual({
      ok: true,
      current: false,
    });
    state.comparison = "equal";
    expect(await sessionModule.resourceTreeSessionIsCurrent(opened.session)).toEqual({
      ok: true,
      current: true,
    });
    expect(state.snapshotValues).toEqual([state.sourceIo]);
    expect(state.captureCalls.map((call) => call[0])).toEqual([
      state.document,
      state.document,
      state.document,
      state.document,
    ]);
    expect(state.captureCalls).toHaveLength(4);
    for (const call of state.captureCalls) expect(call[2]).toBe(state.retainedIo);
    expect(state.comparisons.slice(1)).toEqual([
      [second, freshOne],
      [second, freshTwo],
    ]);
    const finalController = new AbortController();
    state.queue.push(captureSuccess("final-abort"));
    state.comparisonEffect = () => finalController.abort();
    expectFailure(
      await sessionModule.resourceTreeSessionIsCurrent(opened.session, finalController.signal),
      "aborted",
    );
  });

  it("normalizes every capture failure plus malformed and comparator outcomes", async () => {
    const reasons: readonly ResourceTreeCaptureFailureReason[] = [
      "invalid_input",
      "aborted",
      "changed",
      "invalid_inventory",
      "invalid_metadata",
      "unsupported_kind",
      "too_many_entries",
      "too_deep",
      "paths_too_large",
      "inconsistent",
      "io",
    ];
    const state = mockState();
    const sessionModule = await mockedSession(state);
    for (const reason of reasons) {
      state.queue.push(failure(reason));
      const firstPass = await sessionModule.openInspectedResourceTreeSession(
        state.document,
        undefined,
        state.sourceIo,
      );
      expectFailure(firstPass, reason);
      const comparisons = state.comparisons.length;
      state.queue.push(captureSuccess(`A-${reason}`), failure(reason));
      const secondPass = await sessionModule.openInspectedResourceTreeSession(
        state.document,
        undefined,
        state.sourceIo,
      );
      expectFailure(secondPass, reason);
      expect(state.comparisons).toHaveLength(comparisons);
    }
    for (const malformed of [
      null,
      {},
      barrier({ ok: true as const }),
      () => Promise.reject(new Error("secret")),
    ]) {
      state.queue.push(malformed);
      expectFailure(
        await sessionModule.openInspectedResourceTreeSession(
          state.document,
          undefined,
          state.sourceIo,
        ),
        "inconsistent",
      );
    }

    for (const outcome of ["different", "invalid", "throw"] as const) {
      state.queue.push(captureSuccess(`A-${outcome}`), captureSuccess(`B-${outcome}`));
      state.comparison = outcome;
      expectFailure(
        await sessionModule.openInspectedResourceTreeSession(
          state.document,
          undefined,
          state.sourceIo,
        ),
        outcome === "different" ? "changed" : "inconsistent",
      );
    }

    state.comparison = "equal";
    const baseline = captureSuccess("baseline-A");
    const retained = captureSuccess("baseline-B");
    state.queue.push(baseline, retained);
    const opened = await sessionModule.openInspectedResourceTreeSession(
      state.document,
      undefined,
      state.sourceIo,
    );
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    for (const reason of reasons) {
      state.queue.push(failure(reason));
      expectFailure(await sessionModule.resourceTreeSessionIsCurrent(opened.session), reason);
    }
    const aborted = new AbortController();
    aborted.abort();
    expectFailure(
      await sessionModule.resourceTreeSessionIsCurrent(opened.session, aborted.signal),
      "aborted",
    );
    state.queue.push(captureSuccess("invalid-comparison"));
    state.comparison = "invalid";
    expectFailure(await sessionModule.resourceTreeSessionIsCurrent(opened.session), "inconsistent");
  });

  it("lets queued abort or invalidation after a deferred settlement override failure", async () => {
    for (const invalidation of ["abort", "prototype"] as const) {
      let settle: ((value: ResourceTreeSessionFailure) => void) | undefined;
      const deferred = new Promise<ResourceTreeSessionFailure>((resolve) => {
        settle = resolve;
      });
      const state = mockState([deferred]);
      const sessionModule = await mockedSession(state);
      const controller = new AbortController();
      const pending = sessionModule.openInspectedResourceTreeSession(
        state.document,
        controller.signal,
        state.sourceIo,
      );
      expect(state.captureCalls).toHaveLength(1);
      settle?.(failure("io"));
      queueMicrotask(() => {
        if (invalidation === "abort") controller.abort();
        else Object.setPrototypeOf(controller.signal, null);
      });
      expectFailure(await pending, invalidation === "abort" ? "aborted" : "invalid_input");
      expect(state.captureCalls).toHaveLength(1);
      expect(state.comparisons).toHaveLength(0);
    }

    let settleSecond: ((value: ResourceTreeSessionFailure) => void) | undefined;
    const secondDeferred = new Promise<ResourceTreeSessionFailure>((resolve) => {
      settleSecond = resolve;
    });
    const secondState = mockState([captureSuccess("first"), secondDeferred]);
    const secondModule = await mockedSession(secondState);
    const secondController = new AbortController();
    const secondPending = secondModule.openInspectedResourceTreeSession(
      secondState.document,
      secondController.signal,
      secondState.sourceIo,
    );
    await waitForCaptureCalls(secondState, 2);
    settleSecond?.(failure("io"));
    queueMicrotask(() => secondController.abort());
    expectFailure(await secondPending, "aborted");
    expect(secondState.comparisons).toHaveLength(0);

    for (const comparison of ["equal", "different"] as const) {
      const finalController = new AbortController();
      const finalState = mockState([captureSuccess("A"), captureSuccess("B")]);
      finalState.comparison = comparison;
      finalState.comparisonEffect = () => finalController.abort();
      const finalModule = await mockedSession(finalState);
      expectFailure(
        await finalModule.openInspectedResourceTreeSession(
          finalState.document,
          finalController.signal,
          finalState.sourceIo,
        ),
        "aborted",
      );
      expect(finalState.comparisons).toHaveLength(1);
    }

    const currentState = mockState([captureSuccess("A"), captureSuccess("B")]);
    const currentModule = await mockedSession(currentState);
    const opened = await currentModule.openInspectedResourceTreeSession(
      currentState.document,
      undefined,
      currentState.sourceIo,
    );
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    let settleFresh: ((value: ResourceTreeSessionFailure) => void) | undefined;
    const freshDeferred = new Promise<ResourceTreeSessionFailure>((resolve) => {
      settleFresh = resolve;
    });
    currentState.queue.push(freshDeferred);
    const invalidated = new AbortController();
    const currentPending = currentModule.resourceTreeSessionIsCurrent(
      opened.session,
      invalidated.signal,
    );
    await waitForCaptureCalls(currentState, 3);
    settleFresh?.(failure("io"));
    queueMicrotask(() => Object.setPrototypeOf(invalidated.signal, null));
    expectFailure(await currentPending, "invalid_input");
  });

  it("uses captured intrinsics and barriers, then remains outside the package root", async () => {
    const first = captureSuccess("barrier-A");
    const second = captureSuccess("barrier-B");
    const fresh = captureSuccess("barrier-fresh");
    const state = mockState([
      Promise.resolve(first),
      Promise.resolve(second),
      Promise.resolve(fresh),
    ]);
    const sessionModule = await mockedSession(state);
    const targets = [
      [Reflect, "apply"],
      [Object, "defineProperty"],
      [Object, "freeze"],
      [Object, "getOwnPropertyDescriptor"],
      [WeakMap.prototype, "get"],
      [WeakMap.prototype, "has"],
      [WeakMap.prototype, "set"],
      [types, "isProxy"],
    ] as const;
    const descriptors = targets.map(
      ([target, key]) => [target, key, Object.getOwnPropertyDescriptor(target, key)] as const,
    );
    const thenDescriptor = Object.getOwnPropertyDescriptor(Object.prototype, "then");
    let poisonCalls = 0;
    let inheritedThenCalls = 0;
    const poison = (): never => {
      poisonCalls += 1;
      throw new Error("live intrinsic used");
    };
    let opened:
      | Awaited<ReturnType<typeof sessionModule.openInspectedResourceTreeSession>>
      | undefined;
    let current: Awaited<ReturnType<typeof sessionModule.resourceTreeSessionIsCurrent>> | undefined;
    let genuineDuringPoison = false;
    try {
      for (const [target, key, descriptor] of descriptors) {
        if (descriptor === undefined) throw new Error(`missing ${key}`);
        Reflect.defineProperty(target, key, { ...descriptor, value: poison });
      }
      // biome-ignore lint/suspicious/noThenProperty: this regression targets inherited assimilation.
      Reflect.defineProperty(Object.prototype, "then", {
        configurable: true,
        get() {
          inheritedThenCalls += 1;
          return poison;
        },
      });
      opened = await sessionModule.openInspectedResourceTreeSession(
        state.document,
        undefined,
        state.sourceIo,
      );
      if (opened.ok) {
        genuineDuringPoison = sessionModule.isGenuineResourceTreeSession(opened.session);
        current = await sessionModule.resourceTreeSessionIsCurrent(opened.session);
      }
    } finally {
      for (const [target, key, descriptor] of descriptors) {
        if (descriptor !== undefined) Reflect.defineProperty(target, key, descriptor);
      }
      if (thenDescriptor === undefined) Reflect.deleteProperty(Object.prototype, "then");
      // biome-ignore lint/suspicious/noThenProperty: restore the pre-test descriptor exactly.
      else Reflect.defineProperty(Object.prototype, "then", thenDescriptor);
    }
    expect(current).toEqual({ ok: true, current: true });
    expect(genuineDuringPoison).toBe(true);
    expect(poisonCalls).toBe(0);
    expect(inheritedThenCalls).toBe(0);
    if (opened?.ok) {
      expectBarrier(opened);
      expectBarrier(opened.session);
      expect(sessionModule.isGenuineResourceTreeSession(opened.session)).toBe(true);
    }

    const beforeIo = snapshotResourceTreeSessionIo();
    if (beforeIo === undefined) throw new Error("expected default session IO");
    const objectConstructor = Object;
    const ioTargets = [
      [Reflect, "apply"],
      [Object, "freeze"],
      [Object, "getOwnPropertyDescriptor"],
      [fsPromisesModule, "open"],
    ] as const;
    const ioDescriptors = ioTargets.map(
      ([target, key]) => [target, key, Reflect.getOwnPropertyDescriptor(target, key)] as const,
    );
    let afterIo: ResourceTreeSessionIo | undefined;
    try {
      for (const [target, key, descriptor] of ioDescriptors) {
        if (descriptor === undefined) throw new Error(`missing ${key}`);
        Reflect.defineProperty(target, key, { ...descriptor, value: poison });
      }
      globalThis.Object = poison as unknown as ObjectConstructor;
      afterIo = snapshotResourceTreeSessionIo();
    } finally {
      globalThis.Object = objectConstructor;
      for (const [target, key, descriptor] of ioDescriptors) {
        if (descriptor !== undefined) Reflect.defineProperty(target, key, descriptor);
      }
    }
    expect(afterIo?.openFile).toBe(beforeIo.openFile);
    expect(afterIo?.capabilities).toEqual(beforeIo.capabilities);
    expect(poisonCalls).toBe(0);

    const rootSource = await readFile(new URL("../src/index.ts", import.meta.url), "utf8");
    for (const name of [
      "ResourceTreeSession",
      "ResourceTreeSessionFailureReason",
      "ResourceTreeSessionIo",
      "snapshotResourceTreeSessionIo",
      "openInspectedResourceTreeSession",
      "isGenuineResourceTreeSession",
      "resourceTreeSessionIsCurrent",
    ]) {
      expect(rootSource).not.toContain(name);
    }
    const packageJson = JSON.parse(
      await readFile(new URL("../package.json", import.meta.url), "utf8"),
    ) as { exports: Record<string, unknown> };
    expect(Object.keys(packageJson.exports)).toEqual(["."]);
  });
});
