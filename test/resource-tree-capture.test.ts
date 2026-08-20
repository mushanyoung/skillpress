import { Buffer } from "node:buffer";
import { constants, type BigIntStats } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { DiagnosticCollector } from "../src/validate/diagnostics.js";
import type { FileMetadataSnapshot } from "../src/validate/file-metadata.js";
import {
  captureInspectedResourceTree,
  type ResourceTreeCaptureIo,
  type ResourceTreeCaptureResult,
} from "../src/validate/resource-tree-capture.js";
import { inspectAgentSkillDocument } from "../src/validate/skill-document.js";
import type { DocumentInspection } from "../src/validate/skill-document-read.js";
import { inspectAgentSkillRoot } from "../src/validate/skill-root.js";
import { createSkillFixtures, skillDocument } from "./helpers/skill-fixtures.js";

const fixtures = createSkillFixtures();
const repositoryRoot = new URL("../", import.meta.url);
afterEach(() => fixtures.cleanup());

async function genuineDocument(name: string): Promise<DocumentInspection> {
  const fixture = await fixtures.skill(
    name,
    skillDocument(`name: ${name}\ndescription: Capture fixture.\nlicense: MIT`),
  );
  const diagnostics = new DiagnosticCollector();
  const root = await inspectAgentSkillRoot(fixture.directory, diagnostics);
  expect(root).toBeDefined();
  if (root === undefined) throw new Error("expected genuine root");
  const document = await inspectAgentSkillDocument(root, diagnostics);
  expect(document).toBeDefined();
  if (document === undefined) throw new Error("expected genuine document");
  return document;
}

function rawStats(kind: FileMetadataSnapshot["kind"], ino: bigint): BigIntStats {
  const mode = {
    directory: BigInt(constants.S_IFDIR) | 0o700n,
    file: BigInt(constants.S_IFREG) | 0o600n,
    other: BigInt(constants.S_IFIFO) | 0o600n,
    "symbolic-link": BigInt(constants.S_IFLNK) | 0o700n,
  }[kind];
  return {
    dev: 10n,
    ino,
    mode,
    size: kind === "file" ? 7n : 0n,
    mtimeNs: 20n,
    ctimeNs: 30n,
  } as BigIntStats;
}

interface VirtualOptions {
  readonly lstat?: (path: string, call: number, fallback: unknown) => unknown;
  readonly open?: (path: string, call: number) => "throw" | undefined;
  readonly rootCurrent?: (call: number) => boolean | Promise<boolean>;
}

function virtualIo(
  document: DocumentInspection,
  inventories: ReadonlyMap<string, readonly unknown[]>,
  additionalStats: ReadonlyMap<string, unknown> = new Map(),
  options: VirtualOptions = {},
): {
  readonly io: ResourceTreeCaptureIo;
  readonly events: string[];
  readonly lstatCalls: Map<string, number>;
  readonly rootCalls: () => number;
} {
  const events: string[] = [];
  const lstatCalls = new Map<string, number>();
  const openCalls = new Map<string, number>();
  let rootCalls = 0;
  const fallbackStats = new Map<string, unknown>([
    [document.root.path, document.root.metadata],
    [document.path, document.metadata],
  ]);
  for (const [path, value] of additionalStats) fallbackStats.set(path, value);

  return {
    events,
    lstatCalls,
    rootCalls: () => rootCalls,
    io: {
      async lstatPath(path) {
        const call = (lstatCalls.get(path) ?? 0) + 1;
        lstatCalls.set(path, call);
        events.push(`lstat:${path}`);
        const fallback = fallbackStats.get(path);
        const observed = options.lstat?.(path, call, fallback) ?? fallback;
        if (observed === undefined) throw new Error(`missing lstat fixture: ${path}`);
        return observed as BigIntStats;
      },
      async openDirectory(path, openOptions) {
        const call = (openCalls.get(path) ?? 0) + 1;
        openCalls.set(path, call);
        events.push(`open:${path}`);
        expect(openOptions).toEqual({ encoding: "buffer", bufferSize: 1, recursive: false });
        if (options.open?.(path, call) === "throw") throw new Error("open failed");
        const names = inventories.get(path);
        if (names === undefined) throw new Error(`missing inventory fixture: ${path}`);
        let ordinal = 0;
        return {
          async read() {
            const name = names[ordinal];
            ordinal += 1;
            if (name === undefined) return null;
            return { name: typeof name === "string" ? Buffer.from(name, "utf8") : name };
          },
          async close() {
            events.push(`close:${path}`);
          },
        };
      },
      async rootIsCurrent() {
        rootCalls += 1;
        events.push("current");
        return (await options.rootCurrent?.(rootCalls)) ?? true;
      },
    },
  };
}

function expectFailure(result: ResourceTreeCaptureResult, reason: string): void {
  expect(result).toEqual({ ok: false, reason });
  expect(Object.keys(result).sort()).toEqual(["ok", "reason"]);
  expect(Object.isFrozen(result)).toBe(true);
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

describe("single-pass resource-tree capture", () => {
  it("captures a deep-frozen exact-name DFS with root-first inventories and full roles", async () => {
    const document = await genuineDocument("capture-happy");
    const native = await captureInspectedResourceTree(document);
    expect(native.ok).toBe(true);
    const root = document.root.path;
    const directory = join(root, "dir");
    const subdirectory = join(directory, "sub");
    const stats = new Map<string, unknown>([
      [join(root, "z.txt"), rawStats("file", 101n)],
      [directory, rawStats("directory", 102n)],
      [join(directory, "SKILL.md"), rawStats("file", 103n)],
      [join(directory, "nested.txt"), rawStats("file", 104n)],
      [subdirectory, rawStats("directory", 105n)],
    ]);
    const inventories = new Map<string, readonly unknown[]>([
      [root, ["z.txt", "dir", "SKILL.md"]],
      [directory, ["sub", "nested.txt", "SKILL.md"]],
      [subdirectory, []],
    ]);
    const environment = virtualIo(document, inventories, stats);

    const result = await captureInspectedResourceTree(document, undefined, environment.io);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.entries.map((entry) => entry.layout.relativePath)).toEqual([
      "SKILL.md",
      "dir",
      "dir/SKILL.md",
      "dir/nested.txt",
      "dir/sub",
      "z.txt",
    ]);
    expect(result.entries.map((entry) => entry.role)).toEqual([
      "document",
      "directory",
      "resource-file",
      "resource-file",
      "directory",
      "resource-file",
    ]);
    expect(result.entries.map((entry) => entry.layout.entryIndex)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(result.entries.map((entry) => entry.layout.parentIndex)).toEqual([
      null,
      null,
      1,
      1,
      1,
      null,
    ]);
    expect(result.root.layout.entryIndex).toBeNull();
    expect(result.root.names.entries.map((entry) => entry.exact)).toEqual([
      "SKILL.md",
      "dir",
      "z.txt",
    ]);
    expect(result.root.metadata).toEqual(document.root.metadata);
    expect(result.root.metadata).not.toBe(document.root.metadata);
    const nestedDirectory = result.entries[1];
    expect(nestedDirectory?.role).toBe("directory");
    if (nestedDirectory?.role === "directory") {
      expect(nestedDirectory.names.entries.map((entry) => entry.exact)).toEqual([
        "SKILL.md",
        "nested.txt",
        "sub",
      ]);
    }
    expect(environment.events.slice(0, 6)).toEqual([
      "current",
      `lstat:${root}`,
      `open:${root}`,
      `close:${root}`,
      `lstat:${root}`,
      "current",
    ]);
    expect(environment.rootCalls()).toBe(7);
    expectDeepFrozen(result);
    expect(
      JSON.stringify(result, (_key, value) => (typeof value === "bigint" ? String(value) : value)),
    ).not.toContain(root);
    expect(result).not.toHaveProperty("budget");
    expect(result).not.toHaveProperty("inspection");
  });

  it("authenticates input and enforces signal then IO then pre-abort priority", async () => {
    const document = await genuineDocument("capture-input");
    let documentTraps = 0;
    const proxy = new Proxy(document, {
      get() {
        documentTraps += 1;
        throw new Error("document trap");
      },
    });
    expectFailure(await captureInspectedResourceTree(proxy), "invalid_input");
    expectFailure(await captureInspectedResourceTree({ ...document }), "invalid_input");
    expect(documentTraps).toBe(0);

    let getterCalls = 0;
    const accessorIo = {
      get lstatPath() {
        getterCalls += 1;
        throw new Error("getter");
      },
      openDirectory: async () => {
        throw new Error("unused");
      },
      rootIsCurrent: async () => true,
    } as unknown as ResourceTreeCaptureIo;
    expectFailure(await captureInspectedResourceTree(document, {}, accessorIo), "invalid_input");
    expect(getterCalls).toBe(0);

    const aborted = new AbortController();
    aborted.abort();
    expectFailure(await captureInspectedResourceTree(document, aborted.signal, accessorIo), "io");
    expect(getterCalls).toBe(0);

    let ioCalls = 0;
    const validTarget: ResourceTreeCaptureIo = {
      lstatPath: async () => {
        ioCalls += 1;
        return document.root.metadata as unknown as BigIntStats;
      },
      openDirectory: async () => {
        ioCalls += 1;
        throw new Error("unused");
      },
      rootIsCurrent: async () => {
        ioCalls += 1;
        return true;
      },
    };
    expectFailure(
      await captureInspectedResourceTree(document, aborted.signal, validTarget),
      "aborted",
    );
    expect(ioCalls).toBe(0);

    const duringIo = new AbortController();
    const descriptors: PropertyKey[] = [];
    const ioProxy = new Proxy(validTarget, {
      getOwnPropertyDescriptor(target, property) {
        descriptors.push(property);
        if (property === "rootIsCurrent") duringIo.abort();
        return Reflect.getOwnPropertyDescriptor(target, property);
      },
    });
    expectFailure(
      await captureInspectedResourceTree(document, duringIo.signal, ioProxy),
      "aborted",
    );
    expect(descriptors).toEqual(["lstatPath", "openDirectory", "rootIsCurrent"]);
    expect(ioCalls).toBe(0);
  });

  it("maps root inventory failures and rejects replacements before following them", async () => {
    const document = await genuineDocument("capture-failures");
    const root = document.root.path;
    const ordinary = join(root, "ordinary");

    const missing = virtualIo(
      document,
      new Map([[root, ["ordinary"]]]),
      new Map([[ordinary, rawStats("file", 201n)]]),
    );
    expectFailure(await captureInspectedResourceTree(document, undefined, missing.io), "changed");
    expect(missing.lstatCalls.has(ordinary)).toBe(false);

    const invalidName = virtualIo(document, new Map([[root, [Buffer.from([0xff])]]]));
    expectFailure(
      await captureInspectedResourceTree(document, undefined, invalidName.io),
      "invalid_inventory",
    );

    const manyNames = Array.from({ length: 1_025 }, (_, index) => `entry-${index}`);
    const tooMany = virtualIo(document, new Map([[root, manyNames]]));
    expectFailure(
      await captureInspectedResourceTree(document, undefined, tooMany.io),
      "too_many_entries",
    );

    const openFailure = virtualIo(document, new Map([[root, ["SKILL.md"]]]), new Map(), {
      open: () => "throw",
    });
    expectFailure(await captureInspectedResourceTree(document, undefined, openFailure.io), "io");

    const invalidMetadata = virtualIo(document, new Map([[root, ["SKILL.md"]]]), new Map(), {
      lstat: (path) => (path === root ? {} : undefined),
    });
    expectFailure(
      await captureInspectedResourceTree(document, undefined, invalidMetadata.io),
      "invalid_metadata",
    );

    for (const kind of ["symbolic-link", "other"] as const) {
      const unsupported = virtualIo(
        document,
        new Map([[root, ["ordinary", "SKILL.md"]]]),
        new Map([[ordinary, rawStats(kind, 202n)]]),
      );
      expectFailure(
        await captureInspectedResourceTree(document, undefined, unsupported.io),
        "unsupported_kind",
      );
    }

    const replacedDocument = virtualIo(
      document,
      new Map([[root, ["SKILL.md"]]]),
      new Map([[document.path, rawStats("symbolic-link", 203n)]]),
    );
    expectFailure(
      await captureInspectedResourceTree(document, undefined, replacedDocument.io),
      "changed",
    );
  });

  it("checks every directory, the final document, and strict final root freshness", async () => {
    const document = await genuineDocument("capture-postchecks");
    const root = document.root.path;
    const directory = join(root, "dir");
    const directoryStats = rawStats("directory", 301n);
    const inventories = new Map<string, readonly unknown[]>([
      [root, ["SKILL.md", "dir"]],
      [directory, []],
    ]);
    const values = new Map<string, unknown>([[directory, directoryStats]]);

    const changedDirectory = virtualIo(document, inventories, values, {
      lstat: (path, call, fallback) =>
        path === directory && call === 4
          ? { ...directoryStats, mtimeNs: directoryStats.mtimeNs + 1n }
          : fallback,
    });
    expectFailure(
      await captureInspectedResourceTree(document, undefined, changedDirectory.io),
      "changed",
    );

    const changedDocument = virtualIo(document, inventories, values, {
      lstat: (path, call, fallback) =>
        path === document.path && call === 2
          ? { ...document.metadata, size: document.metadata.size + 1n }
          : fallback,
    });
    expectFailure(
      await captureInspectedResourceTree(document, undefined, changedDocument.io),
      "changed",
    );

    const staleRoot = virtualIo(document, inventories, values, {
      rootCurrent: (call) => call !== 5,
    });
    expectFailure(await captureInspectedResourceTree(document, undefined, staleRoot.io), "changed");

    const controller = new AbortController();
    const abortedFinal = virtualIo(document, inventories, values, {
      rootCurrent: (call) => {
        if (call === 5) controller.abort("unobserved");
        return call !== 5;
      },
    });
    expectFailure(
      await captureInspectedResourceTree(document, controller.signal, abortedFinal.io),
      "aborted",
    );
  });

  it("opens depth 64 directories even when empty and rejects only a valid depth 65 child", async () => {
    const document = await genuineDocument("capture-depth");
    const inventories = new Map<string, readonly unknown[]>();
    const values = new Map<string, unknown>();
    let path = document.root.path;
    inventories.set(path, ["SKILL.md", "d01"]);
    for (let depth = 1; depth <= 64; depth += 1) {
      path = join(path, `d${String(depth).padStart(2, "0")}`);
      values.set(path, rawStats("directory", 400n + BigInt(depth)));
      inventories.set(path, depth === 64 ? [] : [`d${String(depth + 1).padStart(2, "0")}`]);
    }
    const success = virtualIo(document, inventories, values);
    const result = await captureInspectedResourceTree(document, undefined, success.io);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.entries.at(-1)?.layout.depth).toBe(64);
      expect(result.entries).toHaveLength(65);
    }
    expect(success.events).toContain(`open:${path}`);

    inventories.set(path, ["too-deep.txt"]);
    const tooDeepChild = join(path, "too-deep.txt");
    values.set(tooDeepChild, rawStats("file", 500n));
    const failure = virtualIo(document, inventories, values);
    expectFailure(await captureInspectedResourceTree(document, undefined, failure.io), "too_deep");
    expect(failure.events).toContain(`open:${path}`);
    expect(failure.lstatCalls.has(tooDeepChild)).toBe(false);
  });

  it("uses captured intrinsics and remains behind the package export boundary", async () => {
    const document = await genuineDocument("capture-pollution");
    const environment = virtualIo(document, new Map([[document.root.path, ["SKILL.md"]]]));
    const descriptors = [
      [Reflect, "apply", Object.getOwnPropertyDescriptor(Reflect, "apply")],
      [Object, "freeze", Object.getOwnPropertyDescriptor(Object, "freeze")],
      [Object, "defineProperty", Object.getOwnPropertyDescriptor(Object, "defineProperty")],
      [
        Object,
        "getOwnPropertyDescriptor",
        Object.getOwnPropertyDescriptor(Object, "getOwnPropertyDescriptor"),
      ],
    ] as const;
    let poisonCalls = 0;
    const poison = (): never => {
      poisonCalls += 1;
      throw new Error("live intrinsic used");
    };
    let result: ResourceTreeCaptureResult | undefined;
    try {
      for (const [target, property, descriptor] of descriptors) {
        if (descriptor === undefined) throw new Error(`missing ${property}`);
        Reflect.defineProperty(target, property, { ...descriptor, value: poison });
      }
      result = await captureInspectedResourceTree(document, undefined, environment.io);
    } finally {
      for (const [target, property, descriptor] of descriptors) {
        if (descriptor !== undefined) Reflect.defineProperty(target, property, descriptor);
      }
    }
    expect(result?.ok).toBe(true);
    expect(poisonCalls).toBe(0);

    const source = await readFile(
      new URL("src/validate/resource-tree-capture.ts", repositoryRoot),
      "utf8",
    );
    for (const forbidden of [
      ".push(",
      "for (const",
      "Promise.race",
      "addEventListener",
      "throwIfAborted",
      "setTimeout",
    ]) {
      expect(source).not.toContain(forbidden);
    }
    const rootSource = await readFile(new URL("src/index.ts", repositoryRoot), "utf8");
    expect(rootSource).not.toContain("captureInspectedResourceTree");
    expect(rootSource).not.toContain("ResourceTreeCaptureResult");
    expect(rootSource).not.toContain("ResourceTreeCaptureIo");
  });
});
