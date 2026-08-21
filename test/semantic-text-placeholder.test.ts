import { describe, expect, it, vi } from "vitest";

import {
  classifySemanticTextPlaceholder,
  isGenuineSemanticTextPlaceholderClassification,
  MAX_SEMANTIC_TEXT_CODE_UNITS,
} from "../src/validate/semantic-text-placeholder.js";

const DIRECTIVES = [
  "todo",
  "tbd",
  "fixme",
  "changeme",
  "placeholder",
  "replace me",
  "fill me",
] as const;
const MARKER_WORDS = DIRECTIVES.slice(0, 5);
const UPPERCASE_WORDS = ["TODO", "TBD", "FIXME", "CHANGEME"] as const;
const FIELDS = [
  "name",
  "title",
  "description",
  "summary",
  "text",
  "value",
  "details",
  "content",
  "email",
  "url",
  "path",
  "command",
] as const;

const LEGACY_FALSE_POSITIVES = [
  "todo-list",
  "placeholder-driven design",
  "replace me-not",
  "[fill rate]",
  "[enter key]",
  "[your rights]",
] as const;

const PROPERTY_TAX_SAFE_TEXT = [
  "REPLACE after parcel-source verification",
  "For this fictional template, the official rule source states that the assessed value directly equals the fair market comparison value. Replace this with the actual jurisdiction-specific transformation.",
  "Example fixed deadline for this fictional template; replace it with the current official rule for the actual locality.",
  "Example sale window for the fictional template; replace with the current official jurisdiction-specific rule.",
  "Describe the verified condition, notice, repair program, litigation, insurance issue, or other fact without making an unsupported legal conclusion.",
  "Example",
  "EXAMPLE",
  "REPLACE",
  "const TODO = defineTask();",
  "Use `TODO` as the literal status token.",
  "https://example.gov/parcel/search",
] as const;

const SAFE_NEAR_MISSES = [
  "[TODO](https://example.gov)",
  "[TODOx]",
  "ＴＯＤＯ",
  "TO\u200BDO",
  "prefix TODO",
  "TODOist",
  "todo write this",
  "todo—later",
  "todo:\u2028x",
  "todo - details\u2029tail",
  "[TODO]\u2028\u2028x",
  "This sentence says TODO: later.",
  "[your organization]",
] as const;

function expectPlaceholder(value: string): void {
  expect(classifySemanticTextPlaceholder(value)).toEqual({
    ok: false,
    reason: "placeholder",
  });
}

function legacyRegExpState(): readonly string[] {
  const aliases = RegExp as unknown as Readonly<Record<string, string>>;
  return [
    RegExp.input,
    RegExp.$_,
    RegExp.lastMatch,
    RegExp.lastParen,
    RegExp.leftContext,
    RegExp.rightContext,
    aliases["$&"],
    aliases["$+"],
    aliases["$`"],
    aliases["$'"],
    RegExp.$1,
    RegExp.$2,
    RegExp.$3,
    RegExp.$4,
    RegExp.$5,
    RegExp.$6,
    RegExp.$7,
    RegExp.$8,
    RegExp.$9,
  ];
}

describe("semantic-text placeholder classification", () => {
  it("classifies every frozen grammar branch", () => {
    for (const word of DIRECTIVES) {
      for (const value of [word, `${word}: details`, `${word} - details`, `${word} — details`]) {
        expectPlaceholder(value);
      }
    }
    for (const word of UPPERCASE_WORDS) expectPlaceholder(`${word} write this`);
    for (const word of MARKER_WORDS) {
      for (const value of [`[${word}]`, `[${word} details]`, `[${word}: details]`]) {
        expectPlaceholder(value);
      }
    }
    for (const value of [
      "FiXmE",
      "replace me : later",
      "FIXME -",
      "TODO -x",
      "TODO —x",
      "TODO -\u0085",
      "[placeholder] trailing prose",
      "[fill this in]",
      "[fill this in later]",
      "[fill me]",
      "[fill me in now]",
      "[replace me]",
      "[replace this later]",
      "[insert here]",
      "[insert value here]",
      "[describe service here]",
      "[enter owner here]",
      "[inſert value here]",
    ]) {
      expectPlaceholder(value);
    }
    for (const field of FIELDS) {
      expectPlaceholder(`[your ${field}]`);
      expectPlaceholder(`[your ${field} here]`);
    }
  });

  it.each([...LEGACY_FALSE_POSITIVES, ...PROPERTY_TAX_SAFE_TEXT, ...SAFE_NEAR_MISSES])(
    "allows ordinary or near-miss text %s",
    (value) => {
      expect(classifySemanticTextPlaceholder(value)).toEqual({ ok: true });
    },
  );

  it("classifies blank text and Unicode whitespace", () => {
    for (const value of ["", " \t ", "\u00a0\u3000", "\r\n\t\r"]) expectPlaceholder(value);
    for (const whitespace of [
      "\t",
      "\v",
      "\f",
      " ",
      "\u00a0",
      "\u1680",
      "\u2000",
      "\u2028",
      "\u2029",
      "\u202f",
      "\u205f",
      "\u3000",
      "\ufeff",
    ]) {
      expectPlaceholder(`TODO${whitespace}annotation`);
    }
    expect(classifySemanticTextPlaceholder("\u200b")).toEqual({ ok: true });
  });

  it("finds markers at LF, CR, and CRLF logical-line positions", () => {
    for (const value of [
      "TODO\nordinary",
      "ordinary\nTODO",
      "ordinary\r\n\r\n [TODO details] \r\nordinary",
      "ordinary\rFIXME - repair",
      "ordinary\r\nreplace me: later\r\n",
    ]) {
      expectPlaceholder(value);
    }
    expect(classifySemanticTextPlaceholder("ordinary\r\n\rplain\nlast\r")).toEqual({ ok: true });
  });

  it("applies the exact code-unit boundary before placeholder grammar", () => {
    const exact = "a".repeat(MAX_SEMANTIC_TEXT_CODE_UNITS);
    const exactMarker = `${"a".repeat(MAX_SEMANTIC_TEXT_CODE_UNITS - 5)}\nTODO`;
    const exactAstral = "😀".repeat(MAX_SEMANTIC_TEXT_CODE_UNITS / 2);
    expect(exact).toHaveLength(524_288);
    expect(classifySemanticTextPlaceholder(exact)).toEqual({ ok: true });
    expect(exactMarker).toHaveLength(524_288);
    expectPlaceholder(exactMarker);
    expect(classifySemanticTextPlaceholder(`${exactMarker}a`)).toEqual({
      ok: false,
      reason: "too_large",
    });
    expect(exactAstral).toHaveLength(524_288);
    expect(classifySemanticTextPlaceholder(exactAstral)).toEqual({ ok: true });
    expect(classifySemanticTextPlaceholder(`${exactAstral}a`)).toEqual({
      ok: false,
      reason: "too_large",
    });
    expect(classifySemanticTextPlaceholder(`${exact}a`)).toEqual({
      ok: false,
      reason: "too_large",
    });
    expect(
      classifySemanticTextPlaceholder(`TODO${"a".repeat(MAX_SEMANTIC_TEXT_CODE_UNITS)}`),
    ).toEqual({ ok: false, reason: "too_large" });
  });

  it("has no hidden logical-line cap", () => {
    expectPlaceholder(`${"ordinary\n".repeat(8_193)}TODO`);
  });

  it("rejects nonprimitive inputs without observing properties", () => {
    let observations = 0;
    const active = new Proxy(
      {},
      {
        get() {
          observations += 1;
          throw new Error("get trap observed");
        },
        getOwnPropertyDescriptor() {
          observations += 1;
          throw new Error("descriptor trap observed");
        },
        getPrototypeOf() {
          observations += 1;
          throw new Error("prototype trap observed");
        },
        ownKeys() {
          observations += 1;
          throw new Error("ownKeys trap observed");
        },
      },
    );
    const revoked = Proxy.revocable({}, {});
    revoked.revoke();
    for (const value of [
      undefined,
      null,
      1,
      true,
      1n,
      Symbol("text"),
      new String("TODO"),
      () => "TODO",
      active,
      revoked.proxy,
    ]) {
      expect(classifySemanticTextPlaceholder(value)).toEqual({
        ok: false,
        reason: "invalid_input",
      });
    }
    expect(isGenuineSemanticTextPlaceholderClassification(active)).toBe(false);
    expect(isGenuineSemanticTextPlaceholderClassification(revoked.proxy)).toBe(false);
    expect(observations).toBe(0);
  });

  it("returns frozen, raw-free singleton identities with a property-free brand", () => {
    const secret = "sentinel secret";
    /^(benign)-(state)$/u.exec("benign-state");
    const legacyBefore = legacyRegExpState();
    const results = [
      classifySemanticTextPlaceholder("ordinary"),
      classifySemanticTextPlaceholder(Symbol(secret)),
      classifySemanticTextPlaceholder("a".repeat(MAX_SEMANTIC_TEXT_CODE_UNITS + 1)),
      classifySemanticTextPlaceholder(`TODO: ${secret}`),
    ] as const;
    const legacyAfter = legacyRegExpState();
    const sameResults = [
      classifySemanticTextPlaceholder("also ordinary"),
      classifySemanticTextPlaceholder({}),
      classifySemanticTextPlaceholder("b".repeat(MAX_SEMANTIC_TEXT_CODE_UNITS + 1)),
      classifySemanticTextPlaceholder("FIXME"),
    ] as const;
    for (let index = 0; index < results.length; index += 1) {
      expect(results[index]).toBe(sameResults[index]);
      expect(Object.isFrozen(results[index])).toBe(true);
      expect(Object.getOwnPropertySymbols(results[index])).toEqual([]);
      expect(isGenuineSemanticTextPlaceholderClassification(results[index])).toBe(true);
    }
    expect(Object.keys(results[0])).toEqual(["ok"]);
    for (const result of results.slice(1)) expect(Object.keys(result)).toEqual(["ok", "reason"]);
    expect(JSON.stringify(results)).not.toContain(secret);
    expect(legacyAfter).toEqual(legacyBefore);
    expect(isGenuineSemanticTextPlaceholderClassification({ ok: true })).toBe(false);
    expect(isGenuineSemanticTextPlaceholderClassification({ ...results[3] })).toBe(false);
    expect(isGenuineSemanticTextPlaceholderClassification(structuredClone(results[3]))).toBe(false);
    expect(isGenuineSemanticTextPlaceholderClassification(() => undefined)).toBe(false);
    expect(isGenuineSemanticTextPlaceholderClassification(null)).toBe(false);
  });

  it("rejects classifications from a second physical module instance", async () => {
    vi.resetModules();
    const foreign = await import("../src/validate/semantic-text-placeholder.js");
    const result = foreign.classifySemanticTextPlaceholder("ordinary");
    expect(foreign.isGenuineSemanticTextPlaceholderClassification(result)).toBe(true);
    expect(isGenuineSemanticTextPlaceholderClassification(result)).toBe(false);
  });

  it("normalizes an internal scan exception", async () => {
    const nativeApply = Reflect.apply;
    const descriptor = Object.getOwnPropertyDescriptor(Reflect, "apply");
    Object.defineProperty(Reflect, "apply", {
      configurable: true,
      value(target: unknown, receiver: unknown, argumentsList: ArrayLike<unknown>) {
        if (target === String.prototype.trim && receiver === "throw during scan") {
          throw new Error("synthetic scan failure");
        }
        return nativeApply(target as (...args: unknown[]) => unknown, receiver, argumentsList);
      },
      writable: true,
    });
    vi.resetModules();
    let isolated: typeof import("../src/validate/semantic-text-placeholder.js") | undefined;
    try {
      isolated = await import("../src/validate/semantic-text-placeholder.js");
    } finally {
      if (descriptor !== undefined) Object.defineProperty(Reflect, "apply", descriptor);
    }
    expect(isolated?.classifySemanticTextPlaceholder("throw during scan")).toEqual({
      ok: false,
      reason: "invalid_input",
    });
  });

  it("uses captured intrinsics under post-import pollution", () => {
    const targets = [
      [Reflect, "apply"],
      [Object, "freeze"],
      [String.prototype, "charCodeAt"],
      [String.prototype, "slice"],
      [String.prototype, "trim"],
      [WeakSet.prototype, "add"],
      [WeakSet.prototype, "has"],
    ] as const;
    const descriptors = targets.map(([target, property]) =>
      Object.getOwnPropertyDescriptor(target, property),
    );
    const defineProperty = Object.defineProperty;
    let observations = 0;
    const poison = () => {
      observations += 1;
      throw new Error("live intrinsic observed");
    };
    let placeholder: ReturnType<typeof classifySemanticTextPlaceholder> | undefined;
    let safe: ReturnType<typeof classifySemanticTextPlaceholder> | undefined;
    let genuine: boolean | undefined;
    try {
      for (const [target, property] of targets) {
        defineProperty(target, property, { configurable: true, value: poison, writable: true });
      }
      placeholder = classifySemanticTextPlaceholder("ordinary\r\nTODO: finish");
      safe = classifySemanticTextPlaceholder("ordinary\r\ntext");
      genuine = isGenuineSemanticTextPlaceholderClassification(safe);
    } finally {
      for (let index = 0; index < targets.length; index += 1) {
        const descriptor = descriptors[index];
        if (descriptor !== undefined)
          defineProperty(targets[index][0], targets[index][1], descriptor);
      }
    }
    expect(observations).toBe(0);
    expect(placeholder).toEqual({ ok: false, reason: "placeholder" });
    expect(safe).toEqual({ ok: true });
    expect(genuine).toBe(true);
  });
});
