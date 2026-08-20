import { readFile } from "node:fs/promises";

import { describe, expect, it, vi } from "vitest";

import {
  indexDirectoryNames,
  lookupDirectoryName,
  MAX_DIRECTORY_NAME_INDEX_ENTRIES,
  MAX_DIRECTORY_NAME_INDEX_FINDINGS,
  type DirectoryNameIndex,
} from "../src/validate/directory-name-index.js";
import {
  profileObservedResourceName,
  type ResourceNameProfile,
  type ResourceNameProfileResult,
} from "../src/validate/resource-name-profile.js";

const repositoryRoot = new URL("../", import.meta.url);
const originalUnicodeDescriptor = Object.getOwnPropertyDescriptor(process.versions, "unicode");

function successProfile(value: string): ResourceNameProfile {
  const result = profileObservedResourceName(value);
  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw new Error(`Expected a successful profile, received ${result.reason}`);
  }
  return result;
}

function successIndex(values: readonly ResourceNameProfileResult[]): DirectoryNameIndex {
  const result = indexDirectoryNames(values);
  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw new Error(`Expected a directory-name index, received ${result.reason}`);
  }
  return result;
}

function installUnicodeVersion(value: string): void {
  Object.defineProperty(process.versions, "unicode", {
    configurable: true,
    enumerable: true,
    value,
    writable: false,
  });
}

function restoreUnicodeVersion(): void {
  if (originalUnicodeDescriptor === undefined) {
    Reflect.deleteProperty(process.versions, "unicode");
  } else {
    Object.defineProperty(process.versions, "unicode", originalUnicodeDescriptor);
  }
}

function withPropertyReplacement<T>(
  target: object,
  property: PropertyKey,
  value: unknown,
  run: () => T,
): T {
  const descriptor = Object.getOwnPropertyDescriptor(target, property);
  Reflect.defineProperty(target, property, {
    configurable: true,
    value,
    writable: true,
  });
  try {
    return run();
  } finally {
    if (descriptor === undefined) {
      Reflect.deleteProperty(target, property);
    } else {
      Reflect.defineProperty(target, property, descriptor);
    }
  }
}

function withPropertyDescriptor<T>(
  target: object,
  property: PropertyKey,
  replacement: PropertyDescriptor,
  run: () => T,
): T {
  const descriptor = Object.getOwnPropertyDescriptor(target, property);
  Reflect.defineProperty(target, property, replacement);
  try {
    return run();
  } finally {
    if (descriptor === undefined) {
      Reflect.deleteProperty(target, property);
    } else {
      Reflect.defineProperty(target, property, descriptor);
    }
  }
}

function expectDeepFrozen(value: unknown, seen = new WeakSet<object>()): void {
  if ((typeof value !== "object" && typeof value !== "function") || value === null) {
    return;
  }
  if (seen.has(value)) {
    return;
  }
  seen.add(value);
  expect(Object.isFrozen(value)).toBe(true);
  expect(value).not.toBeInstanceOf(Map);
  expect(value).not.toBeInstanceOf(Set);
  for (const property of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, property);
    if (descriptor !== undefined && "value" in descriptor) {
      expectDeepFrozen(descriptor.value, seen);
    }
  }
}

function binarySorted(values: readonly string[]): string[] {
  return [...values].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
}

function permute<T>(values: readonly T[], state: number): T[] {
  const result = [...values];
  let current = state >>> 0;
  for (let index = result.length - 1; index > 0; index -= 1) {
    current = (Math.imul(current, 1_664_525) + 1_013_904_223) >>> 0;
    const other = current % (index + 1);
    const temporary = result[index] as T;
    result[index] = result[other] as T;
    result[other] = temporary;
  }
  return result;
}

describe("portable directory-name indexes", () => {
  it("builds canonical groups and de-duplicated findings in fixed priority order", () => {
    const index = successIndex([
      successProfile("å"),
      successProfile("A\u030a"),
      successProfile("Å"),
      successProfile("Å"),
      successProfile("a\u030a"),
    ]);

    expect(index).toEqual({
      ok: true,
      entries: [
        {
          exact: "A\u030a",
          exactByteLength: 3,
          nfc: "Å",
          key: "a\u030a",
          isNfc: false,
        },
        {
          exact: "a\u030a",
          exactByteLength: 3,
          nfc: "å",
          key: "a\u030a",
          isNfc: false,
        },
        { exact: "Å", exactByteLength: 2, nfc: "Å", key: "a\u030a", isNfc: true },
        { exact: "å", exactByteLength: 2, nfc: "å", key: "a\u030a", isNfc: true },
        {
          exact: "Å",
          exactByteLength: 3,
          nfc: "Å",
          key: "a\u030a",
          isNfc: false,
        },
      ],
      nfcGroups: [
        { nfc: "Å", exacts: ["A\u030a", "Å", "Å"] },
        { nfc: "å", exacts: ["a\u030a", "å"] },
      ],
      foldGroups: [
        {
          key: "a\u030a",
          nfcs: ["Å", "å"],
          exacts: ["A\u030a", "a\u030a", "Å", "å", "Å"],
        },
      ],
      findings: [
        { kind: "non_nfc", exact: "A\u030a", nfc: "Å" },
        { kind: "non_nfc", exact: "a\u030a", nfc: "å" },
        { kind: "non_nfc", exact: "Å", nfc: "Å" },
        { kind: "nfc_collision", nfc: "Å", exacts: ["A\u030a", "Å", "Å"] },
        { kind: "nfc_collision", nfc: "å", exacts: ["a\u030a", "å"] },
        {
          kind: "fixed_fold_collision",
          key: "a\u030a",
          nfcs: ["Å", "å"],
          exacts: ["A\u030a", "a\u030a", "Å", "å", "Å"],
        },
      ],
    });
    expectDeepFrozen(index);
  });

  it("suppresses fold findings that add nothing beyond one NFC collision group", () => {
    const index = successIndex([successProfile("Å"), successProfile("A\u030a")]);
    expect(index.findings).toEqual([
      { kind: "non_nfc", exact: "A\u030a", nfc: "Å" },
      { kind: "nfc_collision", nfc: "Å", exacts: ["A\u030a", "Å"] },
    ]);
    expect(index.foldGroups).toEqual([{ key: "a\u030a", nfcs: ["Å"], exacts: ["A\u030a", "Å"] }]);
  });

  it("uses binary UTF-16 order for every exposed table and finding group", () => {
    const astral = "𐀀a";
    const privateUse = "\ue000a";
    const index = successIndex([successProfile(privateUse), successProfile(astral)]);
    expect(index.entries.map((entry) => entry.exact)).toEqual([astral, privateUse]);
    expect(index.nfcGroups.map((group) => group.nfc)).toEqual([astral, privateUse]);
    expect(index.foldGroups.map((group) => group.key)).toEqual([astral, privateUse]);
    expect(binarySorted([privateUse, astral])).toEqual([astral, privateUse]);
  });

  it("is invariant under input permutations", () => {
    const profiles = [
      successProfile("ReadMe"),
      successProfile("README"),
      successProfile("readme"),
      successProfile("Å"),
      successProfile("A\u030a"),
      successProfile("å"),
      successProfile("a\u030a"),
      successProfile("Beta"),
      successProfile("beta"),
      successProfile("𐀀a"),
      successProfile("\ue000a"),
    ];
    const expected = successIndex(profiles);
    for (let seed = 1; seed <= 64; seed += 1) {
      expect(successIndex(permute(profiles, seed))).toEqual(expected);
    }
  });

  it("resolves exact, then NFC, then fold matches before missing", () => {
    const exactIndex = successIndex([
      successProfile("Å"),
      successProfile("A\u030a"),
      successProfile("å"),
    ]);
    const separateExactRequest = successProfile("Å");
    expect(lookupDirectoryName(exactIndex, separateExactRequest)).toEqual({
      ok: true,
      match: "exact",
      exacts: ["Å"],
    });

    const nfcIndex = successIndex([successProfile("A\u030a")]);
    expect(lookupDirectoryName(nfcIndex, successProfile("Å"))).toEqual({
      ok: true,
      match: "nfc",
      exacts: ["A\u030a"],
    });

    const foldIndex = successIndex([successProfile("Å")]);
    expect(lookupDirectoryName(foldIndex, successProfile("å"))).toEqual({
      ok: true,
      match: "fold",
      exacts: ["Å"],
    });
    expect(lookupDirectoryName(foldIndex, successProfile("missing"))).toEqual({
      ok: false,
      reason: "missing",
    });
    for (const prefixMiss of ["A", "åx"]) {
      expect(lookupDirectoryName(foldIndex, successProfile(prefixMiss))).toEqual({
        ok: false,
        reason: "missing",
      });
    }
    expectDeepFrozen(lookupDirectoryName(foldIndex, successProfile("å")));
    expectDeepFrozen(lookupDirectoryName(foldIndex, successProfile("missing")));
  });

  it("accepts only dense own data slots and never invokes caller getters", () => {
    const profile = successProfile("Guide.md");
    const sparse = new Array<ResourceNameProfileResult>(2);
    sparse[0] = profile;
    expect(indexDirectoryNames(sparse)).toEqual({ ok: false, reason: "invalid_input" });

    let accessorCalls = 0;
    const accessor: ResourceNameProfileResult[] = [];
    Object.defineProperty(accessor, "0", {
      configurable: true,
      get() {
        accessorCalls += 1;
        throw new Error("numeric getter was invoked");
      },
    });
    expect(indexDirectoryNames(accessor)).toEqual({ ok: false, reason: "invalid_input" });
    expect(accessorCalls).toBe(0);

    const inherited = new Array<ResourceNameProfileResult>(1);
    const prototype = Object.create(Array.prototype) as object;
    Object.defineProperty(prototype, "0", { configurable: true, value: profile });
    Object.setPrototypeOf(inherited, prototype);
    expect(indexDirectoryNames(inherited)).toEqual({ ok: false, reason: "invalid_input" });

    let descriptorCalls = 0;
    const hostile = new Proxy([profile], {
      getOwnPropertyDescriptor() {
        descriptorCalls += 1;
        throw new Error("hostile descriptor trap");
      },
    });
    expect(indexDirectoryNames(hostile)).toEqual({ ok: false, reason: "invalid_input" });
    expect(descriptorCalls).toBe(1);

    let iteratorCalls = 0;
    const nonArray = Object.create(null) as object;
    Object.defineProperty(nonArray, Symbol.iterator, {
      get() {
        iteratorCalls += 1;
        throw new Error("iterator was inspected");
      },
    });
    expect(indexDirectoryNames(nonArray)).toEqual({ ok: false, reason: "invalid_input" });
    expect(iteratorCalls).toBe(0);
  });

  it("rejects forged, cloned, proxied, and foreign-module profiles without inspection", async () => {
    const genuine = successProfile("Guide.md");
    let getterCalls = 0;
    const forged = Object.create(null) as object;
    Object.defineProperty(forged, "ok", {
      get() {
        getterCalls += 1;
        throw new Error("forged profile was inspected");
      },
    });
    for (const candidate of [
      { ...genuine },
      Object.create(genuine) as object,
      new Proxy(genuine, { get: () => throwingGetter() }),
      forged,
    ]) {
      expect(indexDirectoryNames([candidate])).toEqual({ ok: false, reason: "invalid_input" });
    }
    expect(getterCalls).toBe(0);

    vi.resetModules();
    try {
      const foreignProfiles = await import("../src/validate/resource-name-profile.js");
      const foreign = foreignProfiles.profileObservedResourceName("foreign");
      expect(indexDirectoryNames([foreign])).toEqual({ ok: false, reason: "invalid_input" });
    } finally {
      vi.resetModules();
    }
  });

  it("aggregates genuine profile failures in fixed order without retaining raw input", () => {
    const secret = "TOP_SECRET_INDEX_3f42";
    const values = [
      profileObservedResourceName(`${secret}${String.fromCodePoint(0x0378)}`),
      profileObservedResourceName(`${secret}:stream`),
      profileObservedResourceName(`${secret}\u0000`),
      profileObservedResourceName("."),
      profileObservedResourceName(`${secret}/child`),
      profileObservedResourceName("x".repeat(256)),
      profileObservedResourceName(""),
      profileObservedResourceName({ secret }),
      profileObservedResourceName(7),
      successProfile("valid-but-not-exposed"),
    ];
    const result = indexDirectoryNames(values);
    expect(result).toEqual({
      ok: false,
      reason: "profile_failures",
      failures: [
        { reason: "type", count: 2 },
        { reason: "empty", count: 1 },
        { reason: "too_large", count: 1 },
        { reason: "separator", count: 1 },
        { reason: "dot", count: 1 },
        { reason: "unsafe_unicode", count: 1 },
        { reason: "nonportable", count: 1 },
        { reason: "unassigned", count: 1 },
      ],
    });
    expect(JSON.stringify(result)).not.toContain(secret);
    expect(JSON.stringify(result)).not.toContain("valid-but-not-exposed");
    expectDeepFrozen(result);
  });

  it("makes unsupported runtime dominate other genuine profile failures", async () => {
    installUnicodeVersion("14.0");
    vi.resetModules();
    try {
      const profiles = await import("../src/validate/resource-name-profile.js");
      const indexes = await import("../src/validate/directory-name-index.js");
      const values = [
        profiles.profileObservedResourceName("safe"),
        profiles.profileObservedResourceName("/"),
        profiles.profileObservedResourceName(""),
      ];
      expect(indexes.indexDirectoryNames(values)).toEqual({
        ok: false,
        reason: "unsupported_runtime",
      });
      expect(indexes.indexDirectoryNames([values[0], { ...values[1] }])).toEqual({
        ok: false,
        reason: "invalid_input",
      });
    } finally {
      restoreUnicodeVersion();
      vi.resetModules();
    }
  });

  it("treats either repeated identity or repeated spelling as a fatal exact duplicate", () => {
    const first = successProfile("duplicate");
    const resultByIdentity = indexDirectoryNames([first, first]);
    const resultByValue = indexDirectoryNames([first, successProfile("duplicate")]);
    for (const result of [resultByIdentity, resultByValue]) {
      expect(result).toEqual({ ok: false, reason: "exact_duplicate" });
      expect(Object.keys(result).sort()).toEqual(["ok", "reason"]);
      expectDeepFrozen(result);
    }
  });

  it("enforces entry budgets before inspecting any numeric slot and groups instead of pairing", () => {
    expect(MAX_DIRECTORY_NAME_INDEX_ENTRIES).toBe(1_024);
    expect(MAX_DIRECTORY_NAME_INDEX_FINDINGS).toBe(2_048);

    const profiles: ResourceNameProfile[] = [];
    for (let index = 0; index < 512; index += 1) {
      const suffix = index.toString(16).padStart(3, "0");
      profiles[profiles.length] = successProfile(`A${suffix}`);
      profiles[profiles.length] = successProfile(`a${suffix}`);
    }
    const index = successIndex(profiles);
    expect(index.entries).toHaveLength(MAX_DIRECTORY_NAME_INDEX_ENTRIES);
    expect(index.findings).toHaveLength(512);
    expect(index.findings.every((finding) => finding.kind === "fixed_fold_collision")).toBe(true);
    expect(index.findings.length).toBeLessThan(MAX_DIRECTORY_NAME_INDEX_FINDINGS);

    let getterCalls = 0;
    const overLimit = new Array<ResourceNameProfileResult>(MAX_DIRECTORY_NAME_INDEX_ENTRIES + 1);
    Object.defineProperty(overLimit, "0", {
      configurable: true,
      get() {
        getterCalls += 1;
        throw new Error("over-limit slot was inspected");
      },
    });
    expect(indexDirectoryNames(overLimit)).toEqual({
      ok: false,
      reason: "too_many_entries",
    });
    expect(getterCalls).toBe(0);
  });

  it("copies primitives, deeply freezes output, and is detached from caller mutation", () => {
    const first = successProfile("Beta");
    const second = successProfile("alpha");
    const input: ResourceNameProfileResult[] = [first, second];
    const index = successIndex(input);
    expect(index.entries[0]).not.toBe(first);
    expect(index.entries[1]).not.toBe(second);
    const exacts = index.entries.map((entry) => entry.exact);
    input[0] = successProfile("changed");
    input.reverse();
    expect(index.entries.map((entry) => entry.exact)).toEqual(exacts);
    expect(Reflect.set(index.entries[0] as object, "exact", "changed")).toBe(false);
    expect(Reflect.set(index.entries as object, "0", {})).toBe(false);
    expectDeepFrozen(index);
  });

  it("rejects invalid lookup indexes and non-NFC, failed, forged, proxied, or foreign requests", async () => {
    const index = successIndex([successProfile("Å")]);
    const nonNfc = successProfile("A\u030a");
    const failed = profileObservedResourceName("/");
    const genuineRequest = successProfile("Å");
    const invalids = [
      undefined,
      {},
      { ...genuineRequest },
      new Proxy(genuineRequest, { get: () => throwingGetter() }),
      nonNfc,
      failed,
    ];
    for (const request of invalids) {
      expect(lookupDirectoryName(index, request)).toEqual({
        ok: false,
        reason: "invalid_request",
      });
    }
    expect(lookupDirectoryName({ ...index }, genuineRequest)).toEqual({
      ok: false,
      reason: "invalid_request",
    });
    expect(lookupDirectoryName(new Proxy(index, {}), genuineRequest)).toEqual({
      ok: false,
      reason: "invalid_request",
    });
    for (const invalidIndex of [undefined, null, 1, () => undefined]) {
      expect(lookupDirectoryName(invalidIndex, genuineRequest)).toEqual({
        ok: false,
        reason: "invalid_request",
      });
    }

    vi.resetModules();
    try {
      const foreignProfiles = await import("../src/validate/resource-name-profile.js");
      const foreignIndexes = await import("../src/validate/directory-name-index.js");
      const foreignRequest = foreignProfiles.profileObservedResourceName("Å");
      const foreignIndex = foreignIndexes.indexDirectoryNames([foreignRequest]);
      expect(lookupDirectoryName(index, foreignRequest)).toEqual({
        ok: false,
        reason: "invalid_request",
      });
      expect(lookupDirectoryName(foreignIndex, genuineRequest)).toEqual({
        ok: false,
        reason: "invalid_request",
      });
      expect(foreignIndexes.lookupDirectoryName(index, foreignRequest)).toEqual({
        ok: false,
        reason: "invalid_request",
      });
    } finally {
      vi.resetModules();
    }
  });

  it("uses captured intrinsics and no caller iterators after module initialization", () => {
    const profiles = [successProfile("ReadMe"), successProfile("README")];
    const request = successProfile("readme");
    const throwing = () => {
      throw new Error("live intrinsic was used");
    };
    const probes = [
      withPropertyReplacement(Array, "isArray", throwing, () => indexDirectoryNames(profiles)),
      withPropertyReplacement(Array.prototype, "sort", throwing, () =>
        indexDirectoryNames(profiles),
      ),
      withPropertyReplacement(Array.prototype, Symbol.iterator, throwing, () =>
        indexDirectoryNames(profiles),
      ),
      withPropertyReplacement(String.prototype, "charCodeAt", throwing, () =>
        indexDirectoryNames(profiles),
      ),
      withPropertyReplacement(Object, "defineProperty", throwing, () =>
        indexDirectoryNames(profiles),
      ),
      withPropertyReplacement(Object, "freeze", throwing, () => indexDirectoryNames(profiles)),
      withPropertyReplacement(Object, "getOwnPropertyDescriptor", throwing, () =>
        indexDirectoryNames(profiles),
      ),
      withPropertyReplacement(Number, "isSafeInteger", throwing, () =>
        indexDirectoryNames(profiles),
      ),
      withPropertyReplacement(WeakSet.prototype, "add", throwing, () =>
        indexDirectoryNames(profiles),
      ),
      withPropertyReplacement(Reflect, "apply", throwing, () => indexDirectoryNames(profiles)),
      withPropertyReplacement(globalThis, "String", throwing, () => indexDirectoryNames(profiles)),
    ];
    for (const result of probes) {
      expect(result.ok).toBe(true);
      expectDeepFrozen(result);
    }

    let numericSetterCalls = 0;
    const prototypePollutionProbe = withPropertyDescriptor(
      Array.prototype,
      "0",
      {
        configurable: true,
        set() {
          numericSetterCalls += 1;
          throw new Error("inherited numeric setter was invoked");
        },
      },
      () => ({
        failure: indexDirectoryNames([profileObservedResourceName("/")]),
        success: indexDirectoryNames(profiles),
      }),
    );
    expect(prototypePollutionProbe.success.ok).toBe(true);
    expect(prototypePollutionProbe.failure).toEqual({
      ok: false,
      reason: "profile_failures",
      failures: [{ reason: "separator", count: 1 }],
    });
    expect(numericSetterCalls).toBe(0);

    const index = successIndex(profiles);
    expect(
      withPropertyReplacement(
        WeakSet.prototype,
        "has",
        () => false,
        () => lookupDirectoryName(index, request),
      ),
    ).toEqual({ ok: true, match: "fold", exacts: ["README", "ReadMe"] });
  });

  it("contains no filesystem, host Unicode, iterator, insertion-order, or live sort shortcuts", async () => {
    const source = await readFile(
      new URL("src/validate/directory-name-index.ts", repositoryRoot),
      "utf8",
    );
    for (const fragment of [
      "node:fs",
      "readdir",
      `locale${"Compare"}`,
      `to${"Lower"}Case`,
      `to${"Upper"}Case`,
      `norma${"lize"}`,
      "new Map",
      "new Set",
      ".sort(",
      "[Symbol.iterator]",
    ]) {
      expect(source).not.toContain(fragment);
    }
    expect(source).not.toMatch(/\bfor\s*\([^)]*\bof\b/gu);
    expect(source).toContain("Array.prototype.sort");
    expect(source).toContain("Object.defineProperty");
    expect(source).toContain("Object.getOwnPropertyDescriptor");
    expect(source).toContain("WeakSet.prototype.has");

    const rootSource = await readFile(new URL("src/index.ts", repositoryRoot), "utf8");
    const rootDeclaration = await readFile(new URL("dist/index.d.ts", repositoryRoot), "utf8");
    for (const root of [rootSource, rootDeclaration]) {
      expect(root).not.toContain("directory-name-index");
      expect(root).not.toContain("indexDirectoryNames");
      expect(root).not.toContain("lookupDirectoryName");
      expect(root).not.toContain("MAX_DIRECTORY_NAME_INDEX");
    }
  });
});

function throwingGetter(): never {
  throw new Error("caller proxy was inspected");
}
