import { readFile } from "node:fs/promises";

import { describe, expect, it, vi } from "vitest";

import {
  type DirectoryNameIndex,
  indexDirectoryNames,
  reprofileDirectoryNameIndexEntry,
} from "../src/validate/directory-name-index.js";
import {
  createResourceTreeLayout,
  reserveResourceTreeChild,
} from "../src/validate/resource-tree-layout.js";
import {
  profileObservedResourceName,
  type ResourceNameProfile,
} from "../src/validate/resource-name-profile.js";

const repositoryRoot = new URL("../", import.meta.url);

function profile(value: string): ResourceNameProfile {
  const result = profileObservedResourceName(value);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(`Expected a profile, received ${result.reason}`);
  return result;
}

function index(values: readonly string[]): DirectoryNameIndex {
  const result = indexDirectoryNames(values.map(profile));
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(`Expected an index, received ${result.reason}`);
  return result;
}

describe("directory-name index reprofiling", () => {
  it("rebuilds exact Unicode entries as genuine layout-compatible profiles", () => {
    const names = ["ASCII", "A\u030a", "界", "𐀀"];
    const indexed = index(names);
    for (let ordinal = 0; ordinal < indexed.entries.length; ordinal += 1) {
      const result = reprofileDirectoryNameIndexEntry(indexed, ordinal);
      expect(result.ok).toBe(true);
      if (!result.ok) continue;
      expect(result.profile.exact).toBe(indexed.entries[ordinal]?.exact);
      expect(Object.isFrozen(result)).toBe(true);
      expect(Object.isFrozen(result.profile)).toBe(true);

      const layout = createResourceTreeLayout();
      expect(reserveResourceTreeChild(layout.budget, layout.root, result.profile).ok).toBe(true);
    }
  });

  it("authenticates the current-module index before reading ordinal or index properties", async () => {
    const genuine = index(["entry"]);
    let trapCalls = 0;
    const handler: ProxyHandler<DirectoryNameIndex> = {
      get() {
        trapCalls += 1;
        throw new Error("index getter trap");
      },
      getOwnPropertyDescriptor() {
        trapCalls += 1;
        throw new Error("index descriptor trap");
      },
    };
    const revocable = Proxy.revocable(genuine, handler);
    revocable.revoke();
    vi.resetModules();
    const foreignProfiles = await import("../src/validate/resource-name-profile.js");
    const foreign = await import("../src/validate/directory-name-index.js");
    const foreignIndex = foreign.indexDirectoryNames([
      foreignProfiles.profileObservedResourceName("entry"),
    ]);
    expect(foreignIndex.ok).toBe(true);

    for (const candidate of [
      undefined,
      {},
      { ...genuine },
      new Proxy(genuine, handler),
      revocable.proxy,
      foreignIndex,
    ]) {
      expect(reprofileDirectoryNameIndexEntry(candidate, 0)).toEqual({
        ok: false,
        reason: "invalid_input",
      });
    }
    expect(trapCalls).toBe(0);
  });

  it("rejects every non-canonical or out-of-range ordinal with one frozen result", () => {
    const indexed = index(["entry"]);
    for (const ordinal of [
      undefined,
      null,
      "0",
      new Number(0),
      Number.NaN,
      Number.POSITIVE_INFINITY,
      -1,
      -0,
      0.5,
      Number.MAX_SAFE_INTEGER + 1,
      1,
    ]) {
      const result = reprofileDirectoryNameIndexEntry(indexed, ordinal);
      expect(result).toEqual({ ok: false, reason: "invalid_input" });
      expect(Object.isFrozen(result)).toBe(true);
      expect(Object.keys(result).sort()).toEqual(["ok", "reason"]);
    }
  });

  it("normalizes profiler failures and every copied-field mismatch to inconsistency", async () => {
    const actualProfiles = await vi.importActual<
      typeof import("../src/validate/resource-name-profile.js")
    >("../src/validate/resource-name-profile.js");
    const acceptedForTest = new WeakSet<object>();
    let mode: "current" | "failure" | "foreign" | "mismatch" = "current";
    let mismatchField: "exact" | "exactByteLength" | "nfc" | "key" | "isNfc" = "exact";
    vi.doMock("../src/validate/resource-name-profile.js", () => ({
      ...actualProfiles,
      isResourceNameProfileResult(value: unknown): boolean {
        return (
          actualProfiles.isResourceNameProfileResult(value) ||
          ((typeof value === "object" || typeof value === "function") &&
            value !== null &&
            acceptedForTest.has(value))
        );
      },
      profileObservedResourceName(value: unknown): unknown {
        if (mode === "failure") return actualProfiles.profileObservedResourceName("/");
        if (mode === "foreign") return { ...actualProfiles.profileObservedResourceName("other") };
        if (mode === "mismatch") {
          const current = actualProfiles.profileObservedResourceName(value);
          if (!current.ok) return current;
          const alternate = { ...current };
          switch (mismatchField) {
            case "exact":
              alternate.exact = `${current.exact}!`;
              break;
            case "exactByteLength":
              alternate.exactByteLength = current.exactByteLength + 1;
              break;
            case "nfc":
              alternate.nfc = `${current.nfc}!`;
              break;
            case "key":
              alternate.key = `${current.key}!`;
              break;
            case "isNfc":
              alternate.isNfc = !current.isNfc;
              break;
          }
          Object.freeze(alternate);
          acceptedForTest.add(alternate);
          return alternate;
        }
        return actualProfiles.profileObservedResourceName(value);
      },
    }));
    vi.resetModules();
    try {
      const isolated = await import("../src/validate/directory-name-index.js");
      const indexed = isolated.indexDirectoryNames([
        actualProfiles.profileObservedResourceName("A\u030a"),
      ]);
      expect(indexed.ok).toBe(true);
      if (!indexed.ok) return;

      expect(isolated.reprofileDirectoryNameIndexEntry(indexed, 0).ok).toBe(true);
      for (const next of ["failure", "foreign"] as const) {
        mode = next;
        expect(isolated.reprofileDirectoryNameIndexEntry(indexed, 0)).toEqual({
          ok: false,
          reason: "inconsistent",
        });
      }
      mode = "mismatch";
      for (const field of ["exact", "exactByteLength", "nfc", "key", "isNfc"] as const) {
        mismatchField = field;
        expect(isolated.reprofileDirectoryNameIndexEntry(indexed, 0)).toEqual({
          ok: false,
          reason: "inconsistent",
        });
      }
    } finally {
      vi.doUnmock("../src/validate/resource-name-profile.js");
      vi.resetModules();
    }
  });

  it("uses captured intrinsics after post-import pollution", () => {
    const indexed = index(["entry"]);
    const descriptors = [
      [Reflect, "apply", Object.getOwnPropertyDescriptor(Reflect, "apply")],
      [Object, "freeze", Object.getOwnPropertyDescriptor(Object, "freeze")],
      [Object, "is", Object.getOwnPropertyDescriptor(Object, "is")],
      [
        Object,
        "getOwnPropertyDescriptor",
        Object.getOwnPropertyDescriptor(Object, "getOwnPropertyDescriptor"),
      ],
      [Number, "isSafeInteger", Object.getOwnPropertyDescriptor(Number, "isSafeInteger")],
    ] as const;
    let calls = 0;
    const poison = (): never => {
      calls += 1;
      throw new Error("live intrinsic used");
    };
    let result: ReturnType<typeof reprofileDirectoryNameIndexEntry> | undefined;
    try {
      for (const [target, property, descriptor] of descriptors) {
        if (descriptor === undefined) throw new Error(`Missing descriptor ${property}`);
        Reflect.defineProperty(target, property, { ...descriptor, value: poison });
      }
      result = reprofileDirectoryNameIndexEntry(indexed, 0);
    } finally {
      for (const [target, property, descriptor] of descriptors) {
        if (descriptor !== undefined) Reflect.defineProperty(target, property, descriptor);
      }
    }
    expect(result?.ok).toBe(true);
    expect(calls).toBe(0);
  });

  it("remains internal and adds no filesystem, host-path, or locale shortcut", async () => {
    const source = await readFile(
      new URL("src/validate/directory-name-index.ts", repositoryRoot),
      "utf8",
    );
    expect(source).not.toContain("node:fs");
    expect(source).not.toContain("node:path");
    expect(source).not.toContain(`locale${"Compare"}`);

    const rootSource = await readFile(new URL("src/index.ts", repositoryRoot), "utf8");
    expect(rootSource).not.toContain("reprofileDirectoryNameIndexEntry");
    expect(rootSource).not.toContain("DirectoryNameIndexReprofileResult");
  });
});
