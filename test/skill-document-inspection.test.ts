import { lstat } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { DiagnosticCollector } from "../src/validate/diagnostics.js";
import {
  type DocumentInspectionIo,
  inspectAgentSkillDocument,
  type SkillDirectoryHandle,
} from "../src/validate/skill-document.js";
import { inspectAgentSkillRoot } from "../src/validate/skill-root.js";
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

describe("Agent Skill document inspection", () => {
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
  });
});
