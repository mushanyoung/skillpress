import { Buffer } from "node:buffer";
import { constants } from "node:fs";
import { readFile } from "node:fs/promises";
import { types } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

import {
  indexDirectoryNames,
  reprofileDirectoryNameIndexEntry,
} from "../src/validate/directory-name-index.js";
import { DiagnosticCollector } from "../src/validate/diagnostics.js";
import { snapshotFileMetadata } from "../src/validate/file-metadata.js";
import { profileObservedResourceName } from "../src/validate/resource-name-profile.js";
import { captureInspectedResourceTree } from "../src/validate/resource-tree-capture.js";
import { compareResourceTreeCaptureSemantics } from "../src/validate/resource-tree-comparison.js";
import {
  createResourceTreeLayout,
  reserveResourceTreeChild,
} from "../src/validate/resource-tree-layout.js";
import { inspectAgentSkillDocument } from "../src/validate/skill-document.js";
import type { DocumentInspection } from "../src/validate/skill-document-read.js";
import { inspectAgentSkillRoot } from "../src/validate/skill-root.js";
import { createSkillFixtures, skillDocument } from "./helpers/skill-fixtures.js";

type MutableRecord = Record<PropertyKey, unknown>;
type Mutation = (draft: MutableRecord) => void;

const fixtures = createSkillFixtures();
const repositoryRoot = new URL("../", import.meta.url);

afterEach(() => fixtures.cleanup());

function record(value: unknown): MutableRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("expected record");
  }
  return value as MutableRecord;
}

function array(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Error("expected array");
  return value;
}

function property(value: unknown, key: PropertyKey): unknown {
  return record(value)[key];
}

function root(value: unknown): MutableRecord {
  return record(property(value, "root"));
}

function rootNames(value: unknown): MutableRecord {
  return record(property(root(value), "names"));
}

function entries(value: unknown): unknown[] {
  return array(property(value, "entries"));
}

function firstEntry(value: unknown): MutableRecord {
  return record(entries(value)[0]);
}

function nameEntries(value: unknown): unknown[] {
  return array(property(rootNames(value), "entries"));
}

function finding(value: unknown, ordinal: number): MutableRecord {
  return record(array(property(rootNames(value), "findings"))[ordinal]);
}

function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (typeof value !== "object" || value === null || seen.has(value)) return value;
  seen.add(value);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor !== undefined && "value" in descriptor) deepFreeze(descriptor.value, seen);
  }
  return Object.freeze(value);
}

function semanticClone(value: unknown, mutate?: Mutation): MutableRecord {
  const clone = structuredClone(value) as MutableRecord;
  mutate?.(clone);
  return deepFreeze(clone);
}

function metadata(kind: "directory" | "file", ordinal: bigint) {
  const mode = BigInt(kind === "directory" ? constants.S_IFDIR : constants.S_IFREG) | 0o600n;
  return snapshotFileMetadata({
    dev: 1n,
    ino: ordinal,
    mode,
    size: kind === "file" ? ordinal : 0n,
    mtimeNs: 2n,
    ctimeNs: 3n,
  });
}

function semanticFixture(): MutableRecord {
  const profiles = ["A.txt", "a.txt", "e\u0301.txt", "é.txt"].map((name) => {
    const result = profileObservedResourceName(name);
    if (!result.ok) throw new Error(`unexpected profile failure: ${result.reason}`);
    return result;
  });
  const names = indexDirectoryNames(profiles);
  if (!names.ok) throw new Error(`unexpected index failure: ${names.reason}`);
  const layout = createResourceTreeLayout();
  let budget = layout.budget;
  const capturedEntries: object[] = [];
  for (let ordinal = 0; ordinal < names.entries.length; ordinal += 1) {
    const reprofiled = reprofileDirectoryNameIndexEntry(names, ordinal);
    if (!reprofiled.ok) throw new Error("unexpected reprofile failure");
    const reservation = reserveResourceTreeChild(budget, layout.root, reprofiled.profile);
    if (!reservation.ok) throw new Error(`unexpected layout failure: ${reservation.reason}`);
    budget = reservation.budget;
    capturedEntries.push(
      Object.freeze({
        role: "resource-file" as const,
        layout: reservation.entry,
        metadata: metadata("file", BigInt(ordinal + 10)),
      }),
    );
  }
  const value = {
    ok: true as const,
    root: Object.freeze({
      layout: layout.root,
      metadata: metadata("directory", 1n),
      names,
    }),
    entries: Object.freeze(capturedEntries),
  };
  return Object.freeze(value);
}

async function genuineDocument(name: string): Promise<DocumentInspection> {
  const fixture = await fixtures.skill(
    name,
    skillDocument(`name: ${name}\ndescription: Comparator fixture.\nlicense: MIT`),
  );
  const diagnostics = new DiagnosticCollector();
  const inspectedRoot = await inspectAgentSkillRoot(fixture.directory, diagnostics);
  if (inspectedRoot === undefined) throw new Error("expected genuine root");
  const document = await inspectAgentSkillDocument(inspectedRoot, diagnostics);
  if (document === undefined) throw new Error("expected genuine document");
  return document;
}

describe("resource-tree capture semantic comparison", () => {
  it("accepts actual captures plus frozen and mutable current-realm projections", async () => {
    const document = await genuineDocument("comparison-actual");
    const captured = await captureInspectedResourceTree(document);
    expect(captured.ok).toBe(true);
    expect(compareResourceTreeCaptureSemantics(captured, captured)).toBe("equal");
    const clone = semanticClone(captured);
    expect(compareResourceTreeCaptureSemantics(captured, clone)).toBe("equal");
    expect(Object.keys(clone)).toEqual(["ok", "root", "entries"]);
    const mutable = structuredClone(captured);
    expect(Object.isFrozen(mutable)).toBe(false);
    expect(Object.hasOwn(mutable, "then")).toBe(false);
    expect(compareResourceTreeCaptureSemantics(captured, mutable)).toBe("equal");
  });

  it("compares every retained scalar and nested name-index sequence", () => {
    const baseline = semanticFixture();
    expect(
      array(property(rootNames(baseline), "findings")).map((value) => property(value, "kind")),
    ).toEqual(["non_nfc", "nfc_collision", "fixed_fold_collision"]);

    const mutations: readonly (readonly [string, Mutation])[] = [
      ["root dev", (draft) => (record(property(root(draft), "metadata")).dev = 2n)],
      ["root ino", (draft) => (record(property(root(draft), "metadata")).ino = 2n)],
      ["root mode", (draft) => (record(property(root(draft), "metadata")).mode = 0o40701n)],
      ["root size", (draft) => (record(property(root(draft), "metadata")).size = 1n)],
      ["root mtime", (draft) => (record(property(root(draft), "metadata")).mtimeNs = 4n)],
      ["root ctime", (draft) => (record(property(root(draft), "metadata")).ctimeNs = 4n)],
      ["role", (draft) => (firstEntry(draft).role = "document")],
      [
        "directory role and kind",
        (draft) => {
          const entry = firstEntry(draft);
          const emptyNames = indexDirectoryNames([]);
          if (!emptyNames.ok) throw new Error("unexpected empty index failure");
          entry.role = "directory";
          entry.metadata = structuredClone(metadata("directory", 10n));
          entry.names = structuredClone(emptyNames);
        },
      ],
      [
        "parent index",
        (draft) => (record(property(record(entries(draft)[1]), "layout")).parentIndex = 0),
      ],
      ["depth", (draft) => (record(property(firstEntry(draft), "layout")).depth = 2)],
      [
        "exact name and bytes",
        (draft) => {
          const layout = record(property(firstEntry(draft), "layout"));
          layout.exactName = "B.txt";
          layout.exactNameByteLength = 5;
        },
      ],
      [
        "relative path and bytes",
        (draft) => {
          const layout = record(property(firstEntry(draft), "layout"));
          layout.relativePath = "B.txt";
          layout.relativePathByteLength = 5;
        },
      ],
      ["entry metadata", (draft) => (record(property(firstEntry(draft), "metadata")).size = 99n)],
      ["indexed exact", (draft) => (record(nameEntries(draft)[0]).exact = "B.txt")],
      [
        "indexed bytes",
        (draft) => {
          const entry = record(nameEntries(draft)[0]);
          entry.exact = "é.txt";
          entry.exactByteLength = Buffer.byteLength("é.txt");
        },
      ],
      ["indexed nfc", (draft) => (record(nameEntries(draft)[0]).nfc = "B.txt")],
      ["indexed key", (draft) => (record(nameEntries(draft)[0]).key = "b.txt")],
      ["indexed isNfc", (draft) => (record(nameEntries(draft)[0]).isNfc = false)],
      [
        "nfc group label",
        (draft) => (record(array(property(rootNames(draft), "nfcGroups"))[0]).nfc = "different"),
      ],
      [
        "nfc group sequence",
        (draft) =>
          (array(property(record(array(property(rootNames(draft), "nfcGroups"))[0]), "exacts"))[0] =
            "different"),
      ],
      [
        "fold group key",
        (draft) => (record(array(property(rootNames(draft), "foldGroups"))[0]).key = "different"),
      ],
      [
        "fold group nfcs",
        (draft) =>
          (array(property(record(array(property(rootNames(draft), "foldGroups"))[0]), "nfcs"))[0] =
            "different"),
      ],
      [
        "fold group exacts",
        (draft) =>
          (array(
            property(record(array(property(rootNames(draft), "foldGroups"))[0]), "exacts"),
          )[0] = "different"),
      ],
      ["non-NFC exact", (draft) => (finding(draft, 0).exact = "different")],
      ["non-NFC normalized", (draft) => (finding(draft, 0).nfc = "different")],
      ["NFC collision label", (draft) => (finding(draft, 1).nfc = "different")],
      [
        "NFC collision exacts",
        (draft) => (array(property(finding(draft, 1), "exacts"))[0] = "different"),
      ],
      ["fold finding key", (draft) => (finding(draft, 2).key = "different")],
      [
        "fold finding nfcs",
        (draft) => (array(property(finding(draft, 2), "nfcs"))[0] = "different"),
      ],
      [
        "fold finding exacts",
        (draft) => (array(property(finding(draft, 2), "exacts"))[0] = "different"),
      ],
      ["group order", (draft) => array(property(rootNames(draft), "nfcGroups")).reverse()],
      ["group count", (draft) => array(property(rootNames(draft), "nfcGroups")).pop()],
      [
        "finding kind",
        (draft) => {
          array(property(rootNames(draft), "findings"))[0] = {
            kind: "nfc_collision",
            nfc: "replacement",
            exacts: ["left", "right"],
          };
        },
      ],
    ];
    for (const [label, mutate] of mutations) {
      expect(
        compareResourceTreeCaptureSemantics(baseline, semanticClone(baseline, mutate)),
        label,
      ).toBe("different");
    }
  });

  it("rejects hostile shape, descriptor, realm, bound, and numeric inputs", () => {
    const baseline = semanticFixture();
    expect(compareResourceTreeCaptureSemantics(baseline, { ok: false })).toBe("invalid");
    expect(compareResourceTreeCaptureSemantics(baseline, null)).toBe("invalid");

    let traps = 0;
    const proxy = new Proxy(baseline, {
      get() {
        traps += 1;
        throw new Error("proxy trap");
      },
      getOwnPropertyDescriptor() {
        traps += 1;
        throw new Error("proxy trap");
      },
      getPrototypeOf() {
        traps += 1;
        throw new Error("proxy trap");
      },
      ownKeys() {
        traps += 1;
        throw new Error("proxy trap");
      },
    });
    expect(compareResourceTreeCaptureSemantics(proxy, baseline)).toBe("invalid");
    const revoked = Proxy.revocable(baseline, {});
    revoked.revoke();
    expect(compareResourceTreeCaptureSemantics(revoked.proxy, baseline)).toBe("invalid");
    expect(traps).toBe(0);

    let getterCalls = 0;
    const cases: readonly (readonly [string, Mutation])[] = [
      [
        "accessor",
        (draft) => {
          Object.defineProperty(record(property(root(draft), "metadata")), "size", {
            configurable: true,
            enumerable: true,
            get() {
              getterCalls += 1;
              throw new Error("getter");
            },
          });
        },
      ],
      [
        "missing required field",
        (draft) => Reflect.deleteProperty(record(property(root(draft), "metadata")), "size"),
      ],
      ["non-array", (draft) => (rootNames(draft).entries = {})],
      ["empty tree", (draft) => (draft.entries = [])],
      [
        "foreign prototype",
        (draft) => Object.setPrototypeOf(record(property(root(draft), "metadata")), {}),
      ],
      ["sparse array", (draft) => Reflect.deleteProperty(nameEntries(draft), 1)],
      ["root negative zero", (draft) => (record(property(root(draft), "layout")).depth = -0)],
      ["negative zero", (draft) => (record(property(firstEntry(draft), "layout")).depth = -0)],
      [
        "unsafe number",
        (draft) =>
          (record(property(firstEntry(draft), "layout")).depth = Number.MAX_SAFE_INTEGER + 1),
      ],
      ["future parent", (draft) => (record(property(firstEntry(draft), "layout")).parentIndex = 0)],
      ["wrong ordinal", (draft) => (record(property(firstEntry(draft), "layout")).entryIndex = 1)],
      ["too deep", (draft) => (record(property(firstEntry(draft), "layout")).depth = 65)],
      ["invalid entry layout", (draft) => (firstEntry(draft).layout = [])],
      [
        "empty exact name",
        (draft) => (record(property(firstEntry(draft), "layout")).exactName = ""),
      ],
      [
        "exact byte mismatch",
        (draft) => (record(property(firstEntry(draft), "layout")).exactNameByteLength = 4),
      ],
      [
        "byte mismatch",
        (draft) => (record(property(firstEntry(draft), "layout")).relativePathByteLength = 4),
      ],
      [
        "indexed total mismatch",
        (draft) => {
          array(property(rootNames(draft), "entries")).pop();
        },
      ],
      ["index marker", (draft) => (rootNames(draft).ok = false)],
      ["invalid indexed entry", (draft) => (nameEntries(draft)[0] = [])],
      ["invalid indexed exact", (draft) => (record(nameEntries(draft)[0]).exact = 1)],
      ["invalid indexed nfc", (draft) => (record(nameEntries(draft)[0]).nfc = 1)],
      ["invalid indexed key", (draft) => (record(nameEntries(draft)[0]).key = 1)],
      ["invalid indexed flag", (draft) => (record(nameEntries(draft)[0]).isNfc = "true")],
      [
        "invalid NFC group",
        (draft) => (record(array(property(rootNames(draft), "nfcGroups"))[0]).exacts = []),
      ],
      [
        "invalid fold group",
        (draft) => (record(array(property(rootNames(draft), "foldGroups"))[0]).nfcs = []),
      ],
      ["primitive finding", (draft) => (array(property(rootNames(draft), "findings"))[0] = null)],
      ["unknown finding", (draft) => (finding(draft, 0).kind = "unknown")],
      ["invalid non-NFC finding", (draft) => (finding(draft, 0).exact = 1)],
      ["invalid NFC collision", (draft) => (array(property(finding(draft, 1), "exacts"))[0] = 1)],
      ["invalid fold finding", (draft) => (array(property(finding(draft, 2), "nfcs"))[0] = 1)],
      ["invalid role", (draft) => (firstEntry(draft).role = "other")],
      ["invalid metadata", (draft) => (record(property(firstEntry(draft), "metadata")).size = 1)],
      [
        "wrong file kind",
        (draft) => {
          firstEntry(draft).metadata = structuredClone(metadata("directory", 10n));
        },
      ],
      [
        "too many index entries",
        (draft) => {
          const values = nameEntries(draft);
          const template = structuredClone(values[0]);
          while (values.length <= 1_024) values.push(structuredClone(template));
        },
      ],
      [
        "too many findings",
        (draft) => {
          const values = array(property(rootNames(draft), "findings"));
          const template = { kind: "non_nfc", exact: "e\u0301", nfc: "é" };
          while (values.length <= 2_048) values.push(structuredClone(template));
        },
      ],
      [
        "too many tree entries",
        (draft) => {
          const values = entries(draft);
          const template = structuredClone(values[0]);
          while (values.length <= 8_192) values.push(structuredClone(template));
        },
      ],
    ];
    for (const [label, mutate] of cases) {
      expect(
        compareResourceTreeCaptureSemantics(baseline, semanticClone(baseline, mutate)),
        label,
      ).toBe("invalid");
    }
    expect(getterCalls).toBe(0);

    const exactAggregate = semanticClone(baseline, (draft) => {
      const values = entries(draft);
      for (let ordinal = 1; ordinal < values.length; ordinal += 1) {
        const layout = record(property(record(values[ordinal]), "layout"));
        layout.relativePath = "x";
        layout.relativePathByteLength = 1;
      }
      const layout = record(property(record(values[0]), "layout"));
      const firstLength = 8 * 1024 * 1024 - values.length + 1;
      layout.relativePath = "x".repeat(firstLength);
      layout.relativePathByteLength = firstLength;
    });
    expect(compareResourceTreeCaptureSemantics(baseline, exactAggregate)).toBe("different");
    const excessiveAggregate = semanticClone(exactAggregate, (draft) => {
      const layout = record(property(firstEntry(draft), "layout"));
      layout.relativePath = `${String(layout.relativePath)}x`;
      layout.relativePathByteLength = Number(layout.relativePathByteLength) + 1;
    });
    expect(compareResourceTreeCaptureSemantics(baseline, excessiveAggregate)).toBe("invalid");

    const extras = structuredClone(baseline) as MutableRecord;
    extras.extra = true;
    extras[Symbol("extra")] = true;
    // biome-ignore lint/suspicious/noThenProperty: the semantic projection must ignore hostile extras.
    Object.defineProperty(extras, "then", {
      enumerable: true,
      get() {
        getterCalls += 1;
        throw new Error("hostile extra getter");
      },
    });
    Object.defineProperty(record(property(root(extras), "metadata")), "extra", {
      get() {
        getterCalls += 1;
        throw new Error("hostile extra getter");
      },
    });
    expect(compareResourceTreeCaptureSemantics(baseline, extras)).toBe("equal");
    expect(getterCalls).toBe(0);
  });

  it("fully validates both values before reporting a semantic difference", () => {
    const baseline = semanticFixture();
    const malformed = semanticClone(baseline, (draft) => {
      record(property(root(draft), "metadata")).dev = 999n;
      Reflect.deleteProperty(
        array(property(finding(draft, 2), "exacts")),
        array(property(finding(draft, 2), "exacts")).length - 1,
      );
    });
    expect(compareResourceTreeCaptureSemantics(baseline, malformed)).toBe("invalid");
  });

  it("uses module-initialization intrinsics and stays internal", async () => {
    const baseline = semanticFixture();
    const clone = semanticClone(baseline);
    const targets = [
      [Reflect, "apply"],
      [Reflect, "ownKeys"],
      [Object, "defineProperty"],
      [Object, "getOwnPropertyDescriptor"],
      [Object, "getPrototypeOf"],
      [Object, "is"],
      [Object, "isFrozen"],
      [Array, "isArray"],
      [Number, "isSafeInteger"],
      [Buffer, "byteLength"],
      [types, "isProxy"],
    ] as const;
    const descriptors = targets.map(
      ([target, key]) => [target, key, Object.getOwnPropertyDescriptor(target, key)] as const,
    );
    const prototypeDescriptor = Object.getOwnPropertyDescriptor(Object.prototype, "comparison");
    const iteratorDescriptor = Object.getOwnPropertyDescriptor(Array.prototype, Symbol.iterator);
    const zeroDescriptor = Object.getOwnPropertyDescriptor(Array.prototype, "0");
    let poisonCalls = 0;
    const poison = (): never => {
      poisonCalls += 1;
      throw new Error("live intrinsic used");
    };
    let result: ReturnType<typeof compareResourceTreeCaptureSemantics> | undefined;
    try {
      for (const [target, key, descriptor] of descriptors) {
        if (descriptor === undefined) throw new Error(`missing ${key}`);
        Reflect.defineProperty(target, key, { ...descriptor, value: poison });
      }
      Reflect.defineProperty(Object.prototype, "comparison", {
        configurable: true,
        get: poison,
      });
      Reflect.defineProperty(Array.prototype, Symbol.iterator, {
        configurable: true,
        get: poison,
      });
      Reflect.defineProperty(Array.prototype, "0", { configurable: true, get: poison });
      result = compareResourceTreeCaptureSemantics(baseline, clone);
    } finally {
      if (iteratorDescriptor !== undefined) {
        Reflect.defineProperty(Array.prototype, Symbol.iterator, iteratorDescriptor);
      } else {
        Reflect.deleteProperty(Array.prototype, Symbol.iterator);
      }
      if (zeroDescriptor === undefined) {
        Reflect.deleteProperty(Array.prototype, "0");
      } else {
        Reflect.defineProperty(Array.prototype, "0", zeroDescriptor);
      }
      for (const [target, key, descriptor] of descriptors) {
        if (descriptor !== undefined) Reflect.defineProperty(target, key, descriptor);
      }
      if (prototypeDescriptor === undefined) {
        Reflect.deleteProperty(Object.prototype, "comparison");
      } else {
        Reflect.defineProperty(Object.prototype, "comparison", prototypeDescriptor);
      }
    }
    expect(result).toBe("equal");
    expect(poisonCalls).toBe(0);

    const source = await readFile(
      new URL("src/validate/resource-tree-comparison.ts", repositoryRoot),
      "utf8",
    );
    for (const forbidden of [
      "resource-tree-capture.js",
      "node:fs",
      "WeakMap",
      "WeakSet",
      "JSON.",
      "for (const",
      "ownKeysSnapshot",
      "isFrozenSnapshot",
    ]) {
      expect(source).not.toContain(forbidden);
    }
    const rootSource = await readFile(new URL("src/index.ts", repositoryRoot), "utf8");
    expect(rootSource).not.toContain("compareResourceTreeCaptureSemantics");
  });
});
