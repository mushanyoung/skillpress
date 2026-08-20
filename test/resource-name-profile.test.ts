import { Buffer } from "node:buffer";
import { readFile } from "node:fs/promises";

import { describe, expect, it, vi } from "vitest";

import {
  isAssignedScalarUnicode15_1,
  isDefaultIgnorableCodePointUnicode15_1,
} from "../src/validate/generated-unicode.js";
import {
  isResourceNameProfileResult,
  MAX_RESOURCE_NAME_BYTES,
  profileObservedResourceName,
} from "../src/validate/resource-name-profile.js";

const repositoryRoot = new URL("../", import.meta.url);
const nativeNormalize = String.prototype.normalize;
const originalUnicodeDescriptor = Object.getOwnPropertyDescriptor(process.versions, "unicode");
const originalNormalizeDescriptor = Object.getOwnPropertyDescriptor(String.prototype, "normalize");

type NormalizeFunction = typeof String.prototype.normalize;
type ResourceNameProfileModule = typeof import("../src/validate/resource-name-profile.js");

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

async function withRuntimeSnapshot(
  unicodeVersion: string | undefined,
  normalize: NormalizeFunction,
  inspect: (module: ResourceNameProfileModule) => void | Promise<void>,
): Promise<void> {
  installUnicodeVersion(unicodeVersion);
  installNormalize(normalize);
  vi.resetModules();
  try {
    const module = await import("../src/validate/resource-name-profile.js");
    await inspect(module);
  } finally {
    restoreRuntimeProperties();
    vi.resetModules();
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

function success(value: string) {
  const result = profileObservedResourceName(value);
  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw new Error(`Expected a resource-name profile, received ${result.reason}`);
  }
  return result;
}

describe("portable observed resource-name profiles", () => {
  it("returns exact, NFC, byte-length, and full-fold projections", () => {
    expect(success("ReadMe.md")).toEqual({
      ok: true,
      exact: "ReadMe.md",
      exactByteLength: 9,
      nfc: "ReadMe.md",
      key: "readme.md",
      isNfc: true,
    });
    expect(success("Straße.txt").key).toBe("strasse.txt");
    expect(success("ﬃ.txt").key).toBe("ffi.txt");
    expect(success("Ꭰ.txt").key).toBe(success("ꭰ.txt").key);
    expect(success("Ａ.txt").key).toBe("ａ.txt");
    expect(success("Ａ.txt").key).not.toBe(success("A.txt").key);
  });

  it("accepts non-NFC observations while retaining an explicit NFC projection", () => {
    expect(success("e\u0301.txt")).toEqual({
      ok: true,
      exact: "e\u0301.txt",
      exactByteLength: 7,
      nfc: "é.txt",
      key: "e\u0301.txt",
      isNfc: false,
    });
    expect(success("\u1100\u1161.txt")).toEqual({
      ok: true,
      exact: "\u1100\u1161.txt",
      exactByteLength: 10,
      nfc: "가.txt",
      key: "\u1100\u1161.txt",
      isNfc: false,
    });
    expect(success("é.txt").key).toBe(success("e\u0301.txt").key);
    expect(success("가.txt").key).toBe(success("\u1100\u1161.txt").key);
  });

  it("applies exact UTF-8 byte boundaries after a cheap UTF-16 cap", () => {
    const exactAscii = "a".repeat(MAX_RESOURCE_NAME_BYTES);
    expect(success(exactAscii).exactByteLength).toBe(MAX_RESOURCE_NAME_BYTES);
    expect(profileObservedResourceName(`${exactAscii}a`)).toEqual({
      ok: false,
      reason: "too_large",
    });

    const exactMultibyte = `${"😀".repeat(63)}aaa`;
    expect(Buffer.byteLength(exactMultibyte, "utf8")).toBe(MAX_RESOURCE_NAME_BYTES);
    expect(success(exactMultibyte).exactByteLength).toBe(MAX_RESOURCE_NAME_BYTES);
    expect(profileObservedResourceName("😀".repeat(64))).toEqual({
      ok: false,
      reason: "too_large",
    });

    for (const exact of [`${"é".repeat(127)}a`, `${"İ".repeat(127)}a`]) {
      const profile = success(exact);
      expect(profile.exactByteLength).toBe(MAX_RESOURCE_NAME_BYTES);
      expect(Buffer.byteLength(profile.key, "utf8")).toBe(382);
    }
    const exactNonNfc = "e\u0301".repeat(85);
    const nonNfcProfile = success(exactNonNfc);
    expect(nonNfcProfile.exactByteLength).toBe(MAX_RESOURCE_NAME_BYTES);
    expect(Buffer.byteLength(nonNfcProfile.nfc, "utf8")).toBe(170);
    expect(Buffer.byteLength(nonNfcProfile.key, "utf8")).toBe(MAX_RESOURCE_NAME_BYTES);
    expect(nonNfcProfile.isNfc).toBe(false);
  });

  it("rejects structural aliases in the documented order", () => {
    const hostileObject = Object.create(null) as object;
    for (const property of ["toString", "valueOf", Symbol.toPrimitive, Symbol.iterator]) {
      Object.defineProperty(hostileObject, property, {
        get() {
          throw new Error("input was coerced or inspected");
        },
      });
    }
    for (const value of [undefined, null, 7, Symbol("name"), hostileObject]) {
      expect(profileObservedResourceName(value)).toEqual({ ok: false, reason: "type" });
    }
    expect(profileObservedResourceName("")).toEqual({ ok: false, reason: "empty" });
    expect(profileObservedResourceName(`${"a".repeat(MAX_RESOURCE_NAME_BYTES)}\ud800/`)).toEqual({
      ok: false,
      reason: "too_large",
    });
    for (const value of ["/", "\\", "a/b", "a\\b", "../child"]) {
      expect(profileObservedResourceName(value)).toEqual({ ok: false, reason: "separator" });
    }
    for (const value of [".", ".."]) {
      expect(profileObservedResourceName(value)).toEqual({ ok: false, reason: "dot" });
    }
    expect(success(".hidden").exact).toBe(".hidden");
  });

  it("rejects every assigned control, separator control, and Unicode noncharacter", () => {
    const controls = [
      ...Array.from({ length: 0x20 }, (_, codePoint) => codePoint),
      ...Array.from({ length: 0x21 }, (_, offset) => 0x7f + offset),
      0x2028,
      0x2029,
    ];
    const noncharacters = [
      ...Array.from({ length: 0x20 }, (_, offset) => 0xfdd0 + offset),
      ...Array.from({ length: 17 }, (_, plane) => plane * 0x1_0000 + 0xfffe),
      ...Array.from({ length: 17 }, (_, plane) => plane * 0x1_0000 + 0xffff),
    ];
    expect(noncharacters).toHaveLength(66);
    for (const codePoint of [...controls, ...noncharacters]) {
      expect(profileObservedResourceName(`a${String.fromCodePoint(codePoint)}b`)).toEqual({
        ok: false,
        reason: "unsafe_unicode",
      });
    }
  });

  it("classifies every pinned default-ignorable and rejects malformed or later scalars", () => {
    let fullDefaultIgnorableCount = 0;
    let assignedDefaultIgnorableCount = 0;
    for (let codePoint = 0; codePoint <= 0x10ffff; codePoint += 1) {
      if (!isDefaultIgnorableCodePointUnicode15_1(codePoint)) {
        continue;
      }
      fullDefaultIgnorableCount += 1;
      const assigned = isAssignedScalarUnicode15_1(codePoint);
      if (assigned) {
        assignedDefaultIgnorableCount += 1;
      }
      expect(profileObservedResourceName(`a${String.fromCodePoint(codePoint)}b`)).toEqual({
        ok: false,
        reason: assigned ? "unsafe_unicode" : "unassigned",
      });
    }
    expect({ fullDefaultIgnorableCount, assignedDefaultIgnorableCount }).toEqual({
      fullDefaultIgnorableCount: 4_174,
      assignedDefaultIgnorableCount: 405,
    });

    for (let codePoint = 0xd800; codePoint <= 0xdfff; codePoint += 1) {
      expect(profileObservedResourceName(`a${String.fromCharCode(codePoint)}b`)).toEqual({
        ok: false,
        reason: "unassigned",
      });
    }
    for (const codePoint of [0x0378, 0x1c89, 0xa7cb, 0x10d50, 0x105c9, 0x2ee5e]) {
      expect(profileObservedResourceName(`a${String.fromCodePoint(codePoint)}b`)).toEqual({
        ok: false,
        reason: "unassigned",
      });
    }
    expect(profileObservedResourceName(`\u0000${String.fromCodePoint(0x0378)}`)).toEqual({
      ok: false,
      reason: "unassigned",
    });
  }, 30_000);

  it("rejects Windows syntax and case-folded reserved device keys", () => {
    for (const character of ["<", ">", '"', ":", "|", "?", "*"]) {
      expect(profileObservedResourceName(`a${character}b`)).toEqual({
        ok: false,
        reason: "nonportable",
      });
    }
    for (const value of ["trailing.", "trailing "]) {
      expect(profileObservedResourceName(value)).toEqual({ ok: false, reason: "nonportable" });
    }
    for (const value of [
      "CON",
      "con.txt",
      "PrN",
      "AUX.log",
      "NUL",
      "CLOCK$",
      "CLOC\u212a$.txt",
      "CONIN$",
      "CONOUT$.txt",
      "COM1",
      "com9.log",
      "LPT1",
      "lpt9.log",
      "COM¹",
      "COM².txt",
      "COM³",
      "LPT¹",
      "LPT².txt",
      "LPT³",
    ]) {
      expect(profileObservedResourceName(value)).toEqual({ ok: false, reason: "nonportable" });
    }
    for (const value of [
      "COM0",
      "COM10",
      "COM⁴",
      "LPT0",
      "CONSOLE",
      "xCON",
      "CLOCK",
      "ＣＯＮ",
      "leading space",
    ]) {
      expect(success(value).exact).toBe(value);
    }
  });

  it("fails closed for unsupported and adversarial normalization runtimes", async () => {
    await withRuntimeSnapshot("14.0", nativeNormalize, (module) => {
      expect(module.profileObservedResourceName(7)).toEqual({ ok: false, reason: "type" });
      expect(module.profileObservedResourceName("")).toEqual({ ok: false, reason: "empty" });
      expect(module.profileObservedResourceName("a".repeat(256))).toEqual({
        ok: false,
        reason: "too_large",
      });
      expect(module.profileObservedResourceName("/")).toEqual({
        ok: false,
        reason: "separator",
      });
      expect(module.profileObservedResourceName(".")).toEqual({ ok: false, reason: "dot" });
      expect(module.profileObservedResourceName("safe")).toEqual({
        ok: false,
        reason: "unsupported_runtime",
      });
      const unsupported = module.profileObservedResourceName("TOP_SECRET_UNSUPPORTED");
      expect(Object.isFrozen(unsupported)).toBe(true);
      expect(Object.keys(unsupported).sort()).toEqual(["ok", "reason"]);
      expect(JSON.stringify(unsupported)).not.toContain("TOP_SECRET_UNSUPPORTED");
      expect(module.isResourceNameProfileResult(unsupported)).toBe(true);
    });

    const sentinelOnlyNormalize: NormalizeFunction = function (form) {
      const value = String(this);
      if (value === "Å" && form === "NFD") return "A\u030a";
      if (value === "A\u030a" && form === "NFC") return "Å";
      throw new Error("normalization failed after the sentinel");
    };
    await withRuntimeSnapshot("15.1", sentinelOnlyNormalize, (module) => {
      expect(module.profileObservedResourceName("safe")).toEqual({
        ok: false,
        reason: "unsupported_runtime",
      });
    });

    const nonStringProjection: NormalizeFunction = function (form) {
      const value = String(this);
      if (value === "Å" && form === "NFD") return "A\u030a";
      if (value === "A\u030a" && form === "NFC") return "Å";
      if (value === "e\u0301" && form === "NFC") return 7 as unknown as string;
      return Reflect.apply(nativeNormalize, this, [form]) as string;
    };
    await withRuntimeSnapshot("15.1", nonStringProjection, (module) => {
      expect(module.profileObservedResourceName("e\u0301")).toEqual({
        ok: false,
        reason: "unsupported_runtime",
      });
    });

    const invalidProjection: NormalizeFunction = function (form) {
      const value = String(this);
      if (value === "Å" && form === "NFD") return "A\u030a";
      if (value === "A\u030a" && form === "NFC") return "Å";
      if (value === "e\u0301" && form === "NFC") return String.fromCodePoint(0x0378);
      return Reflect.apply(nativeNormalize, this, [form]) as string;
    };
    await withRuntimeSnapshot("15.1", invalidProjection, (module) => {
      expect(module.profileObservedResourceName("e\u0301")).toEqual({
        ok: false,
        reason: "unsupported_runtime",
      });
    });
  });

  it("reuses the previously verified portability normalizer after later pollution", async () => {
    installUnicodeVersion("15.1");
    installNormalize(nativeNormalize);
    vi.resetModules();
    try {
      await import("../src/validate/unicode-portability.js");
      installNormalize(() => {
        throw new Error("resource-name profiling captured a polluted normalizer");
      });
      const module = await import("../src/validate/resource-name-profile.js");
      expect(module.profileObservedResourceName("e\u0301.txt")).toEqual({
        ok: true,
        exact: "e\u0301.txt",
        exactByteLength: 7,
        nfc: "é.txt",
        key: "e\u0301.txt",
        isNfc: false,
      });
    } finally {
      restoreRuntimeProperties();
      vi.resetModules();
    }
  });

  it("uses captured intrinsics after module initialization", () => {
    const throwing = () => {
      throw new Error("live intrinsic was used");
    };
    const probes = [
      withPropertyReplacement(Buffer, "byteLength", throwing, () =>
        profileObservedResourceName("ReadMe"),
      ),
      withPropertyReplacement(String.prototype, "charCodeAt", throwing, () =>
        profileObservedResourceName("ReadMe"),
      ),
      withPropertyReplacement(String.prototype, "codePointAt", throwing, () =>
        profileObservedResourceName("ReadMe"),
      ),
      withPropertyReplacement(Array.prototype, Symbol.iterator, throwing, () =>
        profileObservedResourceName("ReadMe"),
      ),
      withPropertyReplacement(String.prototype, Symbol.iterator, throwing, () =>
        profileObservedResourceName("ReadMe"),
      ),
      withPropertyReplacement(RegExp.prototype, "test", throwing, () =>
        profileObservedResourceName("ReadMe"),
      ),
      withPropertyReplacement(RegExp.prototype, "exec", throwing, () =>
        profileObservedResourceName("ReadMe"),
      ),
      withPropertyReplacement(Object, "freeze", throwing, () =>
        profileObservedResourceName("ReadMe"),
      ),
      withPropertyReplacement(WeakSet.prototype, "add", throwing, () =>
        profileObservedResourceName("ReadMe"),
      ),
      withPropertyReplacement(Reflect, "apply", throwing, () =>
        profileObservedResourceName("ReadMe"),
      ),
      withPropertyReplacement(String.prototype, "normalize", throwing, () =>
        profileObservedResourceName("e\u0301"),
      ),
    ];
    for (const result of probes) {
      expect(result.ok).toBe(true);
      expect(Object.isFrozen(result)).toBe(true);
    }
    const genuine = profileObservedResourceName("genuine");
    expect(
      withPropertyReplacement(WeakSet.prototype, "has", throwing, () =>
        isResourceNameProfileResult(genuine),
      ),
    ).toBe(true);
    expect(
      withPropertyReplacement(
        RegExp.prototype,
        "exec",
        () => null,
        () => profileObservedResourceName("CON.txt"),
      ),
    ).toEqual({ ok: false, reason: "nonportable" });
  });

  it("freezes inert failures without retaining input and authenticates only provenance", () => {
    const secret = "TOP_SECRET_41b6";
    const failures = [
      profileObservedResourceName({ secret }),
      profileObservedResourceName(""),
      profileObservedResourceName("x".repeat(MAX_RESOURCE_NAME_BYTES + 1)),
      profileObservedResourceName(`${secret}/child`),
      profileObservedResourceName("."),
      profileObservedResourceName(`${secret}\u0000`),
      profileObservedResourceName(`${secret}:stream`),
      profileObservedResourceName(`${secret}${String.fromCodePoint(0x0378)}`),
    ];
    for (const result of failures) {
      expect(result.ok).toBe(false);
      expect(Object.isFrozen(result)).toBe(true);
      expect(Object.keys(result).sort()).toEqual(["ok", "reason"]);
      expect(Object.getOwnPropertySymbols(result)).toEqual([]);
      expect(JSON.stringify(result)).not.toContain(secret);
      expect(isResourceNameProfileResult(result)).toBe(true);
    }
    expect(profileObservedResourceName(`${secret}/child`)).toBe(failures[3]);

    const genuine = success("Guide.md");
    expect(Object.isFrozen(genuine)).toBe(true);
    expect(Object.keys(genuine).sort()).toEqual([
      "exact",
      "exactByteLength",
      "isNfc",
      "key",
      "nfc",
      "ok",
    ]);
    expect(Object.getOwnPropertySymbols(genuine)).toEqual([]);
    expect(isResourceNameProfileResult(genuine)).toBe(true);
    expect(isResourceNameProfileResult({ ...genuine })).toBe(false);
    expect(isResourceNameProfileResult(Object.create(genuine) as object)).toBe(false);

    let getterCalls = 0;
    const forged = Object.create(null) as object;
    for (const property of ["ok", "reason", "exact", "key"]) {
      Object.defineProperty(forged, property, {
        get() {
          getterCalls += 1;
          throw new Error("forged result was inspected");
        },
      });
    }
    expect(isResourceNameProfileResult(forged)).toBe(false);
    expect(getterCalls).toBe(0);
    expect(isResourceNameProfileResult(new Proxy({}, { get: () => throwingProxyGetter() }))).toBe(
      false,
    );
  });

  it("uses pinned tables and contains no host Unicode casing or property shortcuts", async () => {
    const source = await readFile(
      new URL("src/validate/resource-name-profile.ts", repositoryRoot),
      "utf8",
    );
    for (const fragment of [
      `to${"Lower"}Case`,
      `to${"Upper"}Case`,
      `locale${"Compare"}`,
      `toLocale${"Lower"}Case`,
      `toLocale${"Upper"}Case`,
      `${"Int"}l`,
      `NF${"KC"}`,
      `NF${"KD"}`,
      ".normalize(",
      "\\p{",
      ".codePointAt(",
    ]) {
      expect(source).not.toContain(fragment);
    }
    expect(source).toContain("isDefaultIgnorableCodePointUnicode15_1(codePoint)");
    expect(source).toContain("windowsReservedKey, key");
    expect(source).toContain(")/u;");
    expect(source).not.toContain(")/iu;");
    expect(source).not.toMatch(/\bfor\s*\([^)]*\bof\b/gu);
  });
});

function throwingProxyGetter(): never {
  throw new Error("forged proxy was inspected");
}
