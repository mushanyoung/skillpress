import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import { describe, expect, it, vi } from "vitest";

import { isAssignedScalarUnicode15_1 } from "../src/validate/generated-unicode.js";
import {
  portableFilenameKey,
  projectNfcWithVerifiedRuntime,
  type PortableFilenameKeyResult,
} from "../src/validate/unicode-portability.js";

const repositoryRoot = new URL("../", import.meta.url);
const MAX_CODE_POINT = 0x10ffff;
const nativeNormalize = String.prototype.normalize;
const originalUnicodeDescriptor = Object.getOwnPropertyDescriptor(process.versions, "unicode");
const originalNormalizeDescriptor = Object.getOwnPropertyDescriptor(String.prototype, "normalize");

type PortabilityModule = typeof import("../src/validate/unicode-portability.js");
type NormalizeFunction = typeof String.prototype.normalize;

function successfulKey(value: string): string {
  const result = portableFilenameKey(value);
  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw new Error(`Expected a portable key, received ${result.reason}`);
  }
  expect(Object.isFrozen(result)).toBe(true);
  return result.key;
}

function installUnicodeVersion(value: string | undefined): void {
  if (value === undefined) {
    Reflect.deleteProperty(process.versions, "unicode");
    return;
  }
  Object.defineProperty(process.versions, "unicode", {
    configurable: true,
    enumerable: true,
    value,
    writable: false,
  });
}

function installNormalize(value: NormalizeFunction): void {
  Object.defineProperty(String.prototype, "normalize", {
    configurable: true,
    enumerable: false,
    value,
    writable: true,
  });
}

function restoreRuntimeProperties(): void {
  if (originalUnicodeDescriptor === undefined) {
    Reflect.deleteProperty(process.versions, "unicode");
  } else {
    Object.defineProperty(process.versions, "unicode", originalUnicodeDescriptor);
  }
  if (originalNormalizeDescriptor !== undefined) {
    Object.defineProperty(String.prototype, "normalize", originalNormalizeDescriptor);
  }
}

function withPropertyReplacement<T>(
  target: object,
  property: PropertyKey,
  value: unknown,
  run: () => T,
): T {
  const descriptor = Object.getOwnPropertyDescriptor(target, property);
  Object.defineProperty(target, property, {
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
      Object.defineProperty(target, property, descriptor);
    }
  }
}

async function withRuntimeSnapshot(
  unicodeVersion: string | undefined,
  normalize: NormalizeFunction,
  inspect: (module: PortabilityModule) => void | Promise<void>,
): Promise<void> {
  installUnicodeVersion(unicodeVersion);
  installNormalize(normalize);
  vi.resetModules();
  try {
    const module = await import("../src/validate/unicode-portability.js");
    await inspect(module);
  } finally {
    restoreRuntimeProperties();
    vi.resetModules();
  }
}

function hostileInput(): string {
  const value = Object.create(null) as object;
  Object.defineProperty(value, Symbol.iterator, {
    get() {
      throw new Error("input was inspected");
    },
  });
  return value as string;
}

describe("portable Unicode 15.1 filename keys", () => {
  it("folds common, full, contextual, and script-specific case pairs", () => {
    expect(successfulKey("ReadMe")).toBe("readme");
    expect(successfulKey("Straße")).toBe("strasse");
    expect(successfulKey("STRASSE")).toBe("strasse");
    expect(successfulKey("ΟΣ")).toBe("οσ");
    expect(successfulKey("οσ")).toBe("οσ");
    expect(successfulKey("ος")).toBe("οσ");
    expect(successfulKey("ﬃ")).toBe("ffi");
    expect(successfulKey("İ")).toBe("i\u0307");
    expect(successfulKey("i\u0307")).toBe("i\u0307");
    expect(successfulKey("I")).toBe("i");
    expect(successfulKey("ı")).toBe("ı");
    expect(successfulKey("I")).not.toBe(successfulKey("ı"));
    expect(successfulKey("Ꭰ")).toBe("Ꭰ");
    expect(successfulKey("ꭰ")).toBe("Ꭰ");
  });

  it("uses canonical decomposition without compatibility folding", () => {
    expect(successfulKey("é")).toBe("e\u0301");
    expect(successfulKey("가")).toBe("\u1100\u1161");
    expect(successfulKey("Ａ")).toBe("ａ");
    expect(successfulKey("A")).toBe("a");
    expect(successfulKey("Ａ")).not.toBe(successfulKey("A"));

    const d145Key = "α\u0313\u0302ι";
    expect(successfulKey("\u1f80\u0302")).toBe(d145Key);
    expect(successfulKey("\u1f88\u0302")).toBe(d145Key);

    const iotaKey = "ι\u0308\u0301";
    expect(successfulKey("\u0390")).toBe(iotaKey);
    expect(successfulKey("\u03aa\u0301")).toBe(iotaKey);
  });

  it("accepts the Unicode 15.1 boundary and rejects later assignments and gaps", () => {
    for (const codePoint of [0x2ffc, 0x2ebf0, 0x2ee5d]) {
      const value = String.fromCodePoint(codePoint);
      expect(successfulKey(value)).toBe(value);
    }

    for (const codePoint of [0x1c89, 0xa7cb, 0x10d50, 0x378, 0x2ee5e]) {
      expect(portableFilenameKey(String.fromCodePoint(codePoint))).toEqual({
        ok: false,
        reason: "unassigned",
      });
    }
    for (const surrogate of ["\ud800", "\udfff", "\ud800A"]) {
      expect(portableFilenameKey(surrogate)).toEqual({ ok: false, reason: "unassigned" });
    }

    expect(portableFilenameKey(String.fromCodePoint(0x105c9))).toEqual({
      ok: false,
      reason: "unassigned",
    });
    expect(portableFilenameKey(`${String.fromCodePoint(0x897)}\u0323`)).toEqual({
      ok: false,
      reason: "unassigned",
    });
  });

  it("rejects non-NFC input after applying the assignment gate", () => {
    for (const value of ["e\u0301", "\u1100\u1161", "A\u030a", "\u212a", "\u1fd3"]) {
      expect(portableFilenameKey(value)).toEqual({ ok: false, reason: "non_nfc" });
    }
    expect(portableFilenameKey(`e\u0301${String.fromCodePoint(0x378)}`)).toEqual({
      ok: false,
      reason: "unassigned",
    });
  });

  it("projects NFC through the same verified captured normalizer", () => {
    expect(projectNfcWithVerifiedRuntime("e\u0301")).toBe("é");
    expect(projectNfcWithVerifiedRuntime("\u1100\u1161")).toBe("가");
    expect(projectNfcWithVerifiedRuntime("already-nfc")).toBe("already-nfc");

    let projected: string | undefined;
    installNormalize(() => {
      throw new Error("prototype changed after module initialization");
    });
    try {
      projected = projectNfcWithVerifiedRuntime("e\u0301");
    } finally {
      restoreRuntimeProperties();
    }
    expect(projected).toBe("é");
  });

  it("returns frozen deterministic shapes without retaining rejected input", () => {
    const empty = portableFilenameKey("");
    const successAgain = portableFilenameKey("");
    expect(empty).toEqual({ ok: true, key: "" });
    expect(successAgain).toEqual(empty);
    expect(Object.isFrozen(empty)).toBe(true);
    expect(Reflect.set(empty, "key", "changed")).toBe(false);

    const secret = "secret-e\u0301";
    const nonNfc = portableFilenameKey(secret);
    const nonNfcAgain = portableFilenameKey(secret);
    expect(nonNfcAgain).toBe(nonNfc);
    expect(Object.isFrozen(nonNfc)).toBe(true);
    expect(Object.keys(nonNfc).sort()).toEqual(["ok", "reason"]);
    expect(JSON.stringify(nonNfc)).not.toContain(secret);

    const unassignedInput = `secret-${String.fromCodePoint(0x378)}`;
    const unassigned = portableFilenameKey(unassignedInput);
    expect(portableFilenameKey(unassignedInput)).toBe(unassigned);
    expect(Object.isFrozen(unassigned)).toBe(true);
    expect(Object.keys(unassigned).sort()).toEqual(["ok", "reason"]);
    expect(JSON.stringify(unassigned)).not.toContain("secret");
  });

  it("accepts strict runtime Unicode tuples at and above 15.1", async () => {
    for (const version of ["15.1", "15.1.0", "16.0"]) {
      await withRuntimeSnapshot(version, nativeNormalize, (module) => {
        expect(module.portableFilenameKey("ReadMe")).toEqual({ ok: true, key: "readme" });
      });
    }
  });

  it("fails closed before inspecting input on missing, malformed, or old Unicode versions", async () => {
    const versions = [
      undefined,
      "",
      "14.0",
      "15",
      "15.1 ",
      "015.1",
      "15.-1",
      "1e2.0",
      "9007199254740992.0",
    ];
    for (const version of versions) {
      let normalizationCalls = 0;
      const countingNormalize: NormalizeFunction = function (form) {
        normalizationCalls += 1;
        return Reflect.apply(nativeNormalize, this, [form]) as string;
      };
      await withRuntimeSnapshot(version, countingNormalize, (module) => {
        const result = module.portableFilenameKey(hostileInput());
        expect(result).toEqual({ ok: false, reason: "unsupported_runtime" });
        expect(module.portableFilenameKey(hostileInput())).toBe(result);
        expect(Object.isFrozen(result)).toBe(true);
        expect(Object.keys(result).sort()).toEqual(["ok", "reason"]);
        expect(normalizationCalls).toBe(0);
      });
    }
  });

  it("fails closed when NFC or NFD behavior is unavailable or incorrect", async () => {
    let noOpCalls = 0;
    const noOpNormalize: NormalizeFunction = function () {
      noOpCalls += 1;
      return String(this);
    };
    await withRuntimeSnapshot("15.1", noOpNormalize, (module) => {
      const callsAfterSentinel = noOpCalls;
      expect(module.portableFilenameKey(hostileInput())).toEqual({
        ok: false,
        reason: "unsupported_runtime",
      });
      expect(callsAfterSentinel).toBe(1);
      expect(noOpCalls).toBe(callsAfterSentinel);
    });

    let wrongCalls = 0;
    const wrongNormalize: NormalizeFunction = function (form) {
      wrongCalls += 1;
      const value = String(this);
      if (value === "\u00c5" && form === "NFD") {
        return "A\u030a";
      }
      return value;
    };
    await withRuntimeSnapshot("15.1.0", wrongNormalize, (module) => {
      const callsAfterSentinel = wrongCalls;
      expect(module.portableFilenameKey(hostileInput())).toEqual({
        ok: false,
        reason: "unsupported_runtime",
      });
      expect(callsAfterSentinel).toBe(2);
      expect(wrongCalls).toBe(callsAfterSentinel);
    });

    let thrownCalls = 0;
    const throwingNormalize: NormalizeFunction = () => {
      thrownCalls += 1;
      throw new Error("normalization unavailable");
    };
    await withRuntimeSnapshot("17.0", throwingNormalize, (module) => {
      const callsAfterSentinel = thrownCalls;
      expect(module.portableFilenameKey(hostileInput())).toEqual({
        ok: false,
        reason: "unsupported_runtime",
      });
      expect(callsAfterSentinel).toBe(1);
      expect(thrownCalls).toBe(callsAfterSentinel);
    });
  });

  it("continues through the normalization function verified at module load", () => {
    let noOpResult: PortableFilenameKeyResult;
    installNormalize(function () {
      return String(this);
    });
    try {
      noOpResult = portableFilenameKey("É");
    } finally {
      restoreRuntimeProperties();
    }
    expect(noOpResult).toEqual({ ok: true, key: "e\u0301" });

    let throwingResult: PortableFilenameKeyResult;
    installNormalize(() => {
      throw new Error("prototype changed after module initialization");
    });
    try {
      throwingResult = portableFilenameKey("É");
    } finally {
      restoreRuntimeProperties();
    }
    expect(throwingResult).toEqual({ ok: true, key: "e\u0301" });
  });

  it("uses captured intrinsics after module initialization", () => {
    const runArrayIteratorProbe = () => ({
      rejected: portableFilenameKey(String.fromCodePoint(0x378)),
      success: portableFilenameKey("ReadMe"),
    });
    const throwingArrayIteratorResult = withPropertyReplacement(
      Array.prototype,
      Symbol.iterator,
      () => {
        throw new Error("array iterator was used");
      },
      runArrayIteratorProbe,
    );
    expect(throwingArrayIteratorResult).toEqual({
      rejected: { ok: false, reason: "unassigned" },
      success: { ok: true, key: "readme" },
    });

    const emptyArrayIteratorResult = withPropertyReplacement(
      Array.prototype,
      Symbol.iterator,
      () => ({ next: () => ({ done: true, value: undefined }) }),
      runArrayIteratorProbe,
    );
    expect(emptyArrayIteratorResult).toEqual({
      rejected: { ok: false, reason: "unassigned" },
      success: { ok: true, key: "readme" },
    });

    const emptyIteratorResult = withPropertyReplacement(
      String.prototype,
      Symbol.iterator,
      () => ({ next: () => ({ done: true, value: undefined }) }),
      () => portableFilenameKey(String.fromCodePoint(0x378)),
    );
    expect(emptyIteratorResult).toEqual({ ok: false, reason: "unassigned" });

    const codePointAtResult = withPropertyReplacement(
      String.prototype,
      "codePointAt",
      () => 0x41,
      () => portableFilenameKey(String.fromCodePoint(0x378)),
    );
    expect(codePointAtResult).toEqual({ ok: false, reason: "unassigned" });

    const charCodeAtResult = withPropertyReplacement(
      String.prototype,
      "charCodeAt",
      () => 0x41,
      () => portableFilenameKey(String.fromCodePoint(0x378)),
    );
    expect(charCodeAtResult).toEqual({ ok: false, reason: "unassigned" });

    const fromCodePointResult = withPropertyReplacement(
      String,
      "fromCodePoint",
      () => "polluted",
      () => portableFilenameKey("Ā"),
    );
    expect(fromCodePointResult).toEqual({ ok: true, key: "a\u0304" });

    const applyResult = withPropertyReplacement(
      Reflect,
      "apply",
      () => {
        throw new Error("live Reflect.apply was used");
      },
      () => portableFilenameKey("É"),
    );
    expect(applyResult).toEqual({ ok: true, key: "e\u0301" });

    const freezeResult = withPropertyReplacement(
      Object,
      "freeze",
      () => {
        throw new Error("live Object.freeze was used");
      },
      () => portableFilenameKey("ReadMe"),
    );
    expect(freezeResult).toEqual({ ok: true, key: "readme" });
    expect(Object.isFrozen(freezeResult)).toBe(true);
  });

  it("locks every code-point outcome, key bytes, and output assignment", () => {
    const semanticHash = createHash("sha256");
    const header = Buffer.allocUnsafe(9);
    const counts = { ok: 0, non_nfc: 0, unassigned: 0 };
    let unsupportedCount = 0;
    let unassignedKeyScalarCount = 0;
    let firstUnassignedKeyScalar:
      | { readonly source: number; readonly keyScalar: number }
      | undefined;
    let unfrozenCount = 0;

    for (let codePoint = 0; codePoint <= MAX_CODE_POINT; codePoint += 1) {
      const result = portableFilenameKey(String.fromCodePoint(codePoint));
      if (!Object.isFrozen(result)) {
        unfrozenCount += 1;
      }

      let tag: number;
      let key = "";
      if (result.ok) {
        counts.ok += 1;
        tag = 0;
        key = result.key;
        for (const character of key) {
          const keyScalar = character.codePointAt(0) as number;
          if (!isAssignedScalarUnicode15_1(keyScalar)) {
            unassignedKeyScalarCount += 1;
            firstUnassignedKeyScalar ??= { source: codePoint, keyScalar };
          }
        }
      } else if (result.reason === "non_nfc") {
        counts.non_nfc += 1;
        tag = 1;
      } else if (result.reason === "unassigned") {
        counts.unassigned += 1;
        tag = 2;
      } else {
        unsupportedCount += 1;
        tag = 3;
      }

      const keyBytes = Buffer.from(key, "utf8");
      header.writeUInt32BE(codePoint, 0);
      header[4] = tag;
      header.writeUInt32BE(keyBytes.byteLength, 5);
      semanticHash.update(header);
      semanticHash.update(keyBytes);
    }

    expect(counts).toEqual({ ok: 286_292, non_nfc: 1_120, unassigned: 826_700 });
    expect(unsupportedCount).toBe(0);
    expect(unfrozenCount).toBe(0);
    expect({ count: unassignedKeyScalarCount, first: firstUnassignedKeyScalar }).toEqual({
      count: 0,
      first: undefined,
    });
    expect(semanticHash.digest("hex")).toBe(
      "fba04af3aa1854d8213213787e58877764ec3131041f251d29fb396fb96319a9",
    );
  }, 30_000);

  it("uses only the pinned normalization forms and no host casing or locale behavior", async () => {
    const source = await readFile(
      new URL("src/validate/unicode-portability.ts", repositoryRoot),
      "utf8",
    );
    const forbiddenFragments = [
      `to${"Lower"}Case`,
      `to${"Upper"}Case`,
      `locale${"Compare"}`,
      `toLocale${"Lower"}Case`,
      `toLocale${"Upper"}Case`,
      `${"Int"}l`,
      `NF${"KC"}`,
      `NF${"KD"}`,
    ];
    for (const fragment of forbiddenFragments) {
      expect(source).not.toContain(fragment);
    }

    const formArguments = Array.from(
      source.matchAll(/\bnormalize\([^,\n]+,\s*"([^"]+)"\)/gu),
      (match) => match[1],
    );
    expect(formArguments).toEqual(["NFD", "NFC", "NFC", "NFC", "NFD", "NFD"]);
    expect(source.match(/\bnormalize\(/gu)).toHaveLength(formArguments.length + 1);
    expect(source).not.toContain(".codePointAt(");
    expect(source).not.toContain("for (const character of value)");
    expect(source).not.toContain("Reflect.apply(");
    expect(source).not.toContain("Object.freeze(");
    expect(source).not.toContain("[Symbol.iterator]");
    expect(source).not.toMatch(/\bfor\s*\([^)]*\bof\b/gu);
  });
});
