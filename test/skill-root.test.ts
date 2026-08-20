import { execFile } from "node:child_process";
import { symlinkSync } from "node:fs";
import { lstat, realpath, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

import { DiagnosticCollector } from "../src/validate/diagnostics.js";
import { inspectAgentSkillRoot, rootInspectionIsCurrent } from "../src/validate/skill-root.js";
import { createSkillFixtures, skillDocument } from "./helpers/skill-fixtures.js";

const fixtures = createSkillFixtures();
const execFileAsync = promisify(execFile);
afterEach(() => fixtures.cleanup());

function codes(diagnostics: DiagnosticCollector): string[] {
  return diagnostics.finish().diagnostics.map((entry) => entry.code);
}

describe("Agent Skill root inspection", () => {
  it("reports missing, non-directory, symbolic-link, and overly deep roots", async () => {
    const parent = await fixtures.parent();
    const missing = new DiagnosticCollector();
    await inspectAgentSkillRoot(join(parent, "absent"), missing);
    expect(codes(missing)).toEqual(["skill.root.missing"]);

    const file = join(parent, "file-root");
    await writeFile(file, "content");
    const nonDirectory = new DiagnosticCollector();
    await inspectAgentSkillRoot(file, nonDirectory);
    expect(codes(nonDirectory)).toEqual(["skill.root.not_directory"]);

    const tooDeep = new DiagnosticCollector();
    await inspectAgentSkillRoot(Array.from({ length: 257 }, () => "a").join("/"), tooDeep);
    expect(codes(tooDeep)).toEqual(["skill.root.too_deep"]);

    if (process.platform !== "win32") {
      const target = await fixtures.skill(
        "linked-root",
        skillDocument("name: linked-root\ndescription: A description."),
      );
      const link = join(parent, "link");
      symlinkSync(target.directory, link);
      const symbolic = new DiagnosticCollector();
      await inspectAgentSkillRoot(link, symbolic);
      expect(codes(symbolic)).toEqual(["skill.root.symlink"]);
    }
  });

  it.runIf(process.platform !== "win32")(
    "normalizes a resolve failure after the current directory disappears",
    async () => {
      const doomed = await fixtures.parent();
      const rootUrl = pathToFileURL(resolve("dist/validate/skill-root.js")).href;
      const diagnosticsUrl = pathToFileURL(resolve("dist/validate/diagnostics.js")).href;
      const script = [
        "const [, doomed, rootUrl, diagnosticsUrl] = process.argv;",
        "const { rm } = await import('node:fs/promises');",
        "const { inspectAgentSkillRoot } = await import(rootUrl);",
        "const { DiagnosticCollector } = await import(diagnosticsUrl);",
        "process.chdir(doomed);",
        "await rm(doomed, { recursive: true });",
        "const diagnostics = new DiagnosticCollector();",
        "await inspectAgentSkillRoot('relative-skill', diagnostics);",
        "process.stdout.write(JSON.stringify(diagnostics.finish()));",
      ].join("\n");
      const { stdout, stderr } = await execFileAsync(
        process.execPath,
        ["--input-type=module", "-e", script, doomed, rootUrl, diagnosticsUrl],
        { encoding: "utf8" },
      );
      const report = JSON.parse(stdout) as { diagnostics: Array<{ code: string }> };
      expect(stderr).toBe("");
      expect(report.diagnostics.map((entry) => entry.code)).toEqual(["skill.document.read"]);
    },
  );

  it("normalizes resolver and hostile filesystem errors", async () => {
    const resolver = new DiagnosticCollector();
    await inspectAgentSkillRoot("ignored", resolver, {
      resolvePath() {
        throw new Error("cwd disappeared");
      },
      async lstatPath() {
        throw new Error("unused");
      },
      async realpathPath() {
        throw new Error("unused");
      },
    });
    expect(codes(resolver)).toEqual(["skill.document.read"]);

    const poison = new Proxy(new Error("poison"), {
      get() {
        throw new Error("poison getter");
      },
    });
    const filesystem = new DiagnosticCollector();
    await inspectAgentSkillRoot("ignored", filesystem, {
      resolvePath: () => "/ignored",
      async lstatPath() {
        throw poison;
      },
      realpathPath: async (path) => path,
    });
    expect(codes(filesystem)).toEqual(["skill.document.read"]);
  });

  it("rejects canonical identity changes and canonicalization failures", async () => {
    const fixture = await fixtures.skill(
      "root-change",
      skillDocument("name: root-change\ndescription: A description."),
    );
    const changed = new DiagnosticCollector();
    await inspectAgentSkillRoot(fixture.directory, changed, {
      resolvePath: (path) => path,
      lstatPath: (path) => lstat(path, { bigint: true }),
      realpathPath: async () => realpath(`${fixture.directory}/..`),
    });
    expect(codes(changed)).toEqual(["skill.root.changed"]);

    const failed = new DiagnosticCollector();
    await inspectAgentSkillRoot(fixture.directory, failed, {
      resolvePath: (path) => path,
      lstatPath: (path) => lstat(path, { bigint: true }),
      async realpathPath() {
        throw new Error("realpath failed");
      },
    });
    expect(codes(failed)).toEqual(["skill.document.read"]);
  });

  it("revalidates every component and normalizes revalidation errors", async () => {
    const fixture = await fixtures.skill(
      "root-current",
      skillDocument("name: root-current\ndescription: A description."),
    );
    const diagnostics = new DiagnosticCollector();
    const root = await inspectAgentSkillRoot(fixture.directory, diagnostics);
    expect(root).toBeDefined();
    if (root === undefined) return;

    expect(
      await rootInspectionIsCurrent(root, {
        resolvePath: (path) => path,
        realpathPath: async () => root.canonicalPath,
        lstatPath: async () => lstat(`${fixture.directory}/..`, { bigint: true }),
      }),
    ).toBe(false);
    expect(
      await rootInspectionIsCurrent(root, {
        resolvePath: (path) => path,
        realpathPath: async () => root.canonicalPath,
        async lstatPath() {
          throw new Error("changed");
        },
      }),
    ).toBe(false);
    expect(
      await rootInspectionIsCurrent(root, {
        resolvePath: (path) => path,
        async realpathPath() {
          throw new Error("gone");
        },
        lstatPath: (path) => lstat(path, { bigint: true }),
      }),
    ).toBe(false);
  });
});
