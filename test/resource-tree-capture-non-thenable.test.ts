import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  ResourceTreeCaptureIo,
  ResourceTreeCaptureResult,
} from "../src/validate/resource-tree-capture.js";

const modulePaths = [
  "../src/validate/abort-signal.js",
  "../src/validate/directory-name-index.js",
  "../src/validate/directory-read.js",
  "../src/validate/file-metadata.js",
  "../src/validate/resource-tree-layout.js",
  "../src/validate/resource-tree-lstat.js",
  "../src/validate/skill-document.js",
  "../src/validate/skill-root.js",
] as const;

const THEN_DESCRIPTOR = {
  configurable: false,
  enumerable: false,
  value: undefined,
  writable: false,
};
const thenProperty: PropertyKey = "then";

afterEach(() => {
  for (const path of modulePaths) vi.doUnmock(path);
  vi.resetModules();
});

function expectBarrier(value: unknown, enumerableKeys: string[]): asserts value is object {
  expect(typeof value).toBe("object");
  expect(value).not.toBeNull();
  if (typeof value !== "object" || value === null) return;
  expect(Object.getOwnPropertyDescriptor(value, "then")).toEqual(THEN_DESCRIPTOR);
  expect(Object.keys(value)).toEqual(enumerableKeys);
  expect(Reflect.ownKeys(value)).toEqual([...enumerableKeys, "then"]);
  expect(Object.getPrototypeOf(value)).toBe(Object.prototype);
  expect(Object.isFrozen(value)).toBe(true);
  expect(
    JSON.stringify(value, (_key, nested) =>
      typeof nested === "bigint" ? nested.toString() : nested,
    ),
  ).not.toContain('"then"');
}

describe("resource-tree capture non-thenable barriers", () => {
  it("barriers every fixed failure and every successful C-local async boundary", async () => {
    const directoryMetadata = Object.freeze({
      dev: 1n,
      ino: 1n,
      mode: 0o40700n,
      size: 0n,
      mtimeNs: 1n,
      ctimeNs: 1n,
      kind: "directory" as const,
    });
    const fileMetadata = Object.freeze({
      ...directoryMetadata,
      ino: 2n,
      mode: 0o100600n,
      size: 1n,
      kind: "file" as const,
    });
    const symbolicLinkMetadata = Object.freeze({
      ...fileMetadata,
      ino: 3n,
      mode: 0o120700n,
      kind: "symbolic-link" as const,
    });
    const root = Object.freeze({ path: "/root", metadata: directoryMetadata });
    const document = Object.freeze({ root, path: "/root/SKILL.md", metadata: fileMetadata });
    const skillNames = Object.freeze({
      entries: Object.freeze([{ exact: "SKILL.md" }]),
    });
    const unsupportedNames = Object.freeze({
      entries: Object.freeze([{ exact: "SKILL.md" }, { exact: "unsupported" }]),
    });
    const profile = (exact: string) => ({
      ok: true as const,
      exact,
      exactByteLength: exact.length,
      nfc: exact,
      key: exact.toLowerCase(),
      isNfc: true,
    });
    const layoutRoot = Object.freeze({
      entryIndex: null,
      parentIndex: null,
      depth: 0,
      exactName: "",
      exactNameByteLength: 0,
      relativePath: "",
      relativePathByteLength: 0,
    });
    const state = {
      documentBrand: true,
      reader: "success",
      reservation: "success",
      lstat: "success",
    };
    const resetState = () => {
      state.documentBrand = true;
      state.reader = "success";
      state.reservation = "success";
      state.lstat = "success";
    };

    // These promises resolve before Object.prototype is polluted. Their raw values intentionally
    // have no own `then`, so the C-local wrappers must copy and barrier them before async return.
    const readerResults = {
      success: Promise.resolve({
        ok: true as const,
        directory: { metadata: directoryMetadata },
        names: skillNames,
      }),
      unsupported: Promise.resolve({
        ok: true as const,
        directory: { metadata: directoryMetadata },
        names: unsupportedNames,
      }),
      changed: Promise.resolve({ ok: false as const, reason: "changed" }),
      "invalid-read": Promise.resolve({ ok: false as const, reason: "invalid-read" }),
      "invalid-metadata": Promise.resolve({ ok: false as const, reason: "invalid-metadata" }),
      "too-many-entries": Promise.resolve({ ok: false as const, reason: "too-many-entries" }),
      "invalid-inspection": Promise.resolve({ ok: false as const, reason: "invalid-inspection" }),
      io: Promise.resolve({ ok: false as const, reason: "io" }),
    };
    const lstatResults = {
      directory: Promise.resolve({ ok: true as const, metadata: directoryMetadata }),
      file: Promise.resolve({ ok: true as const, metadata: fileMetadata }),
      symbolicLink: Promise.resolve({ ok: true as const, metadata: symbolicLinkMetadata }),
      aborted: Promise.resolve({ ok: false as const, reason: "aborted" }),
    };
    const rootCurrent = Promise.resolve(true);
    const actual = async (path: (typeof modulePaths)[number]) =>
      vi.importActual<Record<string, unknown>>(path);
    vi.doMock(modulePaths[0], async () => ({
      ...(await actual(modulePaths[0])),
      sampleAbortSignal: () => "absent",
    }));
    vi.doMock(modulePaths[1], async () => ({
      ...(await actual(modulePaths[1])),
      reprofileDirectoryNameIndexEntry: (names: typeof skillNames, ordinal: number) => ({
        ok: true,
        profile: profile(names.entries[ordinal]?.exact ?? ""),
      }),
    }));
    vi.doMock(modulePaths[2], async () => ({
      ...(await actual(modulePaths[2])),
      readInspectedDirectoryNames: () => readerResults[state.reader as keyof typeof readerResults],
    }));
    vi.doMock(modulePaths[3], async () => ({
      ...(await actual(modulePaths[3])),
      sameFileSnapshot: () => true,
    }));
    vi.doMock(modulePaths[4], async () => ({
      ...(await actual(modulePaths[4])),
      createResourceTreeLayout: () => ({ root: layoutRoot, budget: {} }),
      reserveResourceTreeChild: (
        _budget: unknown,
        _parent: unknown,
        current: { exact: string },
      ) => {
        if (state.reservation !== "success") {
          return { ok: false, reason: state.reservation };
        }
        const entryIndex = current.exact === "SKILL.md" ? 0 : 1;
        return {
          ok: true,
          budget: {},
          entry: {
            entryIndex,
            parentIndex: null,
            depth: 1,
            exactName: current.exact,
            exactNameByteLength: current.exact.length,
            relativePath: current.exact,
            relativePathByteLength: current.exact.length,
          },
        };
      },
    }));
    vi.doMock(modulePaths[5], async () => ({
      ...(await actual(modulePaths[5])),
      lstatResourceTreePath: (path: string) => {
        if (state.lstat === "aborted") return lstatResults.aborted;
        if (path === root.path) return lstatResults.directory;
        if (path.endsWith("unsupported")) return lstatResults.symbolicLink;
        return lstatResults.file;
      },
    }));
    vi.doMock(modulePaths[6], async () => ({
      ...(await actual(modulePaths[6])),
      isGenuineDocumentInspection: () => state.documentBrand,
    }));
    vi.doMock(modulePaths[7], async () => ({
      ...(await actual(modulePaths[7])),
      isGenuineRootInspection: () => true,
      rootInspectionIsCurrent: () => rootCurrent,
    }));
    vi.resetModules();
    const capture = await import("../src/validate/resource-tree-capture.js");
    const io = {
      lstatPath: () => lstatResults.file as never,
      openDirectory: () => readerResults.success as never,
      rootIsCurrent: () => rootCurrent,
    } as ResourceTreeCaptureIo;

    const failureCases = [
      ["invalid_input", () => (state.documentBrand = false)],
      ["aborted", () => (state.lstat = "aborted")],
      ["changed", () => (state.reader = "changed")],
      ["invalid_inventory", () => (state.reader = "invalid-read")],
      ["invalid_metadata", () => (state.reader = "invalid-metadata")],
      ["unsupported_kind", () => (state.reader = "unsupported")],
      ["too_many_entries", () => (state.reader = "too-many-entries")],
      ["too_deep", () => (state.reservation = "too_deep")],
      ["paths_too_large", () => (state.reservation = "paths_too_large")],
      ["inconsistent", () => (state.reader = "invalid-inspection")],
      ["io", () => (state.reader = "io")],
    ] as const;
    const definePropertyDescriptor = Reflect.getOwnPropertyDescriptor(Object, "defineProperty");
    const freezeDescriptor = Reflect.getOwnPropertyDescriptor(Object, "freeze");
    const inheritedThenDescriptor = Reflect.getOwnPropertyDescriptor(Object.prototype, "then");
    if (definePropertyDescriptor === undefined || freezeDescriptor === undefined) {
      throw new Error("required intrinsic descriptor is missing");
    }
    let thenGetterCalls = 0;
    let thenCalls = 0;
    let poisonCalls = 0;
    const unbarrieredShapes: string[][] = [];
    const poison = (): never => {
      poisonCalls += 1;
      throw new Error("live intrinsic used");
    };
    const failures: Array<{ expected: string; result: unknown }> = [];
    let success: unknown;
    try {
      Reflect.defineProperty(Object, "defineProperty", {
        ...definePropertyDescriptor,
        value: poison,
      });
      Reflect.defineProperty(Object, "freeze", { ...freezeDescriptor, value: poison });
      Reflect.defineProperty(Object.prototype, thenProperty, {
        configurable: true,
        get() {
          thenGetterCalls += 1;
          unbarrieredShapes.push(
            typeof this === "object" && this !== null ? Object.keys(this) : [],
          );
          return (resolve: (value: unknown) => void) => {
            thenCalls += 1;
            resolve("prototype thenable controlled the result");
          };
        },
      });
      for (const [expected, configure] of failureCases) {
        resetState();
        configure();
        failures.push({
          expected,
          result: await capture.captureInspectedResourceTree(document, undefined, io),
        });
      }
      resetState();
      success = await capture.captureInspectedResourceTree(document, undefined, io);
    } finally {
      Reflect.defineProperty(Object, "defineProperty", definePropertyDescriptor);
      Reflect.defineProperty(Object, "freeze", freezeDescriptor);
      if (inheritedThenDescriptor === undefined) {
        Reflect.deleteProperty(Object.prototype, thenProperty);
      } else {
        Reflect.defineProperty(Object.prototype, thenProperty, inheritedThenDescriptor);
      }
    }

    expect(thenGetterCalls).toBe(0);
    expect(thenCalls).toBe(0);
    expect(unbarrieredShapes).toEqual([]);
    expect(poisonCalls).toBe(0);
    for (const { expected, result } of failures) {
      expect(result).toEqual({ ok: false, reason: expected });
      expectBarrier(result, ["ok", "reason"]);
    }
    expect(success).toMatchObject({ ok: true });
    expectBarrier(success, ["ok", "root", "entries"]);
    const tree = success as Extract<ResourceTreeCaptureResult, Readonly<{ ok: true }>>;
    expect(tree.entries).toHaveLength(1);
    expect(tree.entries[0]?.role).toBe("document");
    for (const nested of [tree.root, tree.entries, tree.entries[0], document, root, io]) {
      expect(Object.getOwnPropertyDescriptor(nested ?? {}, "then")).toBeUndefined();
    }
    type ResultHasThen = "then" extends keyof ResourceTreeCaptureResult ? true : false;
    const resultHasThen: ResultHasThen = false;
    expect(resultHasThen).toBe(false);
  });
});
