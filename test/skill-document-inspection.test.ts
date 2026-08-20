import fsPromisesModule, { lstat } from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import pathModule, { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { validateAgentSkill } from "../src/validate/agent-skill.js";
import { DiagnosticCollector } from "../src/validate/diagnostics.js";
import {
  type DocumentInspectionIo,
  inspectAgentSkillDocument,
  isGenuineDocumentInspection,
  loadAgentSkillDocument,
  type SkillDirectoryHandle,
} from "../src/validate/skill-document.js";
import {
  inspectAgentSkillRoot,
  isGenuineRootInspection,
  type RootInspection,
} from "../src/validate/skill-root.js";
import { createSkillFixtures, skillDocument } from "./helpers/skill-fixtures.js";

const fixtures = createSkillFixtures();
afterEach(() => fixtures.cleanup());

function directory(names: readonly string[], closeFails = false): SkillDirectoryHandle {
  let index = 0;
  return {
    async read() {
      const name = names[index];
      index += 1;
      return name === undefined ? null : { name };
    },
    async close() {
      if (closeFails) throw new Error("close failed");
    },
  };
}

function diagnosticCodes(diagnostics: DiagnosticCollector): string[] {
  return diagnostics.finish().diagnostics.map((entry) => entry.code);
}

async function withPropertyReplacement<T>(
  target: object,
  property: PropertyKey,
  value: unknown,
  run: () => T | Promise<T>,
): Promise<T> {
  const descriptor = Object.getOwnPropertyDescriptor(target, property);
  Object.defineProperty(target, property, {
    configurable: true,
    value,
    writable: true,
  });
  try {
    return await run();
  } finally {
    if (descriptor === undefined) {
      Reflect.deleteProperty(target, property);
    } else {
      Object.defineProperty(target, property, descriptor);
    }
  }
}

interface SynchronizedBuiltinMutation {
  readonly target: object;
  readonly property: PropertyKey;
  readonly value: unknown;
}

async function withSynchronizedBuiltinMutations<T>(
  mutations: readonly SynchronizedBuiltinMutation[],
  run: () => T | Promise<T>,
): Promise<T> {
  const descriptors = mutations.map(({ property, target }) =>
    Object.getOwnPropertyDescriptor(target, property),
  );
  let applied = 0;
  try {
    for (; applied < mutations.length; applied += 1) {
      const mutation = mutations[applied] as SynchronizedBuiltinMutation;
      Object.defineProperty(mutation.target, mutation.property, {
        configurable: true,
        value: mutation.value,
        writable: true,
      });
    }
    syncBuiltinESMExports();
    return await run();
  } finally {
    for (let index = applied - 1; index >= 0; index -= 1) {
      const mutation = mutations[index] as SynchronizedBuiltinMutation;
      const descriptor = descriptors[index];
      if (descriptor === undefined) {
        Reflect.deleteProperty(mutation.target, mutation.property);
      } else {
        Object.defineProperty(mutation.target, mutation.property, descriptor);
      }
    }
    syncBuiltinESMExports();
  }
}

describe("Agent Skill document inspection", () => {
  it("rejects forged roots before filesystem or freshness callbacks", async () => {
    const fixture = await fixtures.skill(
      "forged-root",
      skillDocument("name: forged-root\ndescription: A description.\nlicense: MIT"),
    );
    const setup = new DiagnosticCollector();
    const root = await inspectAgentSkillRoot(fixture.directory, setup);
    expect(root).toBeDefined();
    if (root === undefined) return;

    let trapCalls = 0;
    const forged = Object.create(null) as object;
    Object.defineProperty(forged, "path", {
      get() {
        trapCalls += 1;
        throw new Error("forged root was inspected");
      },
    });
    const proxy = new Proxy(root, {
      get() {
        trapCalls += 1;
        throw new Error("genuine root proxy was inspected");
      },
    });
    const revoked = Proxy.revocable(root, {
      get() {
        trapCalls += 1;
        throw new Error("revoked root proxy was inspected");
      },
    });
    revoked.revoke();

    const calls = { open: 0, lstat: 0, current: 0 };
    const io: DocumentInspectionIo = {
      async openDirectory() {
        calls.open += 1;
        throw new Error("forged root reached directory I/O");
      },
      async lstatPath() {
        calls.lstat += 1;
        throw new Error("forged root reached metadata I/O");
      },
      async rootIsCurrent() {
        calls.current += 1;
        throw new Error("forged root reached freshness I/O");
      },
    };
    for (const candidate of [
      { ...root },
      Object.create(root) as object,
      forged,
      proxy,
      revoked.proxy,
    ]) {
      const diagnostics = new DiagnosticCollector();
      expect(
        await inspectAgentSkillDocument(candidate as RootInspection, diagnostics, io),
      ).toBeUndefined();
      expect(diagnostics.finish()).toEqual({
        schemaVersion: 1,
        ok: false,
        diagnostics: [
          {
            code: "skill.root.changed",
            severity: "error",
            scope: "skillpress",
            file: ".",
            message: "skill directory changed while it was being read",
          },
        ],
      });
    }
    expect(calls).toEqual({ open: 0, lstat: 0, current: 0 });
    expect(trapCalls).toBe(0);
  });

  it("normalizes directory open, read, and close failures", async () => {
    const fixture = await fixtures.skill(
      "scan-errors",
      skillDocument("name: scan-errors\ndescription: A description."),
    );
    const setup = new DiagnosticCollector();
    const root = await inspectAgentSkillRoot(fixture.directory, setup);
    expect(root).toBeDefined();
    if (root === undefined) return;

    const failing = [
      async () => {
        throw new Error("open failed");
      },
      async () => ({
        async read() {
          throw new Error("read failed");
        },
        async close() {},
      }),
      async () => directory(["SKILL.md"], true),
    ];
    for (const openDirectory of failing) {
      const diagnostics = new DiagnosticCollector();
      await inspectAgentSkillDocument(root, diagnostics, {
        openDirectory,
        lstatPath: (path) => lstat(path, { bigint: true }),
        rootIsCurrent: async () => true,
      });
      expect(diagnosticCodes(diagnostics)).toEqual(["skill.document.read"]);
    }
  });

  it("rejects case collisions independent of host filesystem semantics", async () => {
    const fixture = await fixtures.skill(
      "scan-case",
      skillDocument("name: scan-case\ndescription: A description."),
    );
    const setup = new DiagnosticCollector();
    const root = await inspectAgentSkillRoot(fixture.directory, setup);
    expect(root).toBeDefined();
    if (root === undefined) return;
    const diagnostics = new DiagnosticCollector();
    await inspectAgentSkillDocument(root, diagnostics, {
      openDirectory: async () => directory(["SKILL.md", "skill.md"]),
      lstatPath: (path) => lstat(path, { bigint: true }),
      rootIsCurrent: async () => true,
    });
    expect(diagnosticCodes(diagnostics)).toEqual(["skill.document.case_collision"]);
  });

  it("rejects root changes before and after document metadata inspection", async () => {
    const fixture = await fixtures.skill(
      "scan-root",
      skillDocument("name: scan-root\ndescription: A description."),
    );
    const setup = new DiagnosticCollector();
    const root = await inspectAgentSkillRoot(fixture.directory, setup);
    expect(root).toBeDefined();
    if (root === undefined) return;

    const first = new DiagnosticCollector();
    await inspectAgentSkillDocument(root, first, {
      openDirectory: async () => directory(["SKILL.md"]),
      lstatPath: (path) => lstat(path, { bigint: true }),
      rootIsCurrent: async () => false,
    });
    expect(diagnosticCodes(first)).toEqual(["skill.root.changed"]);

    let checks = 0;
    const second = new DiagnosticCollector();
    await inspectAgentSkillDocument(root, second, {
      openDirectory: async () => directory(["SKILL.md"]),
      lstatPath: (path) => lstat(path, { bigint: true }),
      rootIsCurrent: async () => {
        checks += 1;
        return checks === 1;
      },
    });
    expect(diagnosticCodes(second)).toEqual(["skill.root.changed"]);
  });

  it("normalizes document metadata inspection failures", async () => {
    const fixture = await fixtures.skill(
      "scan-stat",
      skillDocument("name: scan-stat\ndescription: A description."),
    );
    const setup = new DiagnosticCollector();
    const root = await inspectAgentSkillRoot(fixture.directory, setup);
    expect(root).toBeDefined();
    if (root === undefined) return;
    const diagnostics = new DiagnosticCollector();
    const io: DocumentInspectionIo = {
      openDirectory: async () => directory(["SKILL.md"]),
      async lstatPath(path) {
        expect(path).toBe(join(root.path, "SKILL.md"));
        throw new Error("stat failed");
      },
      rootIsCurrent: async () => true,
    };
    await inspectAgentSkillDocument(root, diagnostics, io);
    expect(diagnosticCodes(diagnostics)).toEqual(["skill.document.read"]);

    const metadata = await lstat(fixture.path, { bigint: true });
    const hostile = new Proxy(metadata, {
      getOwnPropertyDescriptor(target, property) {
        if (property === "mode") throw new Error("secret metadata trap");
        return Reflect.getOwnPropertyDescriptor(target, property);
      },
    });
    const trapped = new DiagnosticCollector();
    await inspectAgentSkillDocument(root, trapped, {
      openDirectory: async () => directory(["SKILL.md"]),
      lstatPath: async () => hostile,
      rootIsCurrent: async () => true,
    });
    const report = trapped.finish();
    expect(report.diagnostics.map((entry) => entry.code)).toEqual(["skill.document.read"]);
    expect(JSON.stringify(report)).not.toContain("secret metadata trap");
  });

  it("authenticates completed documents, retains root identity, and preserves public reports", async () => {
    const fixture = await fixtures.skill(
      "document-provenance",
      skillDocument("name: document-provenance\ndescription: A description.\nlicense: MIT"),
    );
    const setup = new DiagnosticCollector();
    const root = await inspectAgentSkillRoot(fixture.directory, setup);
    expect(root).toBeDefined();
    if (root === undefined) return;
    const diagnostics = new DiagnosticCollector();
    const document = await inspectAgentSkillDocument(root, diagnostics);
    expect(diagnosticCodes(diagnostics)).toEqual([]);
    expect(document).toBeDefined();
    if (document === undefined) return;
    expect(isGenuineRootInspection(root)).toBe(true);
    expect(isGenuineDocumentInspection(document)).toBe(true);
    expect(document.root).toBe(root);
    expect(Object.isFrozen(document)).toBe(true);

    let trapCalls = 0;
    const proxy = new Proxy(document, {
      get() {
        trapCalls += 1;
        throw new Error("genuine document proxy was inspected");
      },
    });
    const revoked = Proxy.revocable(document, {
      get() {
        trapCalls += 1;
        throw new Error("revoked document proxy was inspected");
      },
    });
    revoked.revoke();
    for (const candidate of [
      { ...document },
      Object.create(document) as object,
      proxy,
      revoked.proxy,
    ]) {
      expect(isGenuineDocumentInspection(candidate)).toBe(false);
    }
    expect(trapCalls).toBe(0);

    const addPollutedDiagnostics = new DiagnosticCollector();
    const addPolluted = await withPropertyReplacement(
      WeakSet.prototype,
      "add",
      () => {
        throw new Error("live WeakSet.add was used");
      },
      () => inspectAgentSkillDocument(root, addPollutedDiagnostics),
    );
    expect(diagnosticCodes(addPollutedDiagnostics)).toEqual([]);
    expect(addPolluted).toBeDefined();
    expect(isGenuineDocumentInspection(addPolluted)).toBe(true);
    expect(
      await withPropertyReplacement(
        WeakSet.prototype,
        "has",
        () => {
          throw new Error("live WeakSet.has was used");
        },
        () => isGenuineDocumentInspection(document),
      ),
    ).toBe(true);
    expect(
      await withPropertyReplacement(
        Reflect,
        "apply",
        () => {
          throw new Error("live Reflect.apply was used");
        },
        () => isGenuineDocumentInspection(document),
      ),
    ).toBe(true);

    expect(await validateAgentSkill(fixture.directory)).toEqual({
      schemaVersion: 1,
      ok: true,
      diagnostics: [],
      metadata: {
        name: "document-provenance",
        description: "A description.",
        license: "MIT",
      },
    });
  });

  it("deep-freezes authority records through the module-initialization freeze snapshot", async () => {
    const fixture = await fixtures.skill(
      "freeze-provenance",
      skillDocument("name: freeze-provenance\ndescription: A description.\nlicense: MIT"),
    );
    const result = await withPropertyReplacement(
      Object,
      "freeze",
      <T>(value: T): T => value,
      async () => {
        const diagnostics = new DiagnosticCollector();
        const root = await inspectAgentSkillRoot(fixture.directory, diagnostics);
        const document =
          root === undefined ? undefined : await inspectAgentSkillDocument(root, diagnostics);
        return { diagnostics, document, root };
      },
    );
    expect(diagnosticCodes(result.diagnostics)).toEqual([]);
    expect(result.root).toBeDefined();
    expect(result.document).toBeDefined();
    if (result.root === undefined || result.document === undefined) return;

    expect(isGenuineRootInspection(result.root)).toBe(true);
    expect(isGenuineDocumentInspection(result.document)).toBe(true);
    expect(result.document.root).toBe(result.root);
    expect(Object.isFrozen(result.root)).toBe(true);
    expect(Object.isFrozen(result.root.components)).toBe(true);
    expect(result.root.components.every((component) => Object.isFrozen(component))).toBe(true);
    expect(result.root.components.every((component) => Object.isFrozen(component.metadata))).toBe(
      true,
    );
    expect(Object.isFrozen(result.root.metadata)).toBe(true);
    expect(Object.isFrozen(result.document)).toBe(true);
    expect(Object.isFrozen(result.document.metadata)).toBe(true);
  });

  it("retains captured Node builtins after synchronized ESM export mutation", async () => {
    const fixture = await fixtures.skill(
      "builtin-provenance",
      skillDocument("name: builtin-provenance\ndescription: A description.\nlicense: MIT"),
    );
    const external = await fixtures.skill(
      "external-builtin-target",
      skillDocument("name: external-builtin-target\ndescription: External.\nlicense: MIT"),
    );
    const setup = new DiagnosticCollector();
    const baseline = await inspectAgentSkillRoot(fixture.directory, setup);
    expect(diagnosticCodes(setup)).toEqual([]);
    expect(baseline).toBeDefined();
    if (baseline === undefined) return;
    const expectedComponents = baseline.components.map((component) => component.path);
    const expectedDirectoryName = pathModule.basename(baseline.canonicalPath);
    const lstatBeforeMutation = lstat;

    const calls = { basename: 0, join: 0, lstat: 0, parse: 0, relative: 0 };
    const result = await withSynchronizedBuiltinMutations(
      [
        {
          target: pathModule,
          property: "basename",
          value: () => {
            calls.basename += 1;
            return "external-builtin-target";
          },
        },
        {
          target: pathModule,
          property: "join",
          value: () => {
            calls.join += 1;
            return external.path;
          },
        },
        {
          target: pathModule,
          property: "parse",
          value: () => {
            calls.parse += 1;
            throw new Error("live path.parse was used");
          },
        },
        {
          target: pathModule,
          property: "relative",
          value: () => {
            calls.relative += 1;
            throw new Error("live path.relative was used");
          },
        },
        { target: pathModule, property: "sep", value: "!" },
        {
          target: fsPromisesModule,
          property: "lstat",
          value: (...args: unknown[]) => {
            calls.lstat += 1;
            return Reflect.apply(lstatBeforeMutation, fsPromisesModule, args);
          },
        },
      ],
      async () => {
        expect(join("ignored", "SKILL.md")).toBe(external.path);
        await lstat(fixture.path, { bigint: true });
        calls.join = 0;
        calls.lstat = 0;

        const diagnostics = new DiagnosticCollector();
        const root = await inspectAgentSkillRoot(fixture.directory, diagnostics);
        const document =
          root === undefined ? undefined : await inspectAgentSkillDocument(root, diagnostics);
        const authorityCalls = { ...calls };
        const loadedDiagnostics = new DiagnosticCollector();
        const loaded = await loadAgentSkillDocument(fixture.directory, loadedDiagnostics);
        return { authorityCalls, diagnostics, document, loaded, loadedDiagnostics, root };
      },
    );

    expect(result.authorityCalls).toEqual({
      basename: 0,
      join: 0,
      lstat: 0,
      parse: 0,
      relative: 0,
    });
    expect(calls.basename).toBe(0);
    expect(calls.join).toBe(0);
    expect(calls.parse).toBe(0);
    expect(calls.relative).toBe(0);
    expect(diagnosticCodes(result.diagnostics)).toEqual([]);
    expect(diagnosticCodes(result.loadedDiagnostics)).toEqual([]);
    expect(result.root).toBeDefined();
    expect(result.document).toBeDefined();
    expect(result.loaded).toBeDefined();
    if (result.root === undefined || result.document === undefined || result.loaded === undefined) {
      return;
    }
    expect(isGenuineRootInspection(result.root)).toBe(true);
    expect(isGenuineDocumentInspection(result.document)).toBe(true);
    expect(result.root.components.map((component) => component.path)).toEqual(expectedComponents);
    expect(result.document.path).toBe(fixture.path);
    expect(result.document.path).not.toBe(external.path);
    expect(result.loaded.directoryName).toBe(expectedDirectoryName);
    expect(isGenuineDocumentInspection(result.loaded.inspection)).toBe(true);
  });

  it("rejects inspection identities from a different module instance", async () => {
    const fixture = await fixtures.skill(
      "foreign-provenance",
      skillDocument("name: foreign-provenance\ndescription: A description.\nlicense: MIT"),
    );
    const oldDiagnostics = new DiagnosticCollector();
    const oldRoot = await inspectAgentSkillRoot(fixture.directory, oldDiagnostics);
    expect(oldRoot).toBeDefined();
    if (oldRoot === undefined) return;
    const oldDocument = await inspectAgentSkillDocument(oldRoot, oldDiagnostics);
    expect(oldDocument).toBeDefined();
    if (oldDocument === undefined) return;

    vi.resetModules();
    try {
      const foreignRoots = await import("../src/validate/skill-root.js");
      const foreignDocuments = await import("../src/validate/skill-document.js");
      expect(foreignRoots.isGenuineRootInspection(oldRoot)).toBe(false);
      expect(foreignDocuments.isGenuineDocumentInspection(oldDocument)).toBe(false);

      const foreignDiagnostics = new DiagnosticCollector();
      const foreignRoot = await foreignRoots.inspectAgentSkillRoot(
        fixture.directory,
        foreignDiagnostics,
      );
      expect(foreignRoot).toBeDefined();
      if (foreignRoot === undefined) return;
      const foreignDocument = await foreignDocuments.inspectAgentSkillDocument(
        foreignRoot,
        foreignDiagnostics,
      );
      expect(foreignDocument).toBeDefined();
      if (foreignDocument === undefined) return;
      expect(foreignRoots.isGenuineRootInspection(foreignRoot)).toBe(true);
      expect(foreignDocuments.isGenuineDocumentInspection(foreignDocument)).toBe(true);
      expect(isGenuineRootInspection(foreignRoot)).toBe(false);
      expect(isGenuineDocumentInspection(foreignDocument)).toBe(false);

      const noIo = { open: 0, lstat: 0, current: 0 };
      const rejected = new DiagnosticCollector();
      await inspectAgentSkillDocument(foreignRoot, rejected, {
        async openDirectory() {
          noIo.open += 1;
          return directory([]);
        },
        async lstatPath(path) {
          noIo.lstat += 1;
          return lstat(path, { bigint: true });
        },
        async rootIsCurrent() {
          noIo.current += 1;
          return true;
        },
      });
      expect(diagnosticCodes(rejected)).toEqual(["skill.root.changed"]);
      expect(noIo).toEqual({ open: 0, lstat: 0, current: 0 });
    } finally {
      vi.resetModules();
    }
  });
});
