import { Buffer } from "node:buffer";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { runInNewContext } from "node:vm";

import { afterEach, describe, expect, it, vi } from "vitest";

import { DiagnosticCollector } from "../src/validate/diagnostics.js";
import { analyzeMarkdown } from "../src/validate/markdown-analysis.js";
import { createSkillFixtures, skillDocument } from "./helpers/skill-fixtures.js";

const fixtures = createSkillFixtures();
const graphPath = "../src/validate/markdown-resource-graph.js";
const abortPath = "../src/validate/abort-signal.js";
const sessionPath = "../src/validate/resource-tree-session.js";
const indexPath = "../src/validate/resource-tree-path-index.js";
const sourcePath = "../src/validate/skill-source.js";
const analysisPath = "../src/validate/markdown-analysis.js";
const destinationPath = "../src/validate/markdown-destination.js";
const resourceNamePath = "../src/validate/bundled-resource-name.js";
const mockedPaths = [
  abortPath,
  sessionPath,
  indexPath,
  sourcePath,
  analysisPath,
  destinationPath,
  resourceNamePath,
] as const;

afterEach(async () => {
  await fixtures.cleanup();
  for (const path of mockedPaths) vi.doUnmock(path);
  vi.resetModules();
});

function barrier<T extends object>(value: T): Readonly<T> {
  // biome-ignore lint/suspicious/noThenProperty: graph boundaries intentionally require this.
  Object.defineProperty(value, "then", {
    configurable: false,
    enumerable: false,
    value: undefined,
    writable: false,
  });
  return Object.freeze(value);
}

function expectBarrier(value: object, keys: readonly string[]): void {
  expect(Object.keys(value)).toEqual(keys);
  expect(Object.getOwnPropertyDescriptor(value, "then")).toEqual({
    configurable: false,
    enumerable: false,
    value: undefined,
    writable: false,
  });
  expect(Object.getPrototypeOf(value)).toBe(Object.prototype);
  expect(Object.isFrozen(value)).toBe(true);
}

function expectDeepFrozen(value: unknown, seen = new WeakSet<object>()): void {
  if ((typeof value !== "object" && typeof value !== "function") || value === null) return;
  if (seen.has(value)) return;
  seen.add(value);
  expect(Object.isFrozen(value)).toBe(true);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor !== undefined && "value" in descriptor) expectDeepFrozen(descriptor.value, seen);
  }
}

function record(calls: unknown[][], args: unknown[]): void {
  Object.defineProperty(calls, calls.length, {
    configurable: true,
    enumerable: true,
    value: args,
    writable: true,
  });
}

async function inspectDocument(fixture: { readonly directory: string; readonly path: string }) {
  const { inspectAgentSkillRoot } = await import("../src/validate/skill-root.js");
  const { inspectAgentSkillDocument } = await import("../src/validate/skill-document.js");
  const diagnostics = new DiagnosticCollector();
  const root = await inspectAgentSkillRoot(fixture.directory, diagnostics);
  if (root === undefined) throw new Error("expected genuine root");
  const document = await inspectAgentSkillDocument(root, diagnostics);
  if (document === undefined) throw new Error("expected genuine document");
  return document;
}

async function genuineDocument(name: string, source: string) {
  const fixture = await fixtures.skill(name, source);
  return { fixture, document: await inspectDocument(fixture) };
}

describe("Markdown resource graph", () => {
  it("builds the bounded CommonMark graph from a genuine stable resource tree", async () => {
    const body = [
      "# Graph",
      "",
      "[guide](docs/guide.md)",
      "![picture](assets/picture.png)",
      "[data](data.txt)",
      "[missing](missing.md)",
      "[external](https://example.com/)",
      "[section](#graph)",
      "[reference][details]",
      "",
      "[details]: docs/details.md",
      "",
    ].join("\n");
    const source = skillDocument(
      "name: graph\ndescription: Markdown graph fixture.\nlicense: MIT",
      body,
    );
    const guide = "[details](docs/details.md) and [root](SKILL.md)\n";
    const details = "# Details\n";
    const fixture = await fixtures.skill("graph", source);
    await mkdir(join(fixture.directory, "docs"));
    await mkdir(join(fixture.directory, "assets"));
    await writeFile(join(fixture.directory, "docs", "guide.md"), guide);
    await writeFile(join(fixture.directory, "docs", "details.md"), details);
    await writeFile(join(fixture.directory, "assets", "picture.png"), "png");
    await writeFile(join(fixture.directory, "data.txt"), "data");
    const document = await inspectDocument(fixture);

    const graphModule = await import(graphPath);
    const result = await graphModule.buildInspectedMarkdownResourceGraph(document);
    expect(result.ok).toBe(true);
    if (!result.ok || !("graph" in result)) throw new Error("expected graph success");
    expect(result.documentText).toBe(source);
    expectBarrier(result, ["ok", "documentText", "resourceFindings", "graph"]);
    expect(result.resourceFindings).toEqual([]);
    expect(graphModule.isGenuineBundledResourceNameFindings(result.resourceFindings)).toBe(true);
    expect(graphModule.isGenuineBundledResourceNameFindings([...result.resourceFindings])).toBe(
      false,
    );
    expect(
      graphModule.isGenuineBundledResourceNameFindings(new Proxy(result.resourceFindings, {})),
    ).toBe(false);
    expectBarrier(result.graph, [
      "surface",
      "complete",
      "documents",
      "edges",
      "reachableFiles",
      "findings",
      "totals",
    ]);
    expectDeepFrozen(result);
    expect(result.graph.surface).toBe("commonmark-links-images-v1");
    expect(result.graph.complete).toBe(true);
    expect(result.graph.reachableFiles).toEqual([
      "SKILL.md",
      "docs/guide.md",
      "docs/details.md",
      "assets/picture.png",
      "data.txt",
    ]);
    expect(result.graph.documents.map(({ file, depth }) => [file, depth])).toEqual([
      ["SKILL.md", 0],
      ["docs/guide.md", 1],
      ["docs/details.md", 2],
    ]);
    expect(result.graph.edges.map(({ from, to, kind, form }) => [from, to, kind, form])).toEqual([
      ["SKILL.md", "docs/guide.md", "link", "inline"],
      ["docs/guide.md", "docs/details.md", "link", "inline"],
      ["docs/guide.md", "SKILL.md", "link", "inline"],
      ["SKILL.md", "assets/picture.png", "image", "inline"],
      ["SKILL.md", "data.txt", "link", "inline"],
      ["SKILL.md", "docs/details.md", "link", "reference"],
    ]);
    expect(result.graph.findings).toEqual([
      {
        kind: "resolution",
        reason: "missing",
        file: "SKILL.md",
        target: "missing.md",
        location: expect.any(Object),
        componentIndex: 0,
      },
    ]);
    const analyses = [analyzeMarkdown(body), analyzeMarkdown(guide), analyzeMarkdown(details)];
    expect(result.graph.totals).toEqual({
      files: 3,
      bytes: Buffer.byteLength(source) + Buffer.byteLength(guide) + Buffer.byteLength(details),
      nodes: analyses.reduce((total, value) => total + value.nodeCount, 0),
      targets: analyses.reduce((total, value) => total + value.targets.length, 0),
      work: 33,
      components: 11,
      aliasCandidates: 0,
    });
    expect(JSON.stringify(result)).not.toContain(fixture.directory);
  });

  it("returns frozen graphless lexical results and preserves outer session failures", async () => {
    const graphModule = await import(graphPath);
    const plainFixture = await fixtures.skill("graphless", "plain Markdown\n");
    await mkdir(join(plainFixture.directory, "nested"));
    await writeFile(join(plainFixture.directory, "nested", ".ENV.local"), Buffer.from([0xff]));
    await writeFile(join(plainFixture.directory, "nested", "secret.PEM"), "x".repeat(524_289));
    const plain = { fixture: plainFixture, document: await inspectDocument(plainFixture) };
    const graphless = await graphModule.buildInspectedMarkdownResourceGraph(plain.document);
    expect(graphless).toEqual({
      ok: true,
      documentText: "plain Markdown\n",
      resourceFindings: [
        { kind: "environment_file", file: "nested/.ENV.local" },
        { kind: "credential_file", file: "nested/secret.PEM" },
      ],
    });
    expectBarrier(graphless, ["ok", "documentText", "resourceFindings"]);
    expectDeepFrozen(graphless);

    const hugeSource = skillDocument(
      "name: huge\ndescription: Huge graph fixture.\nlicense: MIT",
      "x".repeat(512 * 1024),
    );
    const huge = await genuineDocument("huge", hugeSource);
    const tooLarge = await graphModule.buildInspectedMarkdownResourceGraph(huge.document);
    expect(tooLarge).toEqual({ ok: false, reason: "too_large" });
    expectBarrier(tooLarge, ["ok", "reason"]);
    expect(await graphModule.buildInspectedMarkdownResourceGraph({})).toEqual({
      ok: false,
      reason: "invalid_input",
    });
    const controller = new AbortController();
    controller.abort();
    expect(
      await graphModule.buildInspectedMarkdownResourceGraph(plain.document, controller.signal),
    ).toEqual({ ok: false, reason: "aborted" });
  });
});

type MockEntry = Readonly<{
  role: "document" | "resource-file" | "directory";
  layout: Readonly<{ entryIndex: number; exactName: string; relativePath: string }>;
  metadata: Readonly<{ size: bigint; kind: "file" | "directory" }>;
}>;
type MockAnalysis = Readonly<{
  nodeCount: number;
  targets: readonly ReturnType<typeof mockTarget>[];
  issues: readonly ReturnType<typeof mockIssue>[];
}>;
type FileSpec = Readonly<{
  path: string;
  text: string;
  analysis?: MockAnalysis;
  role?: MockEntry["role"];
  size?: bigint;
  exactName?: string;
}>;

function terminalName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

function rawEntry(
  role: unknown = "document",
  path: unknown = "SKILL.md",
  size: unknown = 1n,
  kind: unknown = "file",
  entryIndex: unknown = 0,
  exactName: unknown = typeof path === "string" ? terminalName(path) : path,
) {
  return Object.freeze({
    role,
    layout: Object.freeze({ entryIndex, exactName, relativePath: path }),
    metadata: Object.freeze({ size, kind }),
  });
}

function mockLocation(line = 1, column = 1) {
  return Object.freeze({ line, column });
}

function mockTarget(
  url: string,
  options: Readonly<{
    kind?: "link" | "image";
    form?: "inline" | "reference";
    line?: number;
    column?: number;
    destinationLine?: number;
  }> = {},
) {
  const usage = mockLocation(options.line, options.column);
  return Object.freeze({
    kind: options.kind ?? "link",
    form: options.form ?? "inline",
    url,
    location: usage,
    destinationLocation:
      options.destinationLine === undefined
        ? usage
        : mockLocation(options.destinationLine, options.column),
  });
}

function mockIssue(
  code:
    | "skill.markdown.complexity"
    | "skill.markdown.duplicate_definition"
    | "skill.markdown.parse"
    | "skill.markdown.too_many_definitions"
    | "skill.markdown.too_large"
    | "skill.markdown.too_many_targets",
  at?: Readonly<{ line: number; column: number }>,
) {
  return Object.freeze(
    at === undefined
      ? { code, message: "private producer message" }
      : { code, message: "private producer message", location: at },
  );
}

const EMPTY_ANALYSIS = Object.freeze({
  nodeCount: 1,
  targets: Object.freeze([]),
  issues: Object.freeze([]),
}) as MockAnalysis;

function mockAnalysis(
  targets: readonly ReturnType<typeof mockTarget>[] = [],
  issues: readonly ReturnType<typeof mockIssue>[] = [],
  nodeCount = 1,
): MockAnalysis {
  return Object.freeze({
    nodeCount,
    targets: Object.freeze([...targets]),
    issues: Object.freeze([...issues]),
  });
}

type MockState = {
  session: Readonly<{ entries: readonly MockEntry[] }>;
  index: object;
  entries: MockEntry[];
  readonly texts: Map<object, string>;
  readonly analyses: Map<string, MockAnalysis>;
  readonly genuineAnalyses: WeakSet<object>;
  readonly genuineResourceNames: WeakSet<object>;
  readonly paths: Map<string, number>;
  readonly calls: {
    open: unknown[][];
    read: unknown[][];
    current: unknown[][];
    create: unknown[][];
    resolve: unknown[][];
    project: unknown[][];
    analyze: unknown[][];
    classify: unknown[][];
    component: unknown[][];
    genuineSession: unknown[][];
    genuineAnalysis: unknown[][];
    resourceClassify: unknown[][];
    genuineResourceName: unknown[][];
  };
  projectResult: unknown;
  openImpl: (...args: unknown[]) => unknown;
  readImpl: (...args: unknown[]) => unknown;
  currentImpl: (...args: unknown[]) => unknown;
  createImpl: (...args: unknown[]) => unknown;
  resolveImpl: (...args: unknown[]) => unknown;
  projectImpl: (...args: unknown[]) => unknown;
  analyzeImpl: (...args: unknown[]) => unknown;
  classifyImpl: (...args: unknown[]) => unknown;
  componentImpl: (...args: unknown[]) => unknown;
  genuineSessionImpl: (...args: unknown[]) => unknown;
  genuineAnalysisImpl: (...args: unknown[]) => unknown;
  resourceClassifyImpl: (...args: unknown[]) => unknown;
  genuineResourceNameImpl: (...args: unknown[]) => unknown;
};

function envelopeFor(text: string) {
  const closing = text.indexOf("\n---\n", 4);
  if (closing < 0) return Object.freeze({ ok: false as const, reason: "missing_frontmatter" });
  const bodyStartOffset = closing + 5;
  const yaml = text.slice(4, closing);
  return Object.freeze({
    ok: true as const,
    envelope: Object.freeze({
      yaml,
      body: text.slice(bodyStartOffset),
      bodyStartLine: text.slice(0, bodyStartOffset).split("\n").length,
      bodyStartOffset,
    }),
  });
}

function makeState(specs: readonly FileSpec[]): MockState {
  const texts = new Map<object, string>();
  const analyses = new Map<string, MockAnalysis>();
  const genuineAnalyses = new WeakSet<object>();
  const genuineResourceNames = new WeakSet<object>();
  const paths = new Map<string, number>();
  const entries = specs.map((spec, entryIndex) => {
    const role = spec.role ?? (entryIndex === 0 ? "document" : "resource-file");
    const entry = Object.freeze({
      role,
      layout: Object.freeze({
        entryIndex,
        exactName: spec.exactName ?? terminalName(spec.path),
        relativePath: spec.path,
      }),
      metadata: Object.freeze({
        size: spec.size ?? BigInt(Buffer.byteLength(spec.text)),
        kind: role === "directory" ? ("directory" as const) : ("file" as const),
      }),
    });
    texts.set(entry, spec.text);
    paths.set(spec.path, entryIndex);
    const analysis = spec.analysis ?? EMPTY_ANALYSIS;
    const projected = envelopeFor(spec.text);
    analyses.set(
      role === "document" && projected.ok ? projected.envelope.body : spec.text,
      analysis,
    );
    genuineAnalyses.add(analysis);
    return entry;
  });
  const calls = {
    open: [] as unknown[][],
    read: [] as unknown[][],
    current: [] as unknown[][],
    create: [] as unknown[][],
    resolve: [] as unknown[][],
    project: [] as unknown[][],
    analyze: [] as unknown[][],
    classify: [] as unknown[][],
    component: [] as unknown[][],
    genuineSession: [] as unknown[][],
    genuineAnalysis: [] as unknown[][],
    resourceClassify: [] as unknown[][],
    genuineResourceName: [] as unknown[][],
  };
  const state = {} as MockState;
  state.entries = entries;
  state.session = Object.freeze({ entries: Object.freeze(entries) });
  state.index = Object.freeze({});
  state.texts = texts;
  state.analyses = analyses;
  state.genuineAnalyses = genuineAnalyses;
  state.genuineResourceNames = genuineResourceNames;
  state.paths = paths;
  state.calls = calls;
  state.projectResult = envelopeFor(specs[0]?.text ?? "");
  state.openImpl = () => Promise.resolve(barrier({ ok: true as const, session: state.session }));
  state.readImpl = (_session, entry) => {
    const text = texts.get(entry as object);
    return Promise.resolve(
      text === undefined
        ? barrier({ ok: false as const, reason: "invalid_input" as const })
        : barrier({ ok: true as const, text, byteLength: Buffer.byteLength(text) }),
    );
  };
  state.currentImpl = () => Promise.resolve(barrier({ ok: true as const, current: true }));
  state.createImpl = () => Object.freeze({ ok: true as const, index: state.index });
  state.resolveImpl = (_index, components) => {
    const path = (components as string[]).join("/");
    const entryIndex = paths.get(path);
    return entryIndex === undefined
      ? Object.freeze({ ok: false as const, reason: "missing" as const, componentIndex: 0 })
      : Object.freeze({ ok: true as const, entryIndex });
  };
  state.projectImpl = () => state.projectResult;
  state.analyzeImpl = (text) => analyses.get(text as string) ?? EMPTY_ANALYSIS;
  state.classifyImpl = (url) => {
    if (typeof url !== "string")
      return Object.freeze({ kind: "invalid" as const, reason: "type" as const });
    if (url.startsWith("#")) return Object.freeze({ kind: "document" as const });
    if (url.startsWith("https://")) return Object.freeze({ kind: "external" as const });
    const components = Object.freeze(url.split("/"));
    return Object.freeze({ kind: "local" as const, path: url, components });
  };
  state.componentImpl = () => true;
  state.genuineSessionImpl = (value) => value === state.session;
  state.genuineAnalysisImpl = (value) =>
    typeof value === "object" && value !== null && state.genuineAnalyses.has(value as object);
  const safeResourceName = Object.freeze({ ok: true as const });
  genuineResourceNames.add(safeResourceName);
  state.resourceClassifyImpl = () => safeResourceName;
  state.genuineResourceNameImpl = (value) =>
    typeof value === "object" && value !== null && genuineResourceNames.has(value as object);
  return state;
}

function resourceClassification(
  state: MockState,
  reason?: "invalid_input" | "environment_file" | "credential_file",
) {
  const result = Object.freeze(
    reason === undefined ? { ok: true as const } : { ok: false as const, reason },
  );
  state.genuineResourceNames.add(result);
  return result;
}

async function mockedGraph(state: MockState) {
  vi.doMock(sessionPath, () => ({
    isGenuineResourceTreeSession: function (this: unknown, ...args: unknown[]) {
      record(state.calls.genuineSession, [this, ...args]);
      return state.genuineSessionImpl(...args);
    },
    openInspectedResourceTreeSession: function (this: unknown, ...args: unknown[]) {
      record(state.calls.open, [this, ...args]);
      return state.openImpl(...args);
    },
    readResourceTreeSessionUtf8Member: function (this: unknown, ...args: unknown[]) {
      record(state.calls.read, [this, ...args]);
      return state.readImpl(...args);
    },
    resourceTreeSessionIsCurrent: function (this: unknown, ...args: unknown[]) {
      record(state.calls.current, [this, ...args]);
      return state.currentImpl(...args);
    },
  }));
  vi.doMock(indexPath, () => ({
    createResourceTreePathIndex: function (this: unknown, ...args: unknown[]) {
      record(state.calls.create, [this, ...args]);
      return state.createImpl(...args);
    },
    resolveResourceTreePath: function (this: unknown, ...args: unknown[]) {
      record(state.calls.resolve, [this, ...args]);
      return state.resolveImpl(...args);
    },
  }));
  vi.doMock(sourcePath, () => ({
    projectSkillDocumentEnvelope: function (this: unknown, ...args: unknown[]) {
      record(state.calls.project, [this, ...args]);
      return state.projectImpl(...args);
    },
  }));
  vi.doMock(analysisPath, () => ({
    analyzeMarkdown: function (this: unknown, ...args: unknown[]) {
      record(state.calls.analyze, [this, ...args]);
      return state.analyzeImpl(...args);
    },
    isGenuineMarkdownAnalysis: function (this: unknown, ...args: unknown[]) {
      record(state.calls.genuineAnalysis, [this, ...args]);
      return state.genuineAnalysisImpl(...args);
    },
  }));
  vi.doMock(destinationPath, () => ({
    classifyMarkdownDestination: function (this: unknown, ...args: unknown[]) {
      record(state.calls.classify, [this, ...args]);
      return state.classifyImpl(...args);
    },
    isCanonicalDecodedMarkdownLocalComponent: function (this: unknown, ...args: unknown[]) {
      record(state.calls.component, [this, ...args]);
      return state.componentImpl(...args);
    },
  }));
  vi.doMock(resourceNamePath, () => ({
    classifyBundledResourceFileName: function (this: unknown, ...args: unknown[]) {
      record(state.calls.resourceClassify, [this, ...args]);
      return state.resourceClassifyImpl(...args);
    },
    isGenuineBundledResourceFileNameClassification: function (this: unknown, ...args: unknown[]) {
      record(state.calls.genuineResourceName, [this, ...args]);
      return state.genuineResourceNameImpl(...args);
    },
  }));
  vi.resetModules();
  return import(graphPath);
}

async function builtMockGraph(state: MockState) {
  const graphModule = await mockedGraph(state);
  const result = await graphModule.buildInspectedMarkdownResourceGraph(MOCK_DOCUMENT);
  if (!result.ok || !("graph" in result)) throw new Error("expected mocked graph success");
  return result.graph;
}

async function expectMockFailure(
  state: MockState,
  reason: string = "inconsistent",
  signal?: unknown,
): Promise<void> {
  const graphModule = await mockedGraph(state);
  expect(await graphModule.buildInspectedMarkdownResourceGraph(MOCK_DOCUMENT, signal)).toEqual({
    ok: false,
    reason,
  });
}

function linkedFiles(count: number, nodeCounts?: readonly number[]): MockState {
  const targets = Array.from({ length: count }, (_, index) => mockTarget(`file-${index}.md`));
  return makeState([
    {
      path: "SKILL.md",
      text: MOCK_ROOT,
      analysis: mockAnalysis(targets, [], nodeCounts?.[0] ?? 1),
    },
    ...targets.map((target, index) => ({
      path: target.url,
      text: `content-${index}`,
      analysis: mockAnalysis([], [], nodeCounts?.[index + 1] ?? 1),
    })),
  ]);
}

type MutableMockEntry = {
  role: MockEntry["role"];
  layout: { entryIndex: number; exactName: string; relativePath: string };
  metadata: { size: bigint; kind: "file" | "directory" };
};

function mutableState(specs: readonly FileSpec[]) {
  const state = makeState(specs);
  const entries: MutableMockEntry[] = state.entries.map((entry) => ({
    role: entry.role,
    layout: {
      entryIndex: entry.layout.entryIndex,
      exactName: entry.layout.exactName,
      relativePath: entry.layout.relativePath,
    },
    metadata: { size: entry.metadata.size, kind: entry.metadata.kind },
  }));
  const session = { entries };
  state.entries = entries;
  state.session = session;
  for (let index = 0; index < entries.length; index += 1)
    state.texts.set(entries[index] as MutableMockEntry, specs[index]?.text ?? "");
  return { entries, session, state };
}

function requiredEntry(entries: MutableMockEntry[], index: number): MutableMockEntry {
  const entry = entries[index];
  if (entry === undefined) throw new Error("expected mutable mock entry");
  return entry;
}

const MOCK_ROOT = skillDocument("name: mocked\ndescription: Mock graph.\nlicense: MIT", "root");
const MOCK_DOCUMENT = Object.freeze({ marker: "document" });

describe("isolated Markdown resource graph producers", () => {
  it("locks open priority and rejects nonnative Promise assimilation property-free", async () => {
    const state = makeState([{ path: "SKILL.md", text: MOCK_ROOT }]);
    const graphModule = await mockedGraph(state);
    const controller = new AbortController();
    controller.abort();
    state.openImpl = () => Promise.resolve(barrier({ ok: false as const, reason: "io" as const }));
    expect(
      await graphModule.buildInspectedMarkdownResourceGraph(MOCK_DOCUMENT, controller.signal),
    ).toEqual({ ok: false, reason: "io" });

    state.openImpl = () => Promise.reject(new Error("private rejection"));
    expect(
      await graphModule.buildInspectedMarkdownResourceGraph(MOCK_DOCUMENT, controller.signal),
    ).toEqual({ ok: false, reason: "aborted" });
    state.openImpl = () => Promise.resolve(Object.freeze({ ok: "malformed" }));
    expect(await graphModule.buildInspectedMarkdownResourceGraph(MOCK_DOCUMENT)).toEqual({
      ok: false,
      reason: "inconsistent",
    });
    state.openImpl = () => Promise.resolve(runInNewContext("({ok:false,reason:'io'})"));
    expect(await graphModule.buildInspectedMarkdownResourceGraph(MOCK_DOCUMENT)).toEqual({
      ok: false,
      reason: "inconsistent",
    });

    const failureShapedSession = Object.freeze({ ok: false as const, reason: "io" as const });
    state.openImpl = () =>
      Promise.resolve(barrier({ ok: true as const, session: failureShapedSession }));
    expect(await graphModule.buildInspectedMarkdownResourceGraph(MOCK_DOCUMENT)).toEqual({
      ok: false,
      reason: "inconsistent",
    });
    const queued = new AbortController();
    state.openImpl = () => {
      const result = Promise.resolve(barrier({ ok: true as const, session: failureShapedSession }));
      queueMicrotask(() => queued.abort());
      return result;
    };
    expect(
      await graphModule.buildInspectedMarkdownResourceGraph(MOCK_DOCUMENT, queued.signal),
    ).toEqual({ ok: false, reason: "aborted" });

    let thenGets = 0;
    class HostilePromise<T> extends Promise<T> {
      // biome-ignore lint/suspicious/noThenProperty: this regression rejects Promise subclasses.
      override get then(): Promise<T>["then"] {
        thenGets += 1;
        throw new Error("must not assimilate a Promise subclass");
      }
    }
    state.openImpl = () =>
      new HostilePromise((resolve) =>
        resolve(barrier({ ok: true as const, session: state.session })),
      );
    expect(await graphModule.buildInspectedMarkdownResourceGraph(MOCK_DOCUMENT)).toEqual({
      ok: false,
      reason: "inconsistent",
    });
    expect(thenGets).toBe(0);

    let constructorGets = 0;
    const original = Object.getOwnPropertyDescriptor(Promise.prototype, "constructor");
    const callsBeforePoison = state.calls.open.length;
    let poisonedPending: Promise<unknown> | undefined;
    try {
      Object.defineProperty(Promise.prototype, "constructor", {
        configurable: true,
        get() {
          constructorGets += 1;
          throw new Error("must inspect the descriptor only");
        },
      });
      poisonedPending = graphModule.buildInspectedMarkdownResourceGraph(MOCK_DOCUMENT);
    } finally {
      if (original !== undefined) Object.defineProperty(Promise.prototype, "constructor", original);
    }
    expect(await poisonedPending).toEqual({ ok: false, reason: "inconsistent" });
    expect(constructorGets).toBe(0);
    expect(state.calls.open).toHaveLength(callsBeforePoison);
    expect(state.calls.open[0]).toEqual([undefined, MOCK_DOCUMENT, controller.signal, undefined]);
  });

  it("fully replays B before indexing and retains its copied identities and metadata", async () => {
    const invalidCases = [
      { entries: [rawEntry("document", "SKILL.md", -1n)], reason: "invalid_metadata" },
      { entries: [rawEntry("document", "SKILL.md", 1)], reason: "inconsistent" },
      {
        entries: [
          rawEntry("document", "SKILL.md", 524_289n),
          rawEntry("resource-file", "later.txt", -1n, "file", 1),
        ],
        reason: "invalid_metadata",
      },
      { entries: [], reason: "inconsistent" },
      {
        entries: [rawEntry(), rawEntry("document", "SKILL.md", 1n, "file", 1)],
        reason: "inconsistent",
      },
      { entries: {}, reason: "inconsistent" },
      { entries: new Array(8_193), reason: "inconsistent" },
      { entries: [null], reason: "inconsistent" },
      { entries: [rawEntry("unknown")], reason: "inconsistent" },
      { entries: [rawEntry("document", "SKILL.md", 1n, "directory")], reason: "inconsistent" },
      { entries: [rawEntry("document", "wrong.md")], reason: "inconsistent" },
      {
        entries: [rawEntry("document", "SKILL.md", 1n, "file", 0, "wrong.md")],
        reason: "inconsistent",
      },
    ] as const;
    for (const invalid of invalidCases) {
      const state = makeState([{ path: "SKILL.md", text: MOCK_ROOT }]);
      state.session = Object.freeze({ entries: Object.freeze(invalid.entries) }) as never;
      const graphModule = await mockedGraph(state);
      expect(await graphModule.buildInspectedMarkdownResourceGraph(MOCK_DOCUMENT)).toEqual({
        ok: false,
        reason: invalid.reason,
      });
      expect(state.calls.create).toHaveLength(0);
      expect(state.calls.read).toHaveLength(0);
      expect(state.calls.current).toHaveLength(0);
    }

    const rootEntry = {
      role: "document" as const,
      layout: { entryIndex: 0, exactName: "SKILL.md", relativePath: "SKILL.md" },
      metadata: { size: BigInt(Buffer.byteLength(MOCK_ROOT)), kind: "file" as const },
    };
    const state = makeState([{ path: "SKILL.md", text: MOCK_ROOT }]);
    state.entries = [rootEntry] as MockEntry[];
    state.session = Object.freeze({ entries: Object.freeze([rootEntry]) }) as never;
    state.texts.set(rootEntry, MOCK_ROOT);
    state.createImpl = () => {
      rootEntry.layout.relativePath = "mutated.md";
      rootEntry.metadata.size = 0n;
      return Object.freeze({ ok: true as const, index: state.index });
    };
    const graphModule = await mockedGraph(state);
    const result = await graphModule.buildInspectedMarkdownResourceGraph(MOCK_DOCUMENT);
    expect(result).toEqual({ ok: false, reason: "inconsistent" });
    expect(state.calls.create[0]).toEqual([undefined, state.session]);
    expect(state.calls.read).toHaveLength(0);
    expect(state.calls.current).toHaveLength(0);

    const badIndex = makeState([{ path: "SKILL.md", text: MOCK_ROOT }]);
    badIndex.createImpl = () => Object.freeze({ ok: false as const, reason: "invalid_input" });
    await expectMockFailure(badIndex);
    expect(badIndex.calls.read).toHaveLength(0);
  });

  it("scans every retained resource basename at the exact inventory and name limits", async () => {
    const exact = makeState([
      { path: "SKILL.md", text: MOCK_ROOT },
      ...Array.from({ length: 8_191 }, (_, index) => ({
        path: `resource-${index}`,
        text: "",
        exactName: index === 8_190 ? "x".repeat(255) : `resource-${index}`,
      })),
    ]);
    const exactModule = await mockedGraph(exact);
    const exactResult = await exactModule.buildInspectedMarkdownResourceGraph(MOCK_DOCUMENT);
    expect(exactResult.ok).toBe(true);
    expect(exact.calls.resourceClassify).toHaveLength(8_191);
    expect(exact.calls.resourceClassify[0]).toEqual([undefined, "resource-0"]);
    expect(exact.calls.resourceClassify.at(-1)).toEqual([undefined, "x".repeat(255)]);
    expect([exact.calls.read.length, exact.calls.current.length]).toEqual([1, 1]);

    const oversized = makeState([
      { path: "SKILL.md", text: MOCK_ROOT },
      { path: "oversized", exactName: "x".repeat(256), text: "unread" },
    ]);
    oversized.resourceClassifyImpl = () => resourceClassification(oversized, "invalid_input");
    await expectMockFailure(oversized);
    expect([oversized.calls.read.length, oversized.calls.current.length]).toEqual([0, 0]);
  }, 60_000);

  it("fails closed on hostile resource classifiers before reading any member", async () => {
    let gets = 0;
    for (const mode of [
      "invalid",
      "throw",
      "nongenuine",
      "predicateThrow",
      "predicateTruthy",
    ] as const) {
      const state = makeState([
        { path: "SKILL.md", text: MOCK_ROOT, size: 524_289n },
        { path: ".env", text: "unread" },
      ]);
      const hostile = Object.defineProperty({}, "ok", {
        get() {
          gets += 1;
          throw new Error("non-genuine result must remain opaque");
        },
      });
      state.resourceClassifyImpl =
        mode === "invalid"
          ? () => resourceClassification(state, "invalid_input")
          : mode === "throw"
            ? () => {
                throw new Error("private classifier failure");
              }
            : () => hostile;
      if (mode === "predicateThrow")
        state.genuineResourceNameImpl = () => {
          throw new Error("private predicate failure");
        };
      if (mode === "predicateTruthy") state.genuineResourceNameImpl = () => ({ truthy: true });
      await expectMockFailure(state);
      expect([
        state.calls.read.length,
        state.calls.analyze.length,
        state.calls.current.length,
      ]).toEqual([0, 0, 0]);
    }
    expect(gets).toBe(0);
  });

  it("retains resource findings only after root and graph outcomes are known", async () => {
    for (const rootResult of ["too_large", "io"] as const) {
      const state = makeState([
        {
          path: "SKILL.md",
          text: MOCK_ROOT,
          size: rootResult === "too_large" ? 524_289n : undefined,
        },
        { path: ".env", text: "unread" },
      ]);
      const unsafe = resourceClassification(state, "environment_file");
      state.resourceClassifyImpl = () => unsafe;
      if (rootResult === "io")
        state.readImpl = () =>
          Promise.resolve(barrier({ ok: false as const, reason: "io" as const }));
      const graphModule = await mockedGraph(state);
      const result = await graphModule.buildInspectedMarkdownResourceGraph(MOCK_DOCUMENT);
      expect(result).toEqual({ ok: false, reason: rootResult });
      expect(JSON.stringify(result)).not.toContain("environment_file");
      expect([state.calls.read.length, state.calls.current.length]).toEqual([
        rootResult === "io" ? 1 : 0,
        0,
      ]);
    }

    const budget = makeState([
      { path: "SKILL.md", text: MOCK_ROOT, analysis: mockAnalysis([], [], 100_001) },
      { path: "secret.pem", text: "unread" },
    ]);
    const unsafe = resourceClassification(budget, "credential_file");
    budget.resourceClassifyImpl = () => unsafe;
    const budgetModule = await mockedGraph(budget);
    const result = await budgetModule.buildInspectedMarkdownResourceGraph(MOCK_DOCUMENT);
    expect(result.ok).toBe(true);
    if (!result.ok || !("graph" in result)) throw new Error("expected graph result");
    expect(result.resourceFindings).toEqual([{ kind: "credential_file", file: "secret.pem" }]);
    expect(result.graph.findings).toContainEqual({
      kind: "budget",
      limit: "nodes",
      file: "SKILL.md",
      location: expect.any(Object),
    });
    expect(result.graph.complete).toBe(false);
    expect(budget.calls.current).toHaveLength(1);
  });

  it("rejects post-scan inventory mutation before the first member read", async () => {
    const mutations = [
      (entries: MutableMockEntry[]) => (requiredEntry(entries, 1).layout.exactName = "changed"),
      (entries: MutableMockEntry[]) => (requiredEntry(entries, 1).role = "directory"),
      (entries: MutableMockEntry[]) => (entries[1] = { ...requiredEntry(entries, 1) }),
      (entries: MutableMockEntry[]) => {
        const entry = requiredEntry(entries, 1);
        entry.layout = { ...entry.layout };
      },
      (entries: MutableMockEntry[], session: { entries: MutableMockEntry[] }) =>
        (session.entries = [...entries]),
    ];
    for (const mutate of mutations) {
      const { entries, session, state } = mutableState([
        { path: "SKILL.md", text: MOCK_ROOT },
        { path: "first.bin", text: "unread" },
        { path: "last.bin", text: "unread" },
      ]);
      state.genuineResourceNameImpl = (value) => {
        if (state.calls.genuineResourceName.length === 2) mutate(entries, session);
        return typeof value === "object" && value !== null && state.genuineResourceNames.has(value);
      };
      await expectMockFailure(state);
      expect([
        state.calls.resourceClassify.length,
        state.calls.read.length,
        state.calls.current.length,
      ]).toEqual([2, 0, 0]);
    }

    let gets = 0;
    let samples = 0;
    vi.doMock(abortPath, () => ({
      sampleAbortSignal: () => (++samples === 6 ? "aborted" : "active"),
    }));
    const aborted = mutableState([
      { path: "SKILL.md", text: MOCK_ROOT },
      { path: "asset.bin", text: "unread" },
    ]);
    aborted.state.genuineResourceNameImpl = (value) => {
      Object.defineProperty(requiredEntry(aborted.entries, 1).layout, "exactName", {
        get() {
          gets += 1;
          throw new Error("replay must remain property-free");
        },
      });
      return aborted.state.genuineResourceNames.has(value as object);
    };
    await expectMockFailure(aborted.state, "aborted", {});
    expect([
      samples,
      gets,
      aborted.state.calls.read.length,
      aborted.state.calls.current.length,
    ]).toEqual([6, 0, 0, 0]);
  });

  it("revalidates every exact B binding after producers and before publication", async () => {
    const mutateAfterResolve: readonly Readonly<{
      name: string;
      mutate: (entries: MutableMockEntry[], session: { entries: MutableMockEntry[] }) => void;
    }>[] = [
      { name: "entries identity", mutate: (entries, session) => (session.entries = [...entries]) },
      {
        name: "slot identity",
        mutate: (entries) => (entries[1] = { ...entries[1] } as MutableMockEntry),
      },
      { name: "role", mutate: (entries) => (requiredEntry(entries, 1).role = "directory") },
      {
        name: "layout identity",
        mutate: (entries) => {
          const entry = requiredEntry(entries, 1);
          entry.layout = { ...entry.layout };
        },
      },
      {
        name: "entry index",
        mutate: (entries) => (requiredEntry(entries, 1).layout.entryIndex = 0),
      },
      {
        name: "path",
        mutate: (entries) => (requiredEntry(entries, 1).layout.relativePath = "other.md"),
      },
      {
        name: "metadata identity",
        mutate: (entries) => {
          const entry = requiredEntry(entries, 1);
          entry.metadata = { ...entry.metadata };
        },
      },
      { name: "size", mutate: (entries) => (requiredEntry(entries, 1).metadata.size += 1n) },
      {
        name: "kind",
        mutate: (entries) => (requiredEntry(entries, 1).metadata.kind = "directory"),
      },
    ];
    for (const mutation of mutateAfterResolve) {
      const { entries, session, state } = mutableState([
        {
          path: "SKILL.md",
          text: MOCK_ROOT,
          analysis: mockAnalysis([mockTarget("child.md")]),
        },
        { path: "child.md", text: "child" },
      ]);
      state.resolveImpl = () => {
        mutation.mutate(entries, session);
        return Object.freeze({ ok: true as const, entryIndex: 1 });
      };
      const graphModule = await mockedGraph(state);
      expect(
        await graphModule.buildInspectedMarkdownResourceGraph(MOCK_DOCUMENT),
        mutation.name,
      ).toEqual({ ok: false, reason: "inconsistent" });
      expect(state.calls.read, mutation.name).toHaveLength(1);
      expect(state.calls.current, mutation.name).toHaveLength(0);
    }

    const finalCases = [
      { current: barrier({ ok: true as const, current: true }), reason: "inconsistent" },
      { current: barrier({ ok: true as const, current: false }), reason: "changed" },
      { current: barrier({ ok: false as const, reason: "io" as const }), reason: "io" },
    ] as const;
    for (const finalCase of finalCases) {
      const { entries, state } = mutableState([
        { path: "SKILL.md", text: MOCK_ROOT },
        { path: ".env", text: "unread" },
      ]);
      const staged = resourceClassification(state, "environment_file");
      state.resourceClassifyImpl = () => staged;
      state.currentImpl = () => {
        requiredEntry(entries, 1).metadata.size += 1n;
        return Promise.resolve(finalCase.current);
      };
      const graphModule = await mockedGraph(state);
      const finalResult = await graphModule.buildInspectedMarkdownResourceGraph(MOCK_DOCUMENT);
      expect(finalResult).toEqual({
        ok: false,
        reason: finalCase.reason,
      });
      expect(state.calls.current).toHaveLength(1);
      expect(JSON.stringify(finalResult)).not.toContain("environment_file");
    }
  });

  it("materializes ordered destination, resolution, read, and Markdown findings", async () => {
    const rootTargets = [
      mockTarget("bad"),
      mockTarget("missing.md"),
      mockTarget("alias.md"),
      mockTarget("ambiguous.md"),
      mockTarget("folder"),
      mockTarget("nested.md"),
      mockTarget("sibling.md"),
    ];
    const state = makeState([
      { path: "SKILL.md", text: MOCK_ROOT, analysis: mockAnalysis(rootTargets) },
      { path: "exact-alias.md", text: "alias" },
      { path: "one.md", text: "one" },
      { path: "two.md", text: "two" },
      { path: "folder", text: "", role: "directory" },
      {
        path: "nested.md",
        text: "nested",
        analysis: mockAnalysis([mockTarget("ignored.md")], [mockIssue("skill.markdown.parse")]),
      },
      { path: "sibling.md", text: "sibling" },
    ]);
    state.classifyImpl = (url) =>
      url === "bad"
        ? Object.freeze({ kind: "invalid" as const, reason: "query" as const })
        : Object.freeze({
            kind: "local" as const,
            path: url as string,
            components: Object.freeze([url as string]),
          });
    state.resolveImpl = (_index, components) => {
      const path = (components as string[])[0];
      if (path === "alias.md")
        return Object.freeze({
          ok: false as const,
          reason: "noncanonical" as const,
          componentIndex: 0,
          match: "fold" as const,
          exact: "exact-alias.md",
        });
      if (path === "ambiguous.md")
        return Object.freeze({
          ok: false as const,
          reason: "ambiguous" as const,
          componentIndex: 0,
          match: "fold" as const,
          exacts: Object.freeze(["one.md", "two.md"]),
        });
      return state.paths.has(path as string)
        ? Object.freeze({ ok: true as const, entryIndex: state.paths.get(path as string) })
        : Object.freeze({ ok: false as const, reason: "missing" as const, componentIndex: 0 });
    };
    const graphModule = await mockedGraph(state);
    const result = await graphModule.buildInspectedMarkdownResourceGraph(MOCK_DOCUMENT);
    expect(result.ok).toBe(true);
    if (!result.ok || !("graph" in result)) return;
    expect(result.graph.complete).toBe(false);
    expect(result.graph.documents.map(({ file }) => file)).toEqual([
      "SKILL.md",
      "nested.md",
      "sibling.md",
    ]);
    expect(
      result.graph.findings.map((finding) => [
        finding.kind,
        "reason" in finding ? finding.reason : finding.code,
      ]),
    ).toEqual([
      ["destination", "query"],
      ["resolution", "missing"],
      ["resolution", "noncanonical"],
      ["resolution", "ambiguous"],
      ["resolution", "not_file"],
      ["markdown", "skill.markdown.parse"],
    ]);
    expect(result.graph.findings[2]).toMatchObject({ exact: "exact-alias.md" });
    expect(result.graph.findings[3]).toMatchObject({ exacts: ["one.md", "two.md"] });
    expect(result.graph.totals.aliasCandidates).toBe(3);
    expect(state.calls.classify).toHaveLength(7);
    expect(state.calls.read).toHaveLength(3);
    expect(state.calls.analyze[0]?.[1]).toBe("root");
    expect(JSON.stringify(result)).not.toContain("private producer message");
  });

  it("merges source events stably and gives an issue the same-location tie", async () => {
    const state = makeState([
      {
        path: "SKILL.md",
        text: MOCK_ROOT,
        analysis: mockAnalysis(
          [
            mockTarget("first.md", { line: 1 }),
            mockTarget("second.md", { line: 2 }),
            mockTarget("third.md", { line: 3 }),
          ],
          [mockIssue("skill.markdown.duplicate_definition", mockLocation(2, 1))],
        ),
      },
    ]);
    const graph = await builtMockGraph(state);
    expect(graph.complete).toBe(true);
    expect(
      graph.findings.map((finding) =>
        finding.kind === "markdown"
          ? finding.code
          : finding.kind === "resolution"
            ? `${finding.kind}:${finding.target}`
            : finding.kind,
      ),
    ).toEqual([
      "resolution:first.md",
      "skill.markdown.duplicate_definition",
      "resolution:second.md",
      "resolution:third.md",
    ]);
    expect(state.calls.classify).toHaveLength(3);
  });

  it("keeps paths root-relative and bounds cycles, sharing, images, and nested read failures", async () => {
    const rootAnalysis = mockAnalysis([
      mockTarget("broken.md", { line: 2 }),
      mockTarget("docs/a.md", { line: 3 }),
      mockTarget("docs/b.md", { line: 4 }),
      mockTarget("picture.md", { kind: "image", line: 5 }),
      mockTarget("data.txt", { line: 6 }),
      mockTarget("broken.md", { line: 7 }),
    ]);
    const state = makeState([
      { path: "SKILL.md", text: MOCK_ROOT, analysis: rootAnalysis },
      { path: "broken.md", text: "broken" },
      {
        path: "docs/a.md",
        text: "a",
        analysis: mockAnalysis([mockTarget("SKILL.md"), mockTarget("shared.md")]),
      },
      { path: "docs/b.md", text: "b", analysis: mockAnalysis([mockTarget("shared.md")]) },
      { path: "shared.md", text: "shared" },
      { path: "picture.md", text: "picture" },
      { path: "data.txt", text: "data" },
    ]);
    const defaultRead = state.readImpl;
    state.readImpl = (session, entry, signal) =>
      entry === state.entries[1]
        ? Promise.resolve(barrier({ ok: false as const, reason: "io" as const }))
        : defaultRead(session, entry, signal);
    const graph = await builtMockGraph(state);
    expect(graph.complete).toBe(false);
    expect(graph.documents.map(({ file }) => file)).toEqual([
      "SKILL.md",
      "docs/a.md",
      "shared.md",
      "docs/b.md",
    ]);
    expect(graph.reachableFiles).toEqual([
      "SKILL.md",
      "broken.md",
      "docs/a.md",
      "shared.md",
      "docs/b.md",
      "picture.md",
      "data.txt",
    ]);
    expect(graph.findings).toContainEqual({
      kind: "read",
      reason: "io",
      file: "SKILL.md",
      target: "broken.md",
      location: expect.any(Object),
    });
    expect(state.calls.read).toHaveLength(5);
    const rootEnvelope = envelopeFor(MOCK_ROOT);
    if (!rootEnvelope.ok) throw new Error("expected mock envelope");
    expect(graph.edges[0]?.location.line).toBe(rootEnvelope.envelope.bodyStartLine + 1);
    expect(
      graph.edges.find((edge) => edge.from === "docs/a.md" && edge.to === "shared.md"),
    ).toBeDefined();
    expect(graph.edges.filter((edge) => edge.to === "shared.md")).toHaveLength(2);
    expect(graph.edges.filter((edge) => edge.to === "broken.md")).toHaveLength(2);
  });

  it("charges all seven graph budgets inclusively and stops the over-limit operation", async () => {
    type BudgetKey = "files" | "bytes" | "nodes" | "targets" | "work" | "components";
    const projectedRoot = envelopeFor(MOCK_ROOT);
    if (!projectedRoot.ok) throw new Error("expected projected mock root");
    const rootStartLine = projectedRoot.envelope.bodyStartLine;
    const bytesState = (overflow: boolean) => {
      const rootBytes = Buffer.byteLength(MOCK_ROOT);
      const sizes = [
        ...Array.from({ length: 15 }, () => 512 * 1024),
        8 * 1024 * 1024 - rootBytes - 15 * 512 * 1024,
        ...(overflow ? [1] : []),
      ];
      const targets = sizes.map((_, index) => mockTarget(`bytes-${index}.md`));
      return makeState([
        { path: "SKILL.md", text: MOCK_ROOT, analysis: mockAnalysis(targets) },
        ...sizes.map((size, index) => ({ path: `bytes-${index}.md`, text: "x".repeat(size) })),
      ]);
    };
    const targetsState = (count: number) =>
      makeState([
        {
          path: "SKILL.md",
          text: MOCK_ROOT,
          analysis: mockAnalysis(
            Array.from({ length: count }, (_, index) => mockTarget(`https://example.com/${index}`)),
          ),
        },
      ]);
    const workState = (issueCount: number) => {
      const issue = mockIssue("skill.markdown.duplicate_definition");
      return makeState([
        {
          path: "SKILL.md",
          text: MOCK_ROOT,
          analysis: mockAnalysis(
            Array.of(),
            Array.from({ length: issueCount }, () => issue),
          ),
        },
      ]);
    };
    const componentState = (overflow: boolean) => {
      const longPath = Array.from({ length: 64 }, (_, index) => `c${index}`).join("/");
      const targets = Array.from({ length: 128 }, () => mockTarget(longPath));
      if (overflow) targets.push(mockTarget("extra"));
      return makeState([{ path: "SKILL.md", text: MOCK_ROOT, analysis: mockAnalysis(targets) }]);
    };
    const cases: readonly Readonly<{
      key: BudgetKey;
      limit: number;
      overflowFile: string;
      overflowLine: number;
      make: () => readonly [MockState, MockState];
      sameStep: (exact: MockState, overflow: MockState) => void;
    }>[] = [
      {
        key: "files",
        limit: 256,
        overflowFile: "file-255.md",
        overflowLine: 1,
        make: () => [linkedFiles(255), linkedFiles(256)],
        sameStep: (exact, overflow) => {
          expect(exact.calls.read).toHaveLength(256);
          expect(overflow.calls.read).toHaveLength(256);
        },
      },
      {
        key: "bytes",
        limit: 8 * 1024 * 1024,
        overflowFile: "bytes-16.md",
        overflowLine: 1,
        make: () => [bytesState(false), bytesState(true)],
        sameStep: (exact, overflow) => {
          expect(exact.calls.read).toHaveLength(17);
          expect(overflow.calls.read).toHaveLength(17);
        },
      },
      {
        key: "nodes",
        limit: 100_000,
        overflowFile: "file-4.md",
        overflowLine: 1,
        make: () => [
          linkedFiles(4, [20_000, 20_000, 20_000, 20_000, 20_000]),
          linkedFiles(5, [20_000, 20_000, 20_000, 20_000, 20_000, 1]),
        ],
        sameStep: (exact, overflow) => {
          expect(exact.calls.analyze).toHaveLength(5);
          expect(overflow.calls.analyze).toHaveLength(6);
        },
      },
      {
        key: "targets",
        limit: 4_096,
        overflowFile: "SKILL.md",
        overflowLine: rootStartLine,
        make: () => [targetsState(4_096), targetsState(4_097)],
        sameStep: (exact, overflow) => {
          expect(exact.calls.classify).toHaveLength(4_096);
          expect(overflow.calls.classify).toHaveLength(4_096);
        },
      },
      {
        key: "work",
        limit: 128 * 1024,
        overflowFile: "SKILL.md",
        overflowLine: rootStartLine,
        make: () => [workState(128 * 1024 - 2), workState(128 * 1024 - 1)],
        sameStep: () => undefined,
      },
      {
        key: "components",
        limit: 8_192,
        overflowFile: "SKILL.md",
        overflowLine: rootStartLine,
        make: () => [componentState(false), componentState(true)],
        sameStep: (exact, overflow) => {
          expect(exact.calls.resolve).toHaveLength(128);
          expect(overflow.calls.resolve).toHaveLength(128);
        },
      },
    ];
    for (const budgetCase of cases) {
      const [exact, overflow] = budgetCase.make();
      const exactGraph = await builtMockGraph(exact);
      expect(exactGraph.totals[budgetCase.key]).toBe(budgetCase.limit);
      expect(exactGraph.findings.some((finding) => finding.kind === "budget")).toBe(false);
      expect(exactGraph.complete).toBe(true);
      expect(exact.calls.current).toHaveLength(1);
      const overflowGraph = await builtMockGraph(overflow);
      expect(overflowGraph.totals[budgetCase.key]).toBe(budgetCase.limit);
      expect(overflowGraph.findings.filter((finding) => finding.kind === "budget")).toEqual([
        {
          kind: "budget",
          limit: budgetCase.key,
          file: budgetCase.overflowFile,
          location: { line: budgetCase.overflowLine, column: 1 },
        },
      ]);
      expect(overflowGraph.complete).toBe(false);
      expect(overflow.calls.current).toHaveLength(1);
      budgetCase.sameStep(exact, overflow);
    }

    const exacts = Object.freeze(Array.from({ length: 1_024 }, (_, index) => `a${index}`));
    const aliasState = (overflow: boolean) => {
      const state = makeState([
        {
          path: "SKILL.md",
          text: MOCK_ROOT,
          analysis: mockAnalysis(
            Array.from({ length: overflow ? 9 : 8 }, (_, index) => mockTarget(`alias-${index}`)),
          ),
        },
      ]);
      let ordinal = 0;
      state.resolveImpl = () => {
        ordinal += 1;
        if (ordinal <= 8)
          return Object.freeze({
            ok: false as const,
            reason: "ambiguous" as const,
            componentIndex: 0,
            match: "fold" as const,
            exacts,
          });
        const result = {
          ok: false as const,
          reason: "noncanonical" as const,
          componentIndex: 0,
          match: "fold" as const,
        };
        Object.defineProperty(result, "exact", {
          get() {
            throw new Error("over-limit aliases must not read exact");
          },
        });
        return result;
      };
      return state;
    };
    const exactAliases = await builtMockGraph(aliasState(false));
    expect(exactAliases.totals.aliasCandidates).toBe(8_192);
    expect(exactAliases.complete).toBe(true);
    expect(exactAliases.findings.some((finding) => finding.kind === "budget")).toBe(false);
    const overflowAliasState = aliasState(true);
    const overflowAliases = await builtMockGraph(overflowAliasState);
    expect(overflowAliases.totals.aliasCandidates).toBe(8_192);
    expect(overflowAliases.findings.filter((finding) => finding.kind === "budget")).toEqual([
      {
        kind: "budget",
        limit: "alias_candidates",
        file: "SKILL.md",
        location: { line: rootStartLine, column: 1 },
      },
    ]);
    expect(overflowAliases.complete).toBe(false);
    expect(overflowAliasState.calls.current).toHaveLength(1);
  }, 60_000);

  it("lets settlement cancellation override read/current results and performs final currentness", async () => {
    const state = makeState([{ path: "SKILL.md", text: MOCK_ROOT }]);
    const graphModule = await mockedGraph(state);
    let resolveRead: ((value: unknown) => void) | undefined;
    state.readImpl = () =>
      new Promise((resolve) => {
        resolveRead = resolve;
      });
    const controller = new AbortController();
    const pending = graphModule.buildInspectedMarkdownResourceGraph(
      MOCK_DOCUMENT,
      controller.signal,
    );
    resolveRead?.(barrier({ ok: false as const, reason: "io" as const }));
    controller.abort();
    expect(await pending).toEqual({ ok: false, reason: "aborted" });
    expect(state.calls.current).toHaveLength(0);

    const currentState = makeState([{ path: "SKILL.md", text: MOCK_ROOT }]);
    currentState.currentImpl = () =>
      Promise.resolve(barrier({ ok: true as const, current: false }));
    const currentModule = await mockedGraph(currentState);
    expect(await currentModule.buildInspectedMarkdownResourceGraph(MOCK_DOCUMENT)).toEqual({
      ok: false,
      reason: "changed",
    });
    expect(currentState.calls.current).toEqual([[undefined, currentState.session, undefined]]);

    for (const rawCurrent of [
      barrier({ ok: true as const, current: false }),
      barrier({ ok: false as const, reason: "io" as const }),
    ]) {
      const abortedCurrent = makeState([{ path: "SKILL.md", text: MOCK_ROOT }]);
      const currentController = new AbortController();
      abortedCurrent.currentImpl = () => {
        const result = Promise.resolve(rawCurrent);
        queueMicrotask(() => currentController.abort());
        return result;
      };
      const abortedModule = await mockedGraph(abortedCurrent);
      expect(
        await abortedModule.buildInspectedMarkdownResourceGraph(
          MOCK_DOCUMENT,
          currentController.signal,
        ),
      ).toEqual({ ok: false, reason: "aborted" });
    }

    let thenGets = 0;
    class HostilePromise<T> extends Promise<T> {
      // biome-ignore lint/suspicious/noThenProperty: this regression rejects Promise subclasses.
      override get then(): Promise<T>["then"] {
        thenGets += 1;
        throw new Error("must not assimilate");
      }
    }
    const hostileRead = makeState([{ path: "SKILL.md", text: MOCK_ROOT }]);
    hostileRead.readImpl = () =>
      new HostilePromise((resolve) =>
        resolve(
          barrier({ ok: true as const, text: MOCK_ROOT, byteLength: Buffer.byteLength(MOCK_ROOT) }),
        ),
      );
    await expectMockFailure(hostileRead);
    expect(hostileRead.calls.current).toHaveLength(0);

    const hostileCurrent = makeState([{ path: "SKILL.md", text: MOCK_ROOT }]);
    hostileCurrent.currentImpl = () =>
      new HostilePromise((resolve) => resolve(barrier({ ok: true as const, current: true })));
    await expectMockFailure(hostileCurrent);
    expect(thenGets).toBe(0);

    let thenableGets = 0;
    const thenableRead = makeState([{ path: "SKILL.md", text: MOCK_ROOT }]);
    thenableRead.readImpl = () =>
      // biome-ignore lint/suspicious/noThenProperty: this regression rejects structural thenables.
      Object.defineProperty({}, "then", {
        get() {
          thenableGets += 1;
          throw new Error("must reject thenables property-free");
        },
      });
    await expectMockFailure(thenableRead);
    expect(thenableGets).toBe(0);

    let samples = 0;
    vi.doMock(abortPath, () => ({
      sampleAbortSignal: () => (++samples === 5 ? "invalid" : "active"),
    }));
    const invalidSignal = makeState([{ path: "SKILL.md", text: MOCK_ROOT }]);
    const invalidSignalModule = await mockedGraph(invalidSignal);
    const invalidResult = await invalidSignalModule.buildInspectedMarkdownResourceGraph(
      MOCK_DOCUMENT,
      Object.freeze({ marker: "stateful signal" }),
    );
    expect(invalidResult).toEqual({ ok: false, reason: "invalid_input" });
    expectBarrier(invalidResult, ["ok", "reason"]);
    expect(samples).toBe(5);
    expect(invalidSignal.calls.read).toHaveLength(1);
    expect(invalidSignal.calls.current).toHaveLength(0);
  });

  it("samples cancellation immediately after every synchronous producer", async () => {
    const stages = [
      "sessionPredicate",
      "create",
      "resourceClassify",
      "resourcePredicate",
      "project",
      "analyze",
      "analysisPredicate",
      "classify",
      "component",
      "resolve",
    ] as const;
    for (const stage of stages) {
      const state = makeState([
        {
          path: "SKILL.md",
          text: MOCK_ROOT,
          analysis: mockAnalysis([mockTarget("child.md")]),
        },
        { path: "child.md", text: "child" },
      ]);
      const controller = new AbortController();
      const stop = () => {
        controller.abort();
        if (
          stage === "sessionPredicate" ||
          stage === "create" ||
          stage === "resourceClassify" ||
          stage === "analyze" ||
          stage === "component"
        )
          throw new Error("producer failed after cancellation");
        return Object.freeze({ malformed: true });
      };
      if (stage === "sessionPredicate") state.genuineSessionImpl = stop;
      if (stage === "create") state.createImpl = stop;
      if (stage === "resourceClassify") state.resourceClassifyImpl = stop;
      if (stage === "resourcePredicate") state.genuineResourceNameImpl = stop;
      if (stage === "project") state.projectImpl = stop;
      if (stage === "analyze") state.analyzeImpl = stop;
      if (stage === "analysisPredicate") state.genuineAnalysisImpl = stop;
      if (stage === "classify") state.classifyImpl = stop;
      if (stage === "component") state.componentImpl = stop;
      if (stage === "resolve") state.resolveImpl = stop;
      const graphModule = await mockedGraph(state);
      expect(
        await graphModule.buildInspectedMarkdownResourceGraph(MOCK_DOCUMENT, controller.signal),
        stage,
      ).toEqual({ ok: false, reason: "aborted" });
      expect(state.calls.current, stage).toHaveLength(0);
      if (stage === "sessionPredicate") expect(state.calls.create).toHaveLength(0);
      if (stage === "create") expect(state.calls.read).toHaveLength(0);
      if (stage === "resourceClassify" || stage === "resourcePredicate")
        expect(state.calls.read).toHaveLength(0);
      if (stage === "project") expect(state.calls.analyze).toHaveLength(0);
      if (stage === "analyze") expect(state.calls.classify).toHaveLength(0);
      if (stage === "analysisPredicate") expect(state.calls.classify).toHaveLength(0);
      if (stage === "classify") expect(state.calls.component).toHaveLength(0);
      if (stage === "component") expect(state.calls.resolve).toHaveLength(0);
      if (stage === "resolve") expect(state.calls.read).toHaveLength(1);
    }
  });

  it("bounds hostile producer scalars before scans and rejects malformed containers", async () => {
    const oversizedRead = makeState([{ path: "SKILL.md", text: MOCK_ROOT }]);
    oversizedRead.readImpl = () =>
      Promise.resolve(
        barrier({ ok: true as const, text: "x".repeat(512 * 1024 + 1), byteLength: 0 }),
      );
    await expectMockFailure(oversizedRead);
    expect(oversizedRead.calls.current).toHaveLength(0);

    const destinationCases = [
      Object.freeze({
        kind: "local" as const,
        path: "x".repeat(4_097),
        components: Object.freeze(["x"]),
      }),
      Object.freeze({
        kind: "local" as const,
        path: "short",
        components: Object.freeze(["x".repeat(256)]),
      }),
      Object.freeze({ kind: "invalid" as const, reason: "x".repeat(33) }),
      runInNewContext("({kind:'external'})"),
    ];
    for (const produced of destinationCases) {
      const state = makeState([
        { path: "SKILL.md", text: MOCK_ROOT, analysis: mockAnalysis([mockTarget("target")]) },
      ]);
      state.classifyImpl = () => produced;
      const graphModule = await mockedGraph(state);
      expect(await graphModule.buildInspectedMarkdownResourceGraph(MOCK_DOCUMENT)).toEqual({
        ok: false,
        reason: "inconsistent",
      });
      expect(state.calls.component).toHaveLength(0);
      expect(state.calls.resolve).toHaveLength(0);
    }

    let exactGets = 0;
    const hostileExacts = new Array(1_025);
    Object.defineProperty(hostileExacts, 0, {
      get() {
        exactGets += 1;
        throw new Error("oversized alias arrays must not read slot zero");
      },
    });
    Object.freeze(hostileExacts);
    const aliases = makeState([
      { path: "SKILL.md", text: MOCK_ROOT, analysis: mockAnalysis([mockTarget("alias")]) },
    ]);
    aliases.resolveImpl = () =>
      Object.freeze({
        ok: false as const,
        reason: "ambiguous" as const,
        componentIndex: 0,
        match: "fold" as const,
        exacts: hostileExacts,
      });
    await expectMockFailure(aliases);
    expect(exactGets).toBe(0);

    const envelopeCases = [
      runInNewContext("({ok:true,envelope:{}})"),
      Object.freeze({ ok: false as const, reason: "invalid_input" as const }),
      Object.freeze({ ok: false as const, reason: "unknown" }),
      Object.freeze({ ok: true as const, envelope: null }),
      Object.freeze({
        ok: true as const,
        envelope: Object.freeze({
          yaml: "yaml",
          body: "wrong",
          bodyStartLine: 1,
          bodyStartOffset: 0,
        }),
      }),
    ];
    for (const projected of envelopeCases) {
      const state = makeState([{ path: "SKILL.md", text: MOCK_ROOT }]);
      state.projectResult = projected;
      await expectMockFailure(state);
    }

    const resolution = (reason: string, extras: object = {}) =>
      Object.freeze({ ok: false as const, reason, ...extras });
    const resolutionCases = [
      runInNewContext("({ok:false,reason:'missing',componentIndex:0})"),
      Object.freeze({ ok: "malformed" }),
      Object.freeze({ ok: true as const, entryIndex: 99 }),
      resolution("invalid_input"),
      resolution("missing", { componentIndex: 2 }),
      resolution("unknown"),
      resolution("noncanonical", { componentIndex: 0, match: "unknown", exact: "x" }),
      resolution("noncanonical", { componentIndex: 0, match: "fold", exact: "x".repeat(256) }),
      resolution("ambiguous", { componentIndex: 0, match: "fold", exacts: {} }),
      resolution("ambiguous", {
        componentIndex: 0,
        match: "fold",
        exacts: Object.freeze(["x", "y".repeat(256)]),
      }),
    ];
    for (const resolved of resolutionCases) {
      const state = makeState([
        { path: "SKILL.md", text: MOCK_ROOT, analysis: mockAnalysis([mockTarget("target")]) },
      ]);
      state.resolveImpl = () => resolved;
      await expectMockFailure(state);
    }
  });

  it("uses own source locations and captured dense slots despite prototype accessors", async () => {
    const duplicate = mockIssue("skill.markdown.duplicate_definition");
    const analysis = mockAnalysis([], [duplicate]);
    const state = makeState([{ path: "SKILL.md", text: MOCK_ROOT, analysis }]);
    const oldLocation = Object.getOwnPropertyDescriptor(Object.prototype, "location");
    const oldZero = Object.getOwnPropertyDescriptor(Array.prototype, 0);
    let gets = 0;
    let sets = 0;
    let polluted = false;
    const restore = () => {
      if (!polluted) return;
      delete (Object.prototype as { location?: unknown }).location;
      delete (Array.prototype as unknown as Record<number, unknown>)[0];
      if (oldLocation !== undefined)
        Object.defineProperty(Object.prototype, "location", oldLocation);
      if (oldZero !== undefined) Object.defineProperty(Array.prototype, 0, oldZero);
      polluted = false;
    };
    state.analyzeImpl = () => {
      Object.defineProperty(Object.prototype, "location", {
        configurable: true,
        get() {
          gets += 1;
          return undefined;
        },
        set() {
          sets += 1;
        },
      });
      Object.defineProperty(Array.prototype, 0, {
        configurable: true,
        get() {
          gets += 1;
          return undefined;
        },
        set() {
          sets += 1;
        },
      });
      polluted = true;
      return analysis;
    };
    state.currentImpl = () => {
      restore();
      return Promise.resolve(barrier({ ok: true as const, current: true }));
    };
    try {
      const graph = await builtMockGraph(state);
      expect(graph.findings).toEqual([
        { kind: "markdown", code: "skill.markdown.duplicate_definition", file: "SKILL.md" },
      ]);
    } finally {
      restore();
    }
    expect(gets).toBe(0);
    expect(sets).toBe(0);
  });

  it("uses captured generator stepping and never observes inherited then accessors", async () => {
    const state = makeState([{ path: "SKILL.md", text: MOCK_ROOT }]);
    const graphModule = await mockedGraph(state);
    const generator = (function* () {})();
    const generatorPrototype = Object.getPrototypeOf(Object.getPrototypeOf(generator));
    const oldNext = Object.getOwnPropertyDescriptor(generatorPrototype, "next");
    const oldPromiseThen = Object.getOwnPropertyDescriptor(Promise.prototype, "then");
    const oldObjectThen = Object.getOwnPropertyDescriptor(Object.prototype, "then");
    let gets = 0;
    try {
      for (const [target, property] of [
        [generatorPrototype, "next"],
        [Promise.prototype, "then"],
        [Object.prototype, "then"],
      ] as const)
        Object.defineProperty(target, property, {
          configurable: true,
          get() {
            gets += 1;
            throw new Error("captured graph execution must not observe the accessor");
          },
        });
      const result = await graphModule.buildInspectedMarkdownResourceGraph(MOCK_DOCUMENT);
      expect(result.ok).toBe(true);
    } finally {
      if (oldNext !== undefined) Object.defineProperty(generatorPrototype, "next", oldNext);
      if (oldPromiseThen !== undefined)
        // biome-ignore lint/suspicious/noThenProperty: restore the pre-test descriptor exactly.
        Object.defineProperty(Promise.prototype, "then", oldPromiseThen);
      if (oldObjectThen === undefined) delete (Object.prototype as { then?: unknown }).then;
      // biome-ignore lint/suspicious/noThenProperty: restore the pre-test descriptor exactly.
      else Object.defineProperty(Object.prototype, "then", oldObjectThen);
    }
    expect(gets).toBe(0);
  });
});
