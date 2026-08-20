import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import {
  compareResourceTreeSiblingNames,
  createResourceTreeLayout,
  MAX_RESOURCE_TREE_DEPTH,
  MAX_RESOURCE_TREE_ENTRIES,
  MAX_RESOURCE_TREE_TOTAL_RELATIVE_PATH_BYTES,
  reserveResourceTreeChild,
  type ResourceTreeBudgetToken,
  type ResourceTreeEntryLayout,
  type ResourceTreeLocation,
} from "../src/validate/resource-tree-layout.js";
import {
  profileObservedResourceName,
  type ResourceNameProfile,
} from "../src/validate/resource-name-profile.js";

const repositoryRoot = new URL("../", import.meta.url);

function profile(value: string): ResourceNameProfile {
  const result = profileObservedResourceName(value);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(`Expected a successful profile, received ${result.reason}`);
  return result;
}

function reserve(
  budget: ResourceTreeBudgetToken,
  parent: ResourceTreeLocation,
  name: ResourceNameProfile,
): { readonly budget: ResourceTreeBudgetToken; readonly entry: ResourceTreeEntryLayout } {
  const result = reserveResourceTreeChild(budget, parent, name);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(`Expected a reservation, received ${result.reason}`);
  return result;
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

describe("resource-tree logical layouts", () => {
  it("starts at an uncounted depth-zero root and reserves zero-based exact logical paths", () => {
    const start = createResourceTreeLayout();
    expect(start.root).toEqual({
      entryIndex: null,
      parentIndex: null,
      depth: 0,
      exactName: "",
      exactNameByteLength: 0,
      relativePath: "",
      relativePathByteLength: 0,
    });
    expect(start.budget).toEqual({ entryCount: 0, totalRelativePathBytes: 0 });

    const top = reserve(start.budget, start.root, profile("assets"));
    const nested = reserve(top.budget, top.entry, profile("café.txt"));
    expect(top.entry).toEqual({
      entryIndex: 0,
      parentIndex: null,
      depth: 1,
      exactName: "assets",
      exactNameByteLength: 6,
      relativePath: "assets",
      relativePathByteLength: 6,
    });
    expect(nested.entry).toEqual({
      entryIndex: 1,
      parentIndex: 0,
      depth: 2,
      exactName: "café.txt",
      exactNameByteLength: 9,
      relativePath: "assets/café.txt",
      relativePathByteLength: 16,
    });
    expect(nested.budget).toEqual({ entryCount: 2, totalRelativePathBytes: 22 });
    expectDeepFrozen(start);
    expectDeepFrozen(top);
    expectDeepFrozen(nested);
  });

  it("charges exact observed spelling bytes rather than NFC or fold projections", () => {
    const start = createResourceTreeLayout();
    const nonNfc = profile("A\u030a");
    expect(nonNfc.exactByteLength).toBe(3);
    expect(nonNfc.nfc).toBe("Å");

    const result = reserve(start.budget, start.root, nonNfc);
    expect(result.entry.exactName).toBe("A\u030a");
    expect(result.entry.exactNameByteLength).toBe(3);
    expect(result.entry.relativePathByteLength).toBe(3);
    expect(result.budget.totalRelativePathBytes).toBe(3);
  });

  it("makes each active budget a unique one-shot successor without poisoning invalid input", () => {
    const first = createResourceTreeLayout();
    const second = createResourceTreeLayout();
    const good = profile("entry");
    const forgedProfile = { ...good };

    expect(reserveResourceTreeChild(first.budget, first.root, forgedProfile)).toEqual({
      ok: false,
      reason: "invalid_input",
    });
    expect(reserveResourceTreeChild(first.budget, second.root, good)).toEqual({
      ok: false,
      reason: "invalid_state",
    });
    const accepted = reserve(first.budget, first.root, good);
    expect(accepted.entry.entryIndex).toBe(0);
    expect(reserveResourceTreeChild(first.budget, first.root, good)).toEqual({
      ok: false,
      reason: "invalid_state",
    });
    expect(reserveResourceTreeChild(accepted.budget, { ...first.root }, good)).toEqual({
      ok: false,
      reason: "invalid_state",
    });
    const next = reserve(accepted.budget, first.root, profile("other"));
    expect(next.entry.entryIndex).toBe(1);
  });

  it("authenticates structures without invoking caller getters or proxy traps", () => {
    const start = createResourceTreeLayout();
    const good = profile("entry");
    let calls = 0;
    const trap = (): never => {
      calls += 1;
      throw new Error("untrusted property was read");
    };
    const badBudget = new Proxy(start.budget, { get: trap });
    const badParent = new Proxy(start.root, { get: trap });
    const badProfile = new Proxy(good, { get: trap });

    expect(reserveResourceTreeChild(badBudget, start.root, good)).toEqual({
      ok: false,
      reason: "invalid_state",
    });
    expect(reserveResourceTreeChild(undefined, start.root, good)).toEqual({
      ok: false,
      reason: "invalid_state",
    });
    expect(reserveResourceTreeChild(start.budget, badParent, good)).toEqual({
      ok: false,
      reason: "invalid_state",
    });
    expect(reserveResourceTreeChild(start.budget, null, good)).toEqual({
      ok: false,
      reason: "invalid_state",
    });
    expect(reserveResourceTreeChild(start.budget, start.root, badProfile)).toEqual({
      ok: false,
      reason: "invalid_input",
    });
    expect(calls).toBe(0);

    const accepted = reserve(start.budget, start.root, good);
    expect(accepted.entry.entryIndex).toBe(0);
  });

  it("rejects duplicate exact logical paths without deduplicating NFC or fold aliases", () => {
    const duplicateStart = createResourceTreeLayout();
    const exact = profile("Å");
    const first = reserve(duplicateStart.budget, duplicateStart.root, exact);
    expect(reserveResourceTreeChild(first.budget, duplicateStart.root, exact)).toEqual({
      ok: false,
      reason: "duplicate_path",
    });
    expect(reserveResourceTreeChild(first.budget, duplicateStart.root, profile("other"))).toEqual({
      ok: false,
      reason: "invalid_state",
    });

    const aliasesStart = createResourceTreeLayout();
    const nfc = reserve(aliasesStart.budget, aliasesStart.root, exact);
    const nonNfc = reserve(nfc.budget, aliasesStart.root, profile("A\u030a"));
    const folded = reserve(nonNfc.budget, aliasesStart.root, profile("å"));
    expect(folded.budget.entryCount).toBe(3);
    expect([nfc.entry.relativePath, nonNfc.entry.relativePath, folded.entry.relativePath]).toEqual([
      "Å",
      "A\u030a",
      "å",
    ]);
  });

  it("accepts exactly 8,192 entries and makes the next count failure terminal", () => {
    expect(MAX_RESOURCE_TREE_ENTRIES).toBe(8_192);
    const start = createResourceTreeLayout();
    let budget = start.budget;
    let finalEntry: ResourceTreeEntryLayout | undefined;
    const leafProfiles = Array.from({ length: 1_023 }, (_, index) =>
      profile(`f${String(index).padStart(4, "0")}`),
    );
    for (let directoryIndex = 0; directoryIndex < 8; directoryIndex += 1) {
      const directory = reserve(budget, start.root, profile(`d${String(directoryIndex)}`));
      budget = directory.budget;
      for (let leafIndex = 0; leafIndex < leafProfiles.length; leafIndex += 1) {
        const result = reserve(
          budget,
          directory.entry,
          leafProfiles[leafIndex] as ResourceNameProfile,
        );
        budget = result.budget;
        finalEntry = result.entry;
      }
    }
    expect(finalEntry?.entryIndex).toBe(8_191);
    expect(budget).toEqual({
      entryCount: MAX_RESOURCE_TREE_ENTRIES,
      totalRelativePathBytes: 65_488,
    });
    expect(reserveResourceTreeChild(budget, start.root, profile("overflow"))).toEqual({
      ok: false,
      reason: "too_many_entries",
    });
    expect(reserveResourceTreeChild(budget, start.root, profile("overflow"))).toEqual({
      ok: false,
      reason: "invalid_state",
    });
  });

  it("accepts a depth-64 location, rejects only its child, and preserves count priority", () => {
    expect(MAX_RESOURCE_TREE_DEPTH).toBe(64);
    const start = createResourceTreeLayout();
    const oneByte = profile("x");
    let budget = start.budget;
    let parent: ResourceTreeLocation = start.root;
    for (let depth = 1; depth <= MAX_RESOURCE_TREE_DEPTH; depth += 1) {
      const result = reserve(budget, parent, oneByte);
      budget = result.budget;
      parent = result.entry;
    }
    expect(parent.depth).toBe(64);
    expect(parent.relativePathByteLength).toBe(127);
    expect(budget).toEqual({ entryCount: 64, totalRelativePathBytes: 4_096 });
    expect(reserveResourceTreeChild(budget, parent, oneByte)).toEqual({
      ok: false,
      reason: "too_deep",
    });

    const countStart = createResourceTreeLayout();
    let countBudget = countStart.budget;
    let depthParent: ResourceTreeLocation = countStart.root;
    for (let depth = 1; depth <= MAX_RESOURCE_TREE_DEPTH; depth += 1) {
      const result = reserve(countBudget, depthParent, oneByte);
      countBudget = result.budget;
      depthParent = result.entry;
    }
    for (let index = MAX_RESOURCE_TREE_DEPTH; index < MAX_RESOURCE_TREE_ENTRIES; index += 1) {
      countBudget = reserve(
        countBudget,
        countStart.root,
        profile(`e${String(index).padStart(4, "0")}`),
      ).budget;
    }
    expect(reserveResourceTreeChild(countBudget, depthParent, oneByte)).toEqual({
      ok: false,
      reason: "too_many_entries",
    });
  });

  it("accepts exactly 8 MiB of relative paths and rejects plus one byte", () => {
    expect(MAX_RESOURCE_TREE_TOTAL_RELATIVE_PATH_BYTES).toBe(8_388_608);
    const start = createResourceTreeLayout();
    const maxName = profile("a".repeat(255));
    let budget = start.budget;
    let parent: ResourceTreeLocation = start.root;
    let depth34: ResourceTreeLocation | undefined;
    for (let depth = 1; depth <= 63; depth += 1) {
      const result = reserve(budget, parent, maxName);
      budget = result.budget;
      parent = result.entry;
      if (depth === 34) depth34 = result.entry;
    }
    expect(parent.relativePathByteLength).toBe(16_127);
    for (let index = 0; index < 480; index += 1) {
      const prefix = `leaf-${String(index).padStart(3, "0")}-`;
      budget = reserve(budget, parent, profile(prefix + "x".repeat(255 - prefix.length))).budget;
    }
    if (depth34 === undefined) throw new Error("Expected the depth-34 location");
    const exact = reserve(budget, depth34, profile("q".repeat(31)));
    expect(exact.entry.relativePathByteLength).toBe(8_735);
    expect(exact.budget).toEqual({
      entryCount: 544,
      totalRelativePathBytes: MAX_RESOURCE_TREE_TOTAL_RELATIVE_PATH_BYTES,
    });
    expect(reserveResourceTreeChild(exact.budget, start.root, profile("z"))).toEqual({
      ok: false,
      reason: "paths_too_large",
    });
    expect(reserveResourceTreeChild(exact.budget, start.root, profile("z"))).toEqual({
      ok: false,
      reason: "invalid_state",
    });
  });

  it("returns a total frozen UTF-16 comparator for exact sibling names only", () => {
    const ascii = profile("a");
    const astral = profile("𐀀");
    const privateUse = profile("\ue000");
    expect(compareResourceTreeSiblingNames(ascii, astral)).toEqual({ ok: true, order: -1 });
    expect(compareResourceTreeSiblingNames(astral, privateUse)).toEqual({ ok: true, order: -1 });
    expect(compareResourceTreeSiblingNames(privateUse, astral)).toEqual({ ok: true, order: 1 });
    expect(compareResourceTreeSiblingNames(astral, astral)).toEqual({ ok: true, order: 0 });
    const invalid = compareResourceTreeSiblingNames({ ...astral }, privateUse);
    expect(invalid).toEqual({ ok: false, reason: "invalid_input" });
    expectDeepFrozen(invalid);
    expectDeepFrozen(compareResourceTreeSiblingNames(ascii, astral));
  });

  it("uses initialization-time intrinsic snapshots after live methods are replaced", () => {
    const left = profile("a");
    const right = profile("𐀀");
    const freezeDescriptor = Object.getOwnPropertyDescriptor(Object, "freeze");
    const applyDescriptor = Object.getOwnPropertyDescriptor(Reflect, "apply");
    const weakMapGetDescriptor = Object.getOwnPropertyDescriptor(WeakMap.prototype, "get");
    const weakMapSetDescriptor = Object.getOwnPropertyDescriptor(WeakMap.prototype, "set");
    const weakSetAddDescriptor = Object.getOwnPropertyDescriptor(WeakSet.prototype, "add");
    const weakSetDeleteDescriptor = Object.getOwnPropertyDescriptor(WeakSet.prototype, "delete");
    const weakSetHasDescriptor = Object.getOwnPropertyDescriptor(WeakSet.prototype, "has");
    const setDescriptor = Object.getOwnPropertyDescriptor(globalThis, "Set");
    const setAddDescriptor = Object.getOwnPropertyDescriptor(Set.prototype, "add");
    const setHasDescriptor = Object.getOwnPropertyDescriptor(Set.prototype, "has");
    const charCodeAtDescriptor = Object.getOwnPropertyDescriptor(String.prototype, "charCodeAt");
    const descriptors = [
      freezeDescriptor,
      applyDescriptor,
      weakMapGetDescriptor,
      weakMapSetDescriptor,
      weakSetAddDescriptor,
      weakSetDeleteDescriptor,
      weakSetHasDescriptor,
      setDescriptor,
      setAddDescriptor,
      setHasDescriptor,
      charCodeAtDescriptor,
    ];
    if (descriptors.some((descriptor) => descriptor === undefined)) {
      throw new Error("Expected configurable intrinsic descriptors");
    }

    let calls = 0;
    const trap = (): never => {
      calls += 1;
      throw new Error("live intrinsic was called");
    };
    const replace = (
      target: object,
      property: PropertyKey,
      descriptor: PropertyDescriptor,
    ): void => {
      Reflect.defineProperty(target, property, { ...descriptor, value: trap });
    };
    let result:
      | {
          readonly start: ReturnType<typeof createResourceTreeLayout>;
          readonly reservation: ReturnType<typeof reserveResourceTreeChild>;
          readonly comparison: ReturnType<typeof compareResourceTreeSiblingNames>;
        }
      | undefined;
    try {
      replace(Object, "freeze", freezeDescriptor as PropertyDescriptor);
      replace(WeakMap.prototype, "get", weakMapGetDescriptor as PropertyDescriptor);
      replace(WeakMap.prototype, "set", weakMapSetDescriptor as PropertyDescriptor);
      replace(WeakSet.prototype, "add", weakSetAddDescriptor as PropertyDescriptor);
      replace(WeakSet.prototype, "delete", weakSetDeleteDescriptor as PropertyDescriptor);
      replace(WeakSet.prototype, "has", weakSetHasDescriptor as PropertyDescriptor);
      replace(Set.prototype, "add", setAddDescriptor as PropertyDescriptor);
      replace(Set.prototype, "has", setHasDescriptor as PropertyDescriptor);
      replace(globalThis, "Set", setDescriptor as PropertyDescriptor);
      replace(String.prototype, "charCodeAt", charCodeAtDescriptor as PropertyDescriptor);
      replace(Reflect, "apply", applyDescriptor as PropertyDescriptor);

      const start = createResourceTreeLayout();
      result = {
        start,
        reservation: reserveResourceTreeChild(start.budget, start.root, left),
        comparison: compareResourceTreeSiblingNames(left, right),
      };
    } finally {
      Reflect.defineProperty(Object, "freeze", freezeDescriptor as PropertyDescriptor);
      Reflect.defineProperty(Reflect, "apply", applyDescriptor as PropertyDescriptor);
      Reflect.defineProperty(WeakMap.prototype, "get", weakMapGetDescriptor as PropertyDescriptor);
      Reflect.defineProperty(WeakMap.prototype, "set", weakMapSetDescriptor as PropertyDescriptor);
      Reflect.defineProperty(WeakSet.prototype, "add", weakSetAddDescriptor as PropertyDescriptor);
      Reflect.defineProperty(
        WeakSet.prototype,
        "delete",
        weakSetDeleteDescriptor as PropertyDescriptor,
      );
      Reflect.defineProperty(WeakSet.prototype, "has", weakSetHasDescriptor as PropertyDescriptor);
      Reflect.defineProperty(globalThis, "Set", setDescriptor as PropertyDescriptor);
      Reflect.defineProperty(Set.prototype, "add", setAddDescriptor as PropertyDescriptor);
      Reflect.defineProperty(Set.prototype, "has", setHasDescriptor as PropertyDescriptor);
      Reflect.defineProperty(
        String.prototype,
        "charCodeAt",
        charCodeAtDescriptor as PropertyDescriptor,
      );
    }

    expect(calls).toBe(0);
    expect(result?.reservation).toMatchObject({ ok: true });
    expect(result?.comparison).toEqual({ ok: true, order: -1 });
    expectDeepFrozen(result?.start);
    expectDeepFrozen(result?.reservation);
    expectDeepFrozen(result?.comparison);
  });

  it("contains no filesystem, host-path, locale, iterator, or insertion-order dependency", async () => {
    const source = await readFile(
      new URL("src/validate/resource-tree-layout.ts", repositoryRoot),
      "utf8",
    );
    for (const fragment of [
      "node:fs",
      "node:path",
      "process.",
      "platform",
      "network",
      `locale${"Compare"}`,
      "new Map",
      "new Set",
      "[Symbol.iterator]",
    ]) {
      expect(source).not.toContain(fragment);
    }
    expect(source).not.toMatch(/\bfor\s*\([^)]*\bof\b/gu);
    expect(source).toContain("WeakMap");
    expect(source).toContain("WeakSet");
    expect(source).toContain("Set.prototype.add");
    expect(source).toContain("Set.prototype.has");

    const rootSource = await readFile(new URL("src/index.ts", repositoryRoot), "utf8");
    expect(rootSource).not.toContain("resource-tree-layout");
    expect(rootSource).not.toContain("createResourceTreeLayout");
    expect(rootSource).not.toContain("MAX_RESOURCE_TREE");
  });
});
