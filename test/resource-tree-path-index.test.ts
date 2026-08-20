import { readFile } from "node:fs/promises";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import { types } from "node:util";

import { afterEach, describe, expect, it, vi } from "vitest";

import { DiagnosticCollector } from "../src/validate/diagnostics.js";
import { classifyMarkdownDestination } from "../src/validate/markdown-destination.js";
import {
  createResourceTreePathIndex,
  resolveResourceTreePath,
} from "../src/validate/resource-tree-path-index.js";
import {
  openInspectedResourceTreeSession,
  type ResourceTreeSession,
} from "../src/validate/resource-tree-session.js";
import { inspectAgentSkillDocument } from "../src/validate/skill-document.js";
import { inspectAgentSkillRoot } from "../src/validate/skill-root.js";
import { createSkillFixtures, skillDocument } from "./helpers/skill-fixtures.js";

const fixtures = createSkillFixtures();
const repositoryRoot = new URL("../", import.meta.url);
const sessionModulePath = "../src/validate/resource-tree-session.js";
const directoryIndexModulePath = "../src/validate/directory-name-index.js";
const layoutModulePath = "../src/validate/resource-tree-layout.js";
const markdownModulePath = "../src/validate/markdown-destination.js";
const profileModulePath = "../src/validate/resource-name-profile.js";
const pathIndexModulePath = "../src/validate/resource-tree-path-index.js";

afterEach(async () => {
  await fixtures.cleanup();
  for (const path of [
    sessionModulePath,
    directoryIndexModulePath,
    markdownModulePath,
    profileModulePath,
  ]) {
    vi.doUnmock(path);
  }
  vi.resetModules();
});

function expectDeepFrozen(value: unknown, seen = new WeakSet<object>()): void {
  if ((typeof value !== "object" && typeof value !== "function") || value === null) return;
  if (seen.has(value)) return;
  seen.add(value);
  expect(Object.isFrozen(value)).toBe(true);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor !== undefined && "value" in descriptor) {
      expectDeepFrozen(descriptor.value, seen);
    }
  }
}

async function genuineSession(name: string): Promise<ResourceTreeSession> {
  const fixture = await fixtures.skill(
    name,
    skillDocument(`name: ${name}\ndescription: Path index fixture.\nlicense: MIT`),
  );
  await mkdir(join(fixture.directory, "docs", "nested"), { recursive: true });
  await writeFile(join(fixture.directory, "README.txt"), "root resource", { mode: 0o600 });
  await writeFile(join(fixture.directory, "docs", "guide.md"), "guide", { mode: 0o600 });
  await writeFile(join(fixture.directory, "docs", "nested", "leaf.txt"), "leaf", {
    mode: 0o600,
  });
  const diagnostics = new DiagnosticCollector();
  const root = await inspectAgentSkillRoot(fixture.directory, diagnostics);
  if (root === undefined) throw new Error("expected genuine root");
  const document = await inspectAgentSkillDocument(root, diagnostics);
  if (document === undefined) throw new Error("expected genuine document");
  const opened = await openInspectedResourceTreeSession(document);
  if (!opened.ok) throw new Error(`expected session: ${opened.reason}`);
  return opened.session;
}

function entryIndex(session: ResourceTreeSession, relativePath: string): number {
  const entry = session.entries.find((candidate) => candidate.layout.relativePath === relativePath);
  if (entry === undefined) throw new Error(`missing fixture entry ${relativePath}`);
  return entry.layout.entryIndex;
}

type TreeSpec = Readonly<Record<string, "file" | TreeSpec>>;
type StructuralSession = Readonly<{ root: object; entries: readonly object[] }>;
type LookupControl = { active: boolean; throws: boolean; value: unknown };
type ProfileControl = LookupControl & { genuine: boolean };

async function isolatedStructuralSession(spec: TreeSpec): Promise<{
  session: StructuralSession;
  accepted: WeakSet<object>;
  component: LookupControl;
  lookup: LookupControl;
  profile: ProfileControl;
  module: typeof import("../src/validate/resource-tree-path-index.js");
}> {
  vi.resetModules();
  const accepted = new WeakSet<object>();
  const component: LookupControl = { active: false, throws: false, value: true };
  const lookup: LookupControl = { active: false, throws: false, value: undefined };
  const profile: ProfileControl = {
    active: false,
    throws: false,
    value: undefined,
    genuine: false,
  };
  vi.doMock(sessionModulePath, () => ({
    isGenuineResourceTreeSession(value: unknown) {
      return typeof value === "object" && value !== null && accepted.has(value);
    },
  }));
  vi.doMock(directoryIndexModulePath, async (importOriginal) => {
    const actual = await importOriginal<typeof import("../src/validate/directory-name-index.js")>();
    return {
      ...actual,
      lookupDirectoryName(...argumentsList: Parameters<typeof actual.lookupDirectoryName>) {
        if (!lookup.active) return actual.lookupDirectoryName(...argumentsList);
        if (lookup.throws) throw new Error("isolated lookup failure");
        return lookup.value;
      },
    };
  });
  vi.doMock(markdownModulePath, async (importOriginal) => {
    const actual = await importOriginal<typeof import("../src/validate/markdown-destination.js")>();
    return {
      ...actual,
      isCanonicalDecodedMarkdownLocalComponent(value: unknown) {
        if (!component.active) return actual.isCanonicalDecodedMarkdownLocalComponent(value);
        if (component.throws) throw new Error("isolated component predicate failure");
        return component.value as boolean;
      },
    };
  });
  vi.doMock(profileModulePath, async (importOriginal) => {
    const actual =
      await importOriginal<typeof import("../src/validate/resource-name-profile.js")>();
    return {
      ...actual,
      profileObservedResourceName(value: unknown) {
        if (!profile.active) return actual.profileObservedResourceName(value);
        if (profile.throws) throw new Error("isolated profile failure");
        return profile.value as ReturnType<typeof actual.profileObservedResourceName>;
      },
      isResourceNameProfileResult(value: unknown) {
        if (profile.active && profile.genuine && value === profile.value) return true;
        return actual.isResourceNameProfileResult(value);
      },
    };
  });
  const directoryModule = await import(directoryIndexModulePath);
  const profileModule = await import(profileModulePath);
  const layoutModule = await import(layoutModulePath);
  const start = layoutModule.createResourceTreeLayout();
  const entries: object[] = [];
  let budget = start.budget;

  function directory(
    node: TreeSpec,
    parent: Parameters<typeof layoutModule.reserveResourceTreeChild>[1],
  ) {
    const profiles = Object.keys(node).map((exact) =>
      profileModule.profileObservedResourceName(exact),
    );
    const names = directoryModule.indexDirectoryNames(profiles);
    if (!names.ok) throw new Error(`invalid structural names: ${names.reason}`);
    for (let ordinal = 0; ordinal < names.entries.length; ordinal += 1) {
      const profiled = directoryModule.reprofileDirectoryNameIndexEntry(names, ordinal);
      if (!profiled.ok) throw new Error("expected structural reprofile");
      const reserved = layoutModule.reserveResourceTreeChild(budget, parent, profiled.profile);
      if (!reserved.ok) throw new Error(`invalid structural layout: ${reserved.reason}`);
      budget = reserved.budget;
      const child = node[profiled.profile.exact];
      if (child === undefined) throw new Error("missing structural child");
      if (child === "file") {
        entries.push(
          Object.freeze({
            role:
              reserved.entry.parentIndex === null && reserved.entry.exactName === "SKILL.md"
                ? "document"
                : "resource-file",
            layout: reserved.entry,
          }),
        );
      } else {
        const entry: { role: "directory"; layout: typeof reserved.entry; names?: unknown } = {
          role: "directory",
          layout: reserved.entry,
        };
        entries.push(entry);
        entry.names = directory(child, reserved.entry);
        Object.freeze(entry);
      }
    }
    return names;
  }

  const rootNames = directory(spec, start.root);
  const session = Object.freeze({
    root: Object.freeze({ layout: start.root, names: rootNames }),
    entries: Object.freeze(entries),
  });
  accepted.add(session);
  const module = await import(pathIndexModulePath);
  return { session, accepted, component, lookup, profile, module };
}

describe("resource-tree path indexes", () => {
  it("builds an opaque index and resolves exact files and final directories in a real session", async () => {
    const session = await genuineSession("path-index-real");
    const built = createResourceTreePathIndex(session);
    expect(built.ok).toBe(true);
    if (!built.ok) return;

    expect(Object.keys(built.index)).toEqual([]);
    expect(Reflect.ownKeys(built.index)).toEqual([]);
    expectDeepFrozen(built);
    for (const [components, path] of [
      [["SKILL.md"], "SKILL.md"],
      [["README.txt"], "README.txt"],
      [["docs"], "docs"],
      [["docs", "guide.md"], "docs/guide.md"],
      [["docs", "nested"], "docs/nested"],
      [["docs", "nested", "leaf.txt"], "docs/nested/leaf.txt"],
    ] as const) {
      expect(resolveResourceTreePath(built.index, components)).toEqual({
        ok: true,
        entryIndex: entryIndex(session, path),
      });
    }
    expect(resolveResourceTreePath(built.index, ["README.txt", "tail"])).toEqual({
      ok: false,
      reason: "not_directory",
      componentIndex: 0,
    });
    expect(resolveResourceTreePath(built.index, ["docs", "absent", "later"])).toEqual({
      ok: false,
      reason: "missing",
      componentIndex: 1,
    });
    expectDeepFrozen(resolveResourceTreePath(built.index, ["docs", "guide.md"]));
  });

  it("returns exact, singleton NFC/fold, and ambiguous fold outcomes without choosing aliases", async () => {
    const { session, module } = await isolatedStructuralSession({
      "A\u030a": "file",
      Guide: "file",
      README: "file",
      ReadMe: "file",
      "SKILL.md": "file",
    });
    const built = module.createResourceTreePathIndex(session);
    expect(built.ok).toBe(true);
    if (!built.ok) return;

    expect(module.resolveResourceTreePath(built.index, ["Å"])).toEqual({
      ok: false,
      reason: "noncanonical",
      componentIndex: 0,
      match: "nfc",
      exact: "A\u030a",
    });
    expect(module.resolveResourceTreePath(built.index, ["guide"])).toEqual({
      ok: false,
      reason: "noncanonical",
      componentIndex: 0,
      match: "fold",
      exact: "Guide",
    });
    const ambiguous = module.resolveResourceTreePath(built.index, ["readme"]);
    expect(ambiguous).toEqual({
      ok: false,
      reason: "ambiguous",
      componentIndex: 0,
      match: "fold",
      exacts: ["README", "ReadMe"],
    });
    expectDeepFrozen(ambiguous);
    const exact = module.resolveResourceTreePath(built.index, ["README"]);
    expect(exact).toMatchObject({ ok: true });
  });

  it("fully validates classifier-compatible components before lookup at exact boundaries", async () => {
    const session = await genuineSession("path-index-components");
    const built = createResourceTreePathIndex(session);
    if (!built.ok) throw new Error("expected path index");
    const index = built.index;

    const exactPath = Array.from({ length: 17 }, () => "a".repeat(240));
    const oversizedPath = [...exactPath.slice(0, -1), `${exactPath.at(-1)}a`];
    expect(Buffer.byteLength(exactPath.join("/"), "utf8")).toBe(4_096);
    expect(resolveResourceTreePath(index, exactPath)).toEqual({
      ok: false,
      reason: "missing",
      componentIndex: 0,
    });
    expect(resolveResourceTreePath(index, oversizedPath)).toEqual({
      ok: false,
      reason: "invalid_input",
    });
    const unassigned255 = `${"\u0378".repeat(127)}a`;
    const exactUnassignedPath = [
      ...Array.from({ length: 15 }, () => unassigned255),
      "\u0378".repeat(127),
      "a",
    ];
    expect(Buffer.byteLength(exactUnassignedPath.join("/"), "utf8")).toBe(4_096);
    expect(resolveResourceTreePath(index, exactUnassignedPath)).toEqual({
      ok: false,
      reason: "missing",
      componentIndex: 0,
    });
    expect(resolveResourceTreePath(index, [...exactUnassignedPath.slice(0, -1), "aa"])).toEqual({
      ok: false,
      reason: "invalid_input",
    });
    expect(
      resolveResourceTreePath(
        index,
        Array.from({ length: 64 }, (_, i) => `p${i}`),
      ),
    ).toMatchObject({ ok: false, reason: "missing" });

    const invalid = [
      [],
      Array.from({ length: 65 }, (_, i) => `p${i}`),
      ["a".repeat(256)],
      ["😀".repeat(64)],
      ["e\u0301.md"],
      ["."],
      [".."],
      [""],
      ["a/b"],
      ["a\\b"],
      ["a?b"],
      ["a:b"],
      ["a%b"],
      ["a#b"],
      ["absent", "a%b"],
      ["\u00a0"],
      ["\u3000"],
      ["\u2065"],
      ["\u0378", "\u00a0"],
    ];
    for (const components of invalid) {
      expect(resolveResourceTreePath(index, components)).toEqual({
        ok: false,
        reason: "invalid_input",
      });
    }
    expect(resolveResourceTreePath(index, ["a".repeat(255)])).toMatchObject({
      ok: false,
      reason: "missing",
    });
    expect(resolveResourceTreePath(index, ["😀".repeat(63)])).toMatchObject({
      ok: false,
      reason: "missing",
    });
    for (const [components, componentIndex] of [
      [["\u0378"], 0],
      [["docs", "\u0378"], 1],
      [["absent", "\u0378"], 0],
    ] as const) {
      expect(resolveResourceTreePath(index, components)).toEqual({
        ok: false,
        reason: "missing",
        componentIndex,
      });
    }
    expect(resolveResourceTreePath(index, ["README.txt", "\u0378"])).toEqual({
      ok: false,
      reason: "not_directory",
      componentIndex: 0,
    });

    for (const destination of ["docs/guide.md", "docs/a%20b.md", "docs/guide.md#part"] as const) {
      const classified = classifyMarkdownDestination(destination);
      expect(classified.kind).toBe("local");
      if (classified.kind === "local") {
        expect(resolveResourceTreePath(index, classified.components).reason).not.toBe(
          "invalid_input",
        );
      }
    }

    const sparse = new Array<string>(2);
    sparse[0] = "docs";
    let getterCalls = 0;
    const accessor: string[] = [];
    Object.defineProperty(accessor, "0", {
      get() {
        getterCalls += 1;
        return "docs";
      },
    });
    accessor.length = 1;
    const proxy = new Proxy(["docs"], {
      get() {
        getterCalls += 1;
        throw new Error("component proxy trap");
      },
    });
    const revoked = Proxy.revocable(["docs"], {});
    revoked.revoke();
    const foreign = runInNewContext('["docs"]') as unknown;
    for (const components of [sparse, accessor, proxy, revoked.proxy, foreign]) {
      expect(resolveResourceTreePath(index, components)).toEqual({
        ok: false,
        reason: "invalid_input",
      });
    }
    expect(getterCalls).toBe(0);
  });

  it("rejects false brands property-free and genuine-brand topology inconsistencies", async () => {
    let traps = 0;
    const fake = Object.create(null);
    Object.defineProperty(fake, "root", {
      get() {
        traps += 1;
        throw new Error("fake session getter");
      },
    });
    const proxy = new Proxy(fake, {
      get() {
        traps += 1;
        throw new Error("fake session trap");
      },
    });
    const revoked = Proxy.revocable({}, {});
    revoked.revoke();
    for (const value of [undefined, fake, proxy, revoked.proxy]) {
      expect(createResourceTreePathIndex(value)).toEqual({
        ok: false,
        reason: "invalid_input",
      });
    }
    expect(traps).toBe(0);

    const { session, accepted, module } = await isolatedStructuralSession({
      dir: { "child.txt": "file" },
      "root.txt": "file",
      "SKILL.md": "file",
    });
    const original = session.entries;
    const first = original[0] as { readonly role: string; readonly layout: object };
    const directoryOrdinal = original.findIndex(
      (entry) => (entry as { readonly role?: unknown }).role === "directory",
    );
    const malformed = [
      Object.freeze({ root: session.root, entries: Object.freeze(original.slice(1)) }),
      Object.freeze({ root: session.root, entries: Object.freeze([...original, first]) }),
      Object.freeze({
        root: session.root,
        entries: Object.freeze([original[1], original[0], ...original.slice(2)]),
      }),
      Object.freeze({
        root: session.root,
        entries: Object.freeze([
          Object.freeze({ role: "resource-file", layout: first.layout }),
          ...original.slice(1),
        ]),
      }),
      Object.freeze({
        root: session.root,
        entries: Object.freeze(
          original.map((entry, ordinal) =>
            ordinal === directoryOrdinal
              ? Object.freeze({
                  role: "resource-file",
                  layout: (entry as { layout: object }).layout,
                })
              : entry,
          ),
        ),
      }),
      Object.freeze({
        root: session.root,
        entries: Object.freeze([
          Object.freeze({
            role: first.role,
            layout: Object.freeze({ ...first.layout, relativePathByteLength: 999 }),
          }),
          ...original.slice(1),
        ]),
      }),
    ];
    const hole = new Array<object>(original.length);
    for (let ordinal = 0; ordinal < original.length - 1; ordinal += 1) {
      hole[ordinal] = original[ordinal] as object;
    }
    malformed.push(Object.freeze({ root: session.root, entries: Object.freeze(hole) }));
    for (const value of malformed) {
      accepted.add(value);
      expect(module.createResourceTreePathIndex(value)).toEqual({
        ok: false,
        reason: "inconsistent",
      });
    }
  });

  it("normalizes malformed or throwing captured producers to fixed failures", async () => {
    const malformedBuild = await isolatedStructuralSession({ "SKILL.md": "file" });
    malformedBuild.lookup.active = true;
    malformedBuild.lookup.value = Object.freeze({ ok: false, reason: "invalid_request" });
    expect(malformedBuild.module.createResourceTreePathIndex(malformedBuild.session)).toEqual({
      ok: false,
      reason: "inconsistent",
    });

    let lookupGetterCalls = 0;
    const accessorLookup = Object.freeze(
      Object.defineProperty({}, "ok", {
        get() {
          lookupGetterCalls += 1;
          return true;
        },
      }),
    );
    const malformedLookups: readonly unknown[] = [
      null,
      accessorLookup,
      Object.freeze({ ok: false, reason: "invalid_request" }),
      Object.freeze({ ok: true, match: "unexpected", exacts: Object.freeze(["missing"]) }),
      Object.freeze({ ok: true, match: "exact", exacts: Object.freeze([]) }),
      Object.freeze({ ok: true, match: "exact", exacts: Object.freeze([7]) }),
    ];
    for (const malformed of malformedLookups) {
      const isolated = await isolatedStructuralSession({ "SKILL.md": "file" });
      const built = isolated.module.createResourceTreePathIndex(isolated.session);
      if (!built.ok) throw new Error("expected isolated path index");
      isolated.lookup.active = true;
      isolated.lookup.value = malformed;
      expect(isolated.module.resolveResourceTreePath(built.index, ["missing"])).toEqual({
        ok: false,
        reason: "inconsistent",
      });
    }
    expect(lookupGetterCalls).toBe(0);

    const alienCandidates = await isolatedStructuralSession({
      Alpha: "file",
      Beta: "file",
      dir: { "nested.txt": "file" },
      "SKILL.md": "file",
    });
    const alienIndex = alienCandidates.module.createResourceTreePathIndex(alienCandidates.session);
    if (!alienIndex.ok) throw new Error("expected candidate-validation path index");
    alienCandidates.lookup.active = true;
    for (const exacts of [["injected"], ["Alpha", "Alpha"], ["Beta", "Alpha"], ["nested.txt"]]) {
      alienCandidates.lookup.value = Object.freeze({
        ok: true,
        match: "fold",
        exacts: Object.freeze(exacts),
      });
      expect(alienCandidates.module.resolveResourceTreePath(alienIndex.index, ["alias"])).toEqual({
        ok: false,
        reason: "inconsistent",
      });
    }

    const throwingLookup = await isolatedStructuralSession({ "SKILL.md": "file" });
    const built = throwingLookup.module.createResourceTreePathIndex(throwingLookup.session);
    if (!built.ok) throw new Error("expected throwing-lookup index");
    throwingLookup.lookup.active = true;
    throwingLookup.lookup.throws = true;
    expect(throwingLookup.module.resolveResourceTreePath(built.index, ["missing"])).toEqual({
      ok: false,
      reason: "inconsistent",
    });

    const producers = await isolatedStructuralSession({ "SKILL.md": "file" });
    const producerIndex = producers.module.createResourceTreePathIndex(producers.session);
    if (!producerIndex.ok) throw new Error("expected producer-control path index");
    const expectProducerInconsistent = () => {
      expect(producers.module.resolveResourceTreePath(producerIndex.index, ["missing"])).toEqual({
        ok: false,
        reason: "inconsistent",
      });
    };
    producers.component.active = true;
    producers.component.value = 7;
    expectProducerInconsistent();
    producers.component.throws = true;
    expectProducerInconsistent();
    producers.component.active = false;
    producers.component.throws = false;

    producers.profile.active = true;
    producers.profile.value = null;
    expectProducerInconsistent();
    producers.profile.throws = true;
    expectProducerInconsistent();
    producers.profile.throws = false;
    producers.profile.genuine = true;
    const validProfile = {
      ok: true,
      exact: "missing",
      exactByteLength: 7,
      nfc: "missing",
      key: "missing",
      isNfc: true,
    } as const;
    for (const value of [
      Object.freeze({ ok: false, reason: "unsupported_runtime" }),
      Object.freeze({ ok: false, reason: "unsafe_unicode" }),
      Object.freeze({ ...validProfile, exact: "other" }),
      Object.freeze({ ...validProfile, isNfc: false }),
      Object.freeze({ ...validProfile, exactByteLength: 8 }),
    ]) {
      producers.profile.value = value;
      expectProducerInconsistent();
    }

    vi.resetModules();
    const predicateThrow = Object.freeze({});
    vi.doMock(sessionModulePath, () => ({
      isGenuineResourceTreeSession(value: unknown) {
        if (value === predicateThrow) throw new Error("isolated brand predicate failure");
        return true;
      },
    }));
    const isolated = await import(pathIndexModulePath);
    expect(isolated.createResourceTreePathIndex(predicateThrow)).toEqual({
      ok: false,
      reason: "invalid_input",
    });
    expect(isolated.createResourceTreePathIndex(7)).toEqual({
      ok: false,
      reason: "inconsistent",
    });
  });

  it("captures intrinsics and remains internal-only", async () => {
    const session = await genuineSession("path-index-pollution");
    const originals = {
      apply: Reflect.apply,
      defineProperty: Object.defineProperty,
      freeze: Object.freeze,
      descriptor: Object.getOwnPropertyDescriptor,
      prototype: Object.getPrototypeOf,
      objectIs: Object.is,
      array: Array.isArray,
      byteLength: Buffer.byteLength,
      integer: Number.isSafeInteger,
      charCodeAt: String.prototype.charCodeAt,
      proxy: types.isProxy,
      weakGet: WeakMap.prototype.get,
      weakSet: WeakMap.prototype.set,
    };
    let built: ReturnType<typeof createResourceTreePathIndex> | undefined;
    let resolved: ReturnType<typeof resolveResourceTreePath> | undefined;
    const poison = () => {
      throw new Error("live intrinsic poison");
    };
    try {
      originals.defineProperty(Reflect, "apply", { configurable: true, value: poison });
      for (const [target, key] of [
        [Object, "defineProperty"],
        [Object, "freeze"],
        [Object, "getOwnPropertyDescriptor"],
        [Object, "getPrototypeOf"],
        [Object, "is"],
        [Array, "isArray"],
        [Buffer, "byteLength"],
        [Number, "isSafeInteger"],
        [String.prototype, "charCodeAt"],
        [types, "isProxy"],
        [WeakMap.prototype, "get"],
        [WeakMap.prototype, "set"],
      ] as const) {
        originals.defineProperty(target, key, {
          configurable: true,
          value: poison,
          writable: true,
        });
      }
      built = createResourceTreePathIndex(session);
      if (built.ok) resolved = resolveResourceTreePath(built.index, ["docs", "guide.md"]);
    } finally {
      originals.defineProperty(Reflect, "apply", { configurable: true, value: originals.apply });
      for (const [target, key, value] of [
        [Object, "defineProperty", originals.defineProperty],
        [Object, "freeze", originals.freeze],
        [Object, "getOwnPropertyDescriptor", originals.descriptor],
        [Object, "getPrototypeOf", originals.prototype],
        [Object, "is", originals.objectIs],
        [Array, "isArray", originals.array],
        [Buffer, "byteLength", originals.byteLength],
        [Number, "isSafeInteger", originals.integer],
        [String.prototype, "charCodeAt", originals.charCodeAt],
        [types, "isProxy", originals.proxy],
        [WeakMap.prototype, "get", originals.weakGet],
        [WeakMap.prototype, "set", originals.weakSet],
      ] as const) {
        originals.defineProperty(target, key, { configurable: true, value, writable: true });
      }
    }
    expect(built?.ok).toBe(true);
    expect(resolved).toMatchObject({ ok: true });

    const source = await readFile(
      new URL("src/validate/resource-tree-path-index.ts", repositoryRoot),
      "utf8",
    );
    expect(source).not.toMatch(/node:fs|node:path|AbortSignal|lstat|openDirectory|readFile/iu);
    const rootSource = await readFile(new URL("src/index.ts", repositoryRoot), "utf8");
    expect(rootSource).not.toContain("resource-tree-path-index");
    expect(rootSource).not.toContain("resolveResourceTreePath");
  });

  it("does not inspect components when the opaque index brand is absent", () => {
    let traps = 0;
    const components = new Proxy([], {
      get() {
        traps += 1;
        throw new Error("components trap");
      },
      getOwnPropertyDescriptor() {
        traps += 1;
        throw new Error("components descriptor trap");
      },
    });
    expect(resolveResourceTreePath(Object.freeze({}), components)).toEqual({
      ok: false,
      reason: "invalid_input",
    });
    expect(traps).toBe(0);
  });
});
