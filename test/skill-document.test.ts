import { symlinkSync } from "node:fs";
import { lstat, mkdir, realpath, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { DiagnosticCollector } from "../src/validate/diagnostics.js";
import { loadAgentSkillDocument } from "../src/validate/skill-document.js";
import { MAX_SKILL_DIRECTORY_ENTRIES, MAX_SKILL_DOCUMENT_BYTES } from "../src/validate/types.js";
import { createSkillFixtures, skillDocument } from "./helpers/skill-fixtures.js";

const fixtures = createSkillFixtures();
afterEach(() => fixtures.cleanup());

async function expectDocumentCodes(directory: string, ...expected: string[]) {
  const diagnostics = new DiagnosticCollector();
  const loaded = await loadAgentSkillDocument(directory, diagnostics);
  const report = diagnostics.finish();
  for (const code of expected) {
    expect(report.diagnostics.map((entry) => entry.code)).toContain(code);
  }
  return { loaded, report };
}

describe("Agent Skill document loading", () => {
  it("reports missing and mis-cased documents", async () => {
    const parent = await fixtures.parent();
    const missing = join(parent, "missing-document");
    await mkdir(missing);
    await expectDocumentCodes(missing, "skill.document.missing");

    const wrongCase = join(parent, "wrong-case");
    await mkdir(wrongCase);
    await writeFile(join(wrongCase, "skill.md"), "content");
    await expectDocumentCodes(wrongCase, "skill.document.case_mismatch");
  });

  it("rejects an exact document beside a case-colliding alias when supported", async () => {
    const fixture = await fixtures.skill(
      "case-collision",
      skillDocument("name: case-collision\ndescription: A description.\nlicense: MIT"),
    );
    try {
      await writeFile(join(fixture.directory, "skill.md"), "hostile", { flag: "wx" });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      return;
    }
    await expectDocumentCodes(fixture.directory, "skill.document.case_collision");
  });

  it("bounds the immediate directory scan", async () => {
    const fixture = await fixtures.skill(
      "many-entries",
      skillDocument("name: many-entries\ndescription: A description.\nlicense: MIT"),
    );
    await Promise.all(
      Array.from({ length: MAX_SKILL_DIRECTORY_ENTRIES }, (_, index) =>
        writeFile(join(fixture.directory, `entry-${index}`), ""),
      ),
    );
    await expectDocumentCodes(fixture.directory, "skill.root.too_many_entries");
  });

  it("rejects non-file and symbolic-link documents", async () => {
    const parent = await fixtures.parent();
    const directoryDocument = join(parent, "directory-document");
    await mkdir(join(directoryDocument, "SKILL.md"), { recursive: true });
    await expectDocumentCodes(directoryDocument, "skill.document.not_file");

    if (process.platform !== "win32") {
      const target = await fixtures.skill(
        "target",
        skillDocument("name: target\ndescription: A description.\nlicense: MIT"),
      );
      const linkRoot = join(parent, "link-document");
      await mkdir(linkRoot);
      symlinkSync(target.path, join(linkRoot, "SKILL.md"));
      await expectDocumentCodes(linkRoot, "skill.document.symlink");
    }
  });

  it("enforces document bytes and UTF-8 before parsing", async () => {
    const large = await fixtures.skill(
      "large-document",
      new Uint8Array(MAX_SKILL_DOCUMENT_BYTES + 1).fill(0x61),
    );
    await expectDocumentCodes(large.directory, "skill.document.too_large");

    const invalid = await fixtures.skill("invalid-utf8", Uint8Array.from([0xc3, 0x28]));
    const { report } = await expectDocumentCodes(invalid.directory, "skill.document.encoding");
    expect(report.diagnostics[0]?.message).toBe("SKILL.md must contain valid UTF-8");
  });

  it("loads valid text and reports the canonical directory spelling", async () => {
    const fixture = await fixtures.skill(
      "CaseProbe",
      skillDocument("name: CaseProbe\ndescription: A description.\nlicense: MIT"),
    );
    const alias = join(fixture.directory, "..", "caseprobe");
    let input = fixture.directory;
    try {
      await lstat(alias);
      input = alias;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const diagnostics = new DiagnosticCollector();
    const loaded = await loadAgentSkillDocument(input, diagnostics);
    expect(diagnostics.finish().diagnostics).toEqual([]);
    if (loaded === undefined) throw new Error("expected the valid skill document to load");
    expect(loaded).toMatchObject({ directoryName: "CaseProbe" });
    expect(loaded.text).toContain("name: CaseProbe");
    expect(loaded.inspection.path).toBe(join(loaded.inspection.root.path, "SKILL.md"));
    expect(loaded.inspection.root.canonicalPath).toBe(await realpath(fixture.directory));
    expect(Object.isFrozen(loaded)).toBe(true);
    expect(Object.isFrozen(loaded.inspection)).toBe(true);
    expect(Object.isFrozen(loaded.inspection.metadata)).toBe(true);
    expect(Object.isFrozen(loaded.inspection.root)).toBe(true);
    expect(Reflect.set(loaded.inspection.metadata, "ino", 0n)).toBe(false);
    expect(loaded.inspection.metadata.kind).toBe("file");
  });
});
