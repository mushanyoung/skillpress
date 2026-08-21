import { Buffer } from "node:buffer";
import { runInNewContext } from "node:vm";
import { types } from "node:util";

import type { Root } from "mdast";
import { describe, expect, it } from "vitest";

import {
  analyzeMarkdown,
  isGenuineMarkdownAnalysis,
  MAX_SKILL_MARKDOWN_AST_NODES,
  MAX_SKILL_MARKDOWN_AST_SCALAR_CODE_UNITS,
  MAX_SKILL_MARKDOWN_SOURCE_BYTES,
} from "../src/validate/markdown-analysis.js";

const definePropertySnapshot = Object.defineProperty;
const getOwnPropertyDescriptorSnapshot = Object.getOwnPropertyDescriptor;
const applySnapshot = Reflect.apply;

function root(children: unknown[] = []): Root {
  return { type: "root", children } as Root;
}

function analyzeTree(value: unknown, source = "safe") {
  return analyzeMarkdown(source, () => value as Root);
}

function issueCode(value: unknown): string | undefined {
  return analyzeTree(value).issues[0]?.code;
}

function accessor(target: object, key: PropertyKey, get: () => unknown): void {
  definePropertySnapshot(target, key, { configurable: true, enumerable: true, get });
}

describe("hardened Markdown AST projection", () => {
  it("brands every result by identity and deeply freezes public projections", () => {
    const reports = [
      analyzeMarkdown("# heading\n\n[target](resource.md)"),
      analyzeMarkdown("x".repeat(MAX_SKILL_MARKDOWN_SOURCE_BYTES + 1)),
      analyzeMarkdown("safe", () => {
        throw new Error("private parser detail");
      }),
      analyzeTree({ type: "root", children: new Array(1) }),
    ];
    for (const report of reports) {
      expect(isGenuineMarkdownAnalysis(report)).toBe(true);
      expect(Object.isFrozen(report)).toBe(true);
      for (const values of [
        report.targets,
        report.headings,
        report.definitions,
        report.unusedDefinitions,
        report.placeholderFindings,
        report.issues,
      ]) {
        expect(Object.isFrozen(values)).toBe(true);
        for (const item of values) expect(Object.isFrozen(item)).toBe(true);
      }
    }

    const genuine = reports[0] as (typeof reports)[number];
    let traps = 0;
    const proxy = new Proxy(genuine, {
      get() {
        traps += 1;
        throw new Error("analysis trap");
      },
      getOwnPropertyDescriptor() {
        traps += 1;
        throw new Error("analysis trap");
      },
    });
    const revocable = Proxy.revocable(genuine, {});
    revocable.revoke();
    expect(isGenuineMarkdownAnalysis({ ...genuine })).toBe(false);
    expect(isGenuineMarkdownAnalysis(structuredClone(genuine))).toBe(false);
    expect(isGenuineMarkdownAnalysis(proxy)).toBe(false);
    expect(isGenuineMarkdownAnalysis(revocable.proxy)).toBe(false);
    expect(isGenuineMarkdownAnalysis(() => genuine)).toBe(false);
    expect(traps).toBe(0);

    const reference = genuine.targets[0];
    expect(reference?.location).toBe(reference?.destinationLocation);
    expect(Reflect.ownKeys(genuine)).not.toContain("then");
  });

  it("normalizes hostile records, arrays, positions, and fields without invoking them", () => {
    let observations = 0;
    const throwing = () => {
      observations += 1;
      throw new Error("private AST detail");
    };
    const rootProxy = new Proxy(root(), {
      get: throwing,
      getOwnPropertyDescriptor: throwing,
      getPrototypeOf: throwing,
    });
    const childrenProxy = new Proxy([], {
      get: throwing,
      getOwnPropertyDescriptor: throwing,
      getPrototypeOf: throwing,
    });
    const typeAccessor = {};
    accessor(typeAccessor, "type", throwing);
    const positionAccessor = { type: "thematicBreak" };
    accessor(positionAccessor, "position", throwing);
    const startAccessor = { type: "thematicBreak", position: {} };
    accessor(startAccessor.position, "start", throwing);
    const slotAccessor: unknown[] = [];
    accessor(slotAccessor, 0, throwing);
    definePropertySnapshot(slotAccessor, "length", { value: 1 });
    const customPrototype = Object.create({
      get type() {
        return throwing();
      },
    });
    const foreign = runInNewContext("({type:'root',children:[]})") as unknown;
    const revocable = Proxy.revocable(root(), { get: throwing });
    revocable.revoke();
    const malformed = [
      null,
      () => root(),
      rootProxy,
      revocable.proxy,
      { type: "root", children: childrenProxy },
      typeAccessor,
      { type: "root", children: new Array(1) },
      { type: "root", children: slotAccessor },
      root([positionAccessor]),
      root([startAccessor]),
      customPrototype,
      foreign,
      root([{ type: "root|blockquote", children: [] }]),
      root([{ type: "linkReference", identifier: "id", referenceType: "other", children: [] }]),
      root([{ type: "thematicBreak", position: { start: { line: 99, column: 1 } } }]),
    ];
    for (const value of malformed) {
      let calls = 0;
      const report = analyzeMarkdown("safe", () => {
        calls += 1;
        return value as Root;
      });
      expect(calls).toBe(1);
      expect(report).toMatchObject({
        nodeCount: 0,
        targets: [],
        headings: [],
        definitions: [],
        issues: [{ code: "skill.markdown.parse" }],
      });
      expect(JSON.stringify(report)).not.toContain("private AST detail");
      expect(isGenuineMarkdownAnalysis(report)).toBe(true);
    }
    expect(observations).toBe(0);
  });

  it("reserves child occurrences before slots and counts shared and cyclic DFS occurrences", () => {
    const leaf = { type: "thematicBreak" };
    const exactChildren = Array.from({ length: MAX_SKILL_MARKDOWN_AST_NODES - 1 }, () => leaf);
    const exact = analyzeTree(root(exactChildren));
    expect(exact.issues).toEqual([]);
    expect(exact.nodeCount).toBe(MAX_SKILL_MARKDOWN_AST_NODES);

    let firstSlotReads = 0;
    const overflow: unknown[] = [];
    definePropertySnapshot(overflow, "length", { value: MAX_SKILL_MARKDOWN_AST_NODES });
    accessor(overflow, 0, () => {
      firstSlotReads += 1;
      return leaf;
    });
    expect(issueCode(root(overflow))).toBe("skill.markdown.complexity");
    expect(firstSlotReads).toBe(0);

    let childProxyTraps = 0;
    const activeProxy = new Proxy(
      {},
      {
        get() {
          childProxyTraps += 1;
          throw new Error("child proxy trap");
        },
        getOwnPropertyDescriptor() {
          childProxyTraps += 1;
          throw new Error("child proxy trap");
        },
      },
    );
    const revoked = Proxy.revocable({}, {});
    revoked.revoke();
    const hugeType = { type: "x".repeat(MAX_SKILL_MARKDOWN_SOURCE_BYTES + 1) };
    for (const late of [activeProxy, revoked.proxy, runInNewContext("({type:'text'})"), 1]) {
      expect(issueCode(root([hugeType, late]))).toBe("skill.markdown.parse");
    }
    expect(childProxyTraps).toBe(0);

    let lateTypeReads = 0;
    const latePlain = {};
    accessor(latePlain, "type", () => {
      lateTypeReads += 1;
      return "thematicBreak";
    });
    expect(issueCode(root([hugeType, latePlain]))).toBe("skill.markdown.complexity");
    expect(lateTypeReads).toBe(0);

    const cyclic = { type: "paragraph", children: [] as unknown[] };
    definePropertySnapshot(cyclic.children, 0, { value: cyclic, enumerable: true });
    expect(issueCode(root([cyclic]))).toBe("skill.markdown.complexity");

    let lastSlotReads = 0;
    const late: unknown[] = [
      { type: "link", url: "secret.md", children: [] },
      { type: "thematicBreak" },
    ];
    accessor(late, 2, () => {
      lastSlotReads += 1;
      return leaf;
    });
    const lateFailure = analyzeTree(root(late));
    expect(lateFailure).toMatchObject({
      nodeCount: 0,
      targets: [],
      issues: [{ code: "skill.markdown.parse" }],
    });
    expect(lastSlotReads).toBe(0);
  });

  it("keeps heading projection occurrence-bounded and preserves leaf short-circuit behavior", () => {
    let ignoredReads = 0;
    const ignored = () => {
      ignoredReads += 1;
      throw new Error("ignored field");
    };
    const hiddenText = { type: "text", value: "hidden" };
    const html = { type: "html", children: [hiddenText] };
    const code = { type: "code", children: [{ type: "text", value: "b" }] };
    accessor(html, "value", ignored);
    accessor(code, "value", ignored);
    const heading = {
      type: "heading",
      depth: 1,
      children: [
        { type: "text", value: "a", children: [hiddenText] },
        { type: "image", url: "image.png", alt: null, children: [hiddenText] },
        html,
        { type: "break", children: [hiddenText] },
        code,
      ],
    };
    const report = analyzeTree(root([heading]));
    expect(report.headings).toEqual([{ depth: 1, text: "a b", location: { line: 1, column: 1 } }]);
    expect(ignoredReads).toBe(0);

    const loop = { type: "emphasis", children: [] as unknown[] };
    definePropertySnapshot(loop.children, 0, { value: loop, enumerable: true });
    expect(issueCode(root([{ type: "heading", depth: 1, children: [loop] }]))).toBe(
      "skill.markdown.complexity",
    );
  });

  it("enforces single-field and occurrence-counted aggregate scalar budgets", () => {
    const singleExact = analyzeTree(
      root([
        {
          type: "heading",
          depth: 1,
          children: [{ type: "text", value: "x".repeat(MAX_SKILL_MARKDOWN_SOURCE_BYTES) }],
        },
      ]),
    );
    expect(singleExact.issues).toEqual([]);
    expect(
      issueCode(
        root([
          {
            type: "heading",
            depth: 1,
            children: [{ type: "text", value: "x".repeat(MAX_SKILL_MARKDOWN_SOURCE_BYTES + 1) }],
          },
        ]),
      ),
    ).toBe("skill.markdown.complexity");

    const aggregate = (delta: number) => {
      const values = Array.from({ length: 15 }, () => "x".repeat(MAX_SKILL_MARKDOWN_SOURCE_BYTES));
      values[15] = "x".repeat(MAX_SKILL_MARKDOWN_SOURCE_BYTES - 143 + delta);
      return root([
        {
          type: "code",
          children: [
            {
              type: "heading",
              depth: 1,
              children: values.map((value) => ({ type: "text", value })),
            },
          ],
        },
      ]);
    };
    const exact = analyzeTree(aggregate(0));
    expect(exact.issues).toEqual([]);
    expect(isGenuineMarkdownAnalysis(exact)).toBe(true);
    expect(issueCode(aggregate(1))).toBe("skill.markdown.complexity");

    const shared = { type: "text", value: "x".repeat(300_000) };
    expect(
      issueCode(
        root([
          {
            type: "code",
            children: [
              {
                type: "heading",
                depth: 1,
                children: Array.from({ length: 28 }, () => shared),
              },
            ],
          },
        ]),
      ),
    ).toBe("skill.markdown.complexity");
    expect(MAX_SKILL_MARKDOWN_AST_SCALAR_CODE_UNITS).toBe(8 * 1024 * 1024);
  });

  it("uses only captured analysis intrinsics after import", () => {
    const safeTree = root([
      { type: "heading", depth: 2, children: [{ type: "text", value: "Heading" }] },
      { type: "linkReference", identifier: "id", referenceType: "full", children: [] },
      { type: "definition", identifier: "id", url: "resource.md" },
    ]);
    const objectSnapshot = Object;
    const arraySnapshot = Array;
    const numberSnapshot = Number;
    const mapSnapshot = Map;
    const setSnapshot = Set;
    const weakSetSnapshot = WeakSet;
    const restorers: Array<() => void> = [];
    let poisonCalls = 0;
    let measuring = false;
    const observe = () => {
      if (measuring) poisonCalls += 1;
      return undefined;
    };
    const replace = (target: object, key: PropertyKey) => {
      const descriptor = getOwnPropertyDescriptorSnapshot(target, key);
      const original = descriptor?.value as (...args: unknown[]) => unknown;
      definePropertySnapshot(restorers, restorers.length, {
        __proto__: null,
        configurable: true,
        value: () => {
          if (descriptor === undefined) Reflect.deleteProperty(target, key);
          else definePropertySnapshot(target, key, descriptor);
        },
      });
      definePropertySnapshot(target, key, {
        __proto__: null,
        configurable: true,
        value(this: unknown, ...args: unknown[]) {
          if (measuring) poisonCalls += 1;
          return applySnapshot(original, this, args);
        },
        writable: true,
      });
    };
    const replaceGetter = (target: object, key: PropertyKey, trap = observe) => {
      const descriptor = getOwnPropertyDescriptorSnapshot(target, key);
      definePropertySnapshot(restorers, restorers.length, {
        __proto__: null,
        configurable: true,
        value: () => {
          if (descriptor === undefined) Reflect.deleteProperty(target, key);
          else definePropertySnapshot(target, key, descriptor);
        },
      });
      definePropertySnapshot(target, key, {
        __proto__: null,
        configurable: true,
        get: trap,
        set: trap,
      });
    };

    let report: ReturnType<typeof analyzeMarkdown> | undefined;
    let failed: ReturnType<typeof analyzeMarkdown> | undefined;
    try {
      replace(Reflect, "apply");
      replace(Buffer, "byteLength");
      for (const key of [
        "freeze",
        "defineProperty",
        "getOwnPropertyDescriptor",
        "getPrototypeOf",
        "is",
      ]) {
        replace(objectSnapshot, key);
      }
      replace(arraySnapshot, "isArray");
      for (const key of ["join", "push", "pop", "reverse", "filter"]) {
        replace(arraySnapshot.prototype, key);
      }
      replace(numberSnapshot, "isSafeInteger");
      for (const [prototype, keys] of [
        [mapSnapshot.prototype, ["get", "has", "set", "values", Symbol.iterator]],
        [setSnapshot.prototype, ["add", "has", Symbol.iterator]],
        [weakSetSnapshot.prototype, ["add", "has"]],
      ] as const) {
        for (const key of keys) replace(prototype, key);
      }
      for (const key of ["charCodeAt", "indexOf", Symbol.iterator]) {
        replace(String.prototype, key);
      }
      replace(RegExp.prototype, "exec");
      replace(types, "isProxy");
      replaceGetter(Object.prototype, 0);
      replaceGetter(Object.prototype, "kind");
      replaceGetter(Object.prototype, "then");
      for (const key of ["children", "url", "identifier", "referenceType", "depth", "location"]) {
        replaceGetter(Object.prototype, key);
      }
      replace(arraySnapshot.prototype, Symbol.iterator);
      measuring = true;
      report = analyzeMarkdown("safe", () => safeTree);
      failed = analyzeMarkdown("safe", () =>
        root([{ type: "x".repeat(MAX_SKILL_MARKDOWN_SOURCE_BYTES + 1) }]),
      );
      measuring = false;
    } finally {
      measuring = false;
      for (let index = restorers.length - 1; index >= 0; index -= 1) restorers[index]?.();
    }
    expect(poisonCalls).toBe(0);
    expect(report).toMatchObject({
      headings: [{ depth: 2, text: "Heading" }],
      targets: [{ form: "reference", url: "resource.md" }],
      issues: [],
    });
    expect(failed).toMatchObject({
      nodeCount: 0,
      targets: [],
      headings: [],
      definitions: [],
      issues: [{ code: "skill.markdown.complexity" }],
    });
    expect(JSON.stringify(failed)).not.toContain("live intrinsic used");
    expect(isGenuineMarkdownAnalysis(report)).toBe(true);
    expect(isGenuineMarkdownAnalysis(failed)).toBe(true);
  });

  it("contains retained default-parser failures without claiming transitive hardening", () => {
    const descriptor = getOwnPropertyDescriptorSnapshot(Array.prototype, "push");
    let producerCalls = 0;
    definePropertySnapshot(Array.prototype, "push", {
      configurable: true,
      value() {
        producerCalls += 1;
        throw new Error("default producer poison");
      },
    });
    let report: ReturnType<typeof analyzeMarkdown>;
    try {
      report = analyzeMarkdown("# heading");
    } finally {
      if (descriptor !== undefined) definePropertySnapshot(Array.prototype, "push", descriptor);
    }
    expect(producerCalls).toBeGreaterThan(0);
    expect(report.issues).toEqual([
      { code: "skill.markdown.parse", message: "Markdown could not be parsed safely" },
    ]);
    expect(isGenuineMarkdownAnalysis(report)).toBe(true);
  });

  it("keeps dense-slot descriptors independent of inherited get and set", () => {
    const getter = getOwnPropertyDescriptorSnapshot(Object.prototype, "get");
    const setter = getOwnPropertyDescriptorSnapshot(Object.prototype, "set");
    const safeTree = root([
      { type: "heading", depth: 1, children: [{ type: "text", value: "ok" }] },
    ]);
    const badTree = root([{ type: "x".repeat(524_289) }]);
    let calls = 0;
    const trap = () => {
      calls += 1;
      return undefined;
    };
    let ok: ReturnType<typeof analyzeMarkdown> | undefined;
    let bad: ReturnType<typeof analyzeMarkdown> | undefined;
    try {
      definePropertySnapshot(Object.prototype, "get", {
        __proto__: null,
        configurable: true,
        get: trap,
        set: trap,
      });
      definePropertySnapshot(Object.prototype, "set", {
        __proto__: null,
        configurable: true,
        get: trap,
        set: trap,
      });
      ok = analyzeMarkdown("safe", () => safeTree);
      bad = analyzeMarkdown("safe", () => badTree);
    } finally {
      if (getter === undefined) Reflect.deleteProperty(Object.prototype, "get");
      else definePropertySnapshot(Object.prototype, "get", getter);
      if (setter === undefined) Reflect.deleteProperty(Object.prototype, "set");
      else definePropertySnapshot(Object.prototype, "set", setter);
    }
    expect(calls).toBe(0);
    expect(ok?.headings[0]?.text).toBe("ok");
    expect(bad?.issues[0]?.code).toBe("skill.markdown.complexity");
  });

  it("extracts only the three CommonMark resources from the property-tax fixture shape", () => {
    const report = analyzeMarkdown(
      [
        "Read [methodology](references/methodology.md), [routes](references/appeal-routes.md), and [schema](references/case-schema.md).",
        "",
        "Use `assets/case-template.json`, `assets/case-example.json`, `scripts/lookup_jurisdiction.py`,",
        "`scripts/build_appeal_packet.py`, `scripts/url_safety.py`, and `scripts/requirements.lock`.",
      ].join("\n"),
    );
    expect(report.targets.map(({ url }) => url)).toEqual([
      "references/methodology.md",
      "references/appeal-routes.md",
      "references/case-schema.md",
    ]);
    expect(report.issues).toEqual([]);
  });
});
