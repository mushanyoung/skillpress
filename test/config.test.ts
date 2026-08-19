import { realpathSync, symlinkSync } from "node:fs";
import { lstat, mkdtemp, open, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeAll, describe, expect, it } from "vitest";

import {
  CONFIG_FILE_NAME,
  loadProjectConfig,
  MAX_CONFIG_BYTES,
  readConfigText,
  sameFileIdentity,
} from "../src/config/load.js";
import { ProjectConfigError } from "../src/config/errors.js";

const fixturePath = fileURLToPath(new URL("fixtures/config/valid.yaml", import.meta.url));
const temporaryRoot = realpathSync(tmpdir());
const temporaryDirectories: string[] = [];
let validConfig = "";

beforeAll(async () => {
  validConfig = await readFile(fixturePath, "utf8");
});

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })),
  );
});

async function temporaryConfig(
  content: string | Uint8Array,
): Promise<{ readonly directory: string; readonly path: string }> {
  const directory = await mkdtemp(join(temporaryRoot, "skillpress-config-test-"));
  temporaryDirectories.push(directory);
  const path = join(directory, CONFIG_FILE_NAME);
  await writeFile(path, content, { mode: 0o600 });
  return { directory, path };
}

async function expectIssue(path: string, code: string): Promise<ProjectConfigError> {
  try {
    await loadProjectConfig(path);
  } catch (error) {
    expect(error).toBeInstanceOf(ProjectConfigError);
    const configError = error as ProjectConfigError;
    expect(configError.issues.map((entry) => entry.code)).toContain(code);
    return configError;
  }
  throw new Error(`Expected ${code} while loading ${path}`);
}

describe("project configuration", () => {
  it("loads a valid configuration file", async () => {
    const config = await loadProjectConfig(fixturePath);

    expect(config.schemaVersion).toBe(1);
    expect(config.skill).toEqual({
      name: "example-skill",
      path: "skills/example-skill",
      risk: "moderate",
    });
    expect(config.quality.tesslImpactMinimum).toBe(90);
    expect(config.publish.targets).toContain("clawhub");
  });

  it("finds skillpress.yaml when given a directory", async () => {
    const fixture = await temporaryConfig(validConfig);

    await expect(loadProjectConfig(fixture.directory)).resolves.toEqual(
      await loadProjectConfig(fixture.path),
    );
  });

  it("reports every schema violation with stable codes", async () => {
    const invalid = `${validConfig}\nunknownTopLevel: true\n`.replace(
      "tesslImpactMinimum: 90",
      "tesslImpactMinimum: 89",
    );
    const fixture = await temporaryConfig(invalid);
    const error = await expectIssue(fixture.path, "config.schema.additionalProperties");

    expect(error.issues.map((entry) => entry.code)).toContain("config.schema.minimum");
  });

  it("rejects an unsafe parent-relative skill path", async () => {
    const fixture = await temporaryConfig(
      validConfig.replace("path: skills/example-skill", "path: ../outside"),
    );

    await expectIssue(fixture.path, "config.schema.pattern");
  });

  it("rejects duplicate YAML keys", async () => {
    const fixture = await temporaryConfig(`${validConfig}\nschemaVersion: 1\n`);

    await expectIssue(fixture.path, "config.yaml");
  });

  it("rejects multiple YAML documents", async () => {
    const fixture = await temporaryConfig(`${validConfig}\n---\nschemaVersion: 1\n`);

    await expectIssue(fixture.path, "config.yaml_documents");
  });

  it("rejects YAML aliases", async () => {
    const fixture = await temporaryConfig(
      validConfig.replace("schemaVersion: 1", "schemaVersion: &version 1\nalias: *version"),
    );

    await expectIssue(fixture.path, "config.yaml_alias");
  });

  it("rejects invalid UTF-8", async () => {
    const fixture = await temporaryConfig(Uint8Array.from([0xc3, 0x28]));

    await expectIssue(fixture.path, "config.encoding");
  });

  it("rejects files above the byte limit without parsing them", async () => {
    const fixture = await temporaryConfig(new Uint8Array(MAX_CONFIG_BYTES + 1).fill(0x61));

    await expectIssue(fixture.path, "config.too_large");
  });

  it("rejects deeply nested flow collections before YAML parsing", async () => {
    const fixture = await temporaryConfig(`${"[".repeat(33)}0${"]".repeat(33)}`);

    await expectIssue(fixture.path, "config.complexity");
  });

  it("rejects excessive block indentation before YAML parsing", async () => {
    const fixture = await temporaryConfig(`root:\n${" ".repeat(65)}value: true\n`);

    await expectIssue(fixture.path, "config.complexity");
  });

  it("rejects excessive lexical tokens before YAML parsing", async () => {
    const fixture = await temporaryConfig(`values:\n${"- 0\n".repeat(3000)}`);

    await expectIssue(fixture.path, "config.complexity");
  });

  it("rejects a missing configuration file", async () => {
    const directory = await mkdtemp(join(temporaryRoot, "skillpress-config-test-"));
    temporaryDirectories.push(directory);

    await expectIssue(directory, "config.read");
  });

  it.runIf(process.platform !== "win32")("rejects a symbolic-link configuration", async () => {
    const target = await temporaryConfig(validConfig);
    const linkDirectory = await mkdtemp(join(temporaryRoot, "skillpress-config-test-"));
    temporaryDirectories.push(linkDirectory);
    const link = join(linkDirectory, CONFIG_FILE_NAME);
    symlinkSync(target.path, link);

    await expectIssue(link, "config.symlink");
  });

  it.runIf(process.platform !== "win32")(
    "rejects symbolic links in an intermediate path component",
    async () => {
      const target = await temporaryConfig(validConfig);
      const parent = await mkdtemp(join(temporaryRoot, "skillpress-config-test-"));
      temporaryDirectories.push(parent);
      const link = join(parent, "linked-directory");
      symlinkSync(target.directory, link);

      await expectIssue(join(link, CONFIG_FILE_NAME), "config.symlink");
    },
  );

  it.runIf(process.platform !== "win32")(
    "rejects a default configuration that is a symbolic link",
    async () => {
      const target = await temporaryConfig(validConfig);
      const linkDirectory = await mkdtemp(join(temporaryRoot, "skillpress-config-test-"));
      temporaryDirectories.push(linkDirectory);
      symlinkSync(target.path, join(linkDirectory, CONFIG_FILE_NAME));

      await expectIssue(linkDirectory, "config.symlink");
    },
  );

  it.runIf(process.platform !== "win32")("rejects a non-file configuration path", async () => {
    const directory = await mkdtemp(join(temporaryRoot, "skillpress-config-test-"));
    temporaryDirectories.push(directory);
    const socketPath = join(directory, "config.sock");
    const server = createServer();
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(socketPath, resolve);
    });

    try {
      await expectIssue(socketPath, "config.file_type");
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error === undefined ? resolve() : reject(error)));
      });
    }
  });

  it("compares both device and inode when checking an opened file", () => {
    expect(sameFileIdentity({ dev: 1, ino: 2 }, { dev: 1, ino: 2 })).toBe(true);
    expect(sameFileIdentity({ dev: 9, ino: 2 }, { dev: 1, ino: 2 })).toBe(false);
    expect(sameFileIdentity({ dev: 1, ino: 9 }, { dev: 1, ino: 2 })).toBe(false);
  });

  it("rejects a file swapped between inspection and opening", async () => {
    const expected = await temporaryConfig(validConfig);
    const replacement = await temporaryConfig(validConfig);
    const inspected = { path: expected.path, metadata: await lstat(expected.path) };

    await expectIssueFrom(
      readConfigText(inspected, async () => open(replacement.path, "r")),
      "config.changed",
    );
  });
});

async function expectIssueFrom(
  operation: Promise<unknown>,
  code: string,
): Promise<ProjectConfigError> {
  try {
    await operation;
  } catch (error) {
    expect(error).toBeInstanceOf(ProjectConfigError);
    const configError = error as ProjectConfigError;
    expect(configError.issues.map((entry) => entry.code)).toContain(code);
    return configError;
  }
  throw new Error(`Expected ${code}`);
}
