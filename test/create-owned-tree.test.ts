import { createHash } from "node:crypto";
import { realpathSync, symlinkSync } from "node:fs";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { ProjectCreationError } from "../src/create/errors.js";
import { INCOMPLETE_MARKER } from "../src/create/manifest.js";
import {
  finalizeOwnedDirectory,
  finalizeOwnedFile,
  type OwnedEntry,
  recordOwned,
  verifyOwnedTree,
} from "../src/create/owned-tree.js";

const temporaryRoot = realpathSync(tmpdir());
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })),
  );
});

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(temporaryRoot, "skillpress-owned-tree-test-"));
  temporaryDirectories.push(directory);
  return directory;
}

function digest(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

interface TreeFixture {
  readonly root: string;
  readonly marker: string;
  readonly file: string;
  readonly entries: OwnedEntry[];
  readonly expected: Map<string, { bytes: number; sha256: string }>;
}

async function createTree(content = "verified content\n"): Promise<TreeFixture> {
  const parent = await temporaryDirectory();
  const root = join(parent, "tree");
  const nested = join(root, "nested");
  const marker = join(root, INCOMPLETE_MARKER);
  const file = join(nested, "file.txt");
  await mkdir(root);
  const entries = [await recordOwned(root, "directory")];
  await writeFile(marker, "transaction\n", { flag: "wx", mode: 0o600 });
  entries.push(await recordOwned(marker, "file"));
  await mkdir(nested);
  entries.push(await recordOwned(nested, "directory"));
  await writeFile(file, content, { flag: "wx", mode: 0o600 });
  entries.push(await recordOwned(file, "file"));
  return {
    root,
    marker,
    file,
    entries,
    expected: new Map([
      ["nested/file.txt", { bytes: Buffer.byteLength(content), sha256: digest(content) }],
    ]),
  };
}

describe("owned filesystem trees", () => {
  it("verifies exact content and finalizes only recorded entries", async () => {
    const content = "x".repeat(70 * 1024);
    const fixture = await createTree(content);

    await expect(
      verifyOwnedTree(fixture.root, fixture.entries, fixture.expected, false),
    ).resolves.toBe(true);
    await expect(
      verifyOwnedTree(fixture.root, fixture.entries, fixture.expected, true),
    ).resolves.toBe(true);

    if (process.platform !== "win32") {
      expect((await stat(fixture.root)).mode & 0o777).toBe(0o755);
      expect((await stat(fixture.file)).mode & 0o777).toBe(0o644);
      expect((await stat(fixture.marker)).mode & 0o777).toBe(0o600);
    }
  });

  it("supports bounded empty files", async () => {
    const fixture = await createTree("");

    await expect(
      verifyOwnedTree(fixture.root, fixture.entries, fixture.expected, true),
    ).resolves.toBe(true);
  });

  it("uses a verify-only directory fallback when no-follow flags are unavailable", async () => {
    const parent = await temporaryDirectory();
    const directory = join(parent, "owned");
    await mkdir(directory, { mode: 0o700 });
    const owned = await recordOwned(directory, "directory");
    const unavailable = { noFollow: undefined, directory: undefined };

    await expect(finalizeOwnedDirectory(owned, 0o755, unavailable)).resolves.toBe(true);
    if (process.platform !== "win32") {
      expect((await stat(directory)).mode & 0o777).toBe(0o700);
    }
    await rename(directory, `${directory}-moved`);
    await writeFile(directory, "replacement", { flag: "wx" });
    await expect(finalizeOwnedDirectory(owned, 0o755, unavailable)).resolves.toBe(false);
    await unlink(directory);
    await expect(finalizeOwnedDirectory(owned, 0o755, unavailable)).resolves.toBe(false);
  });

  it.runIf(process.platform !== "win32")(
    "does not follow a same-inode directory symlink while finalizing modes",
    async () => {
      const parent = await temporaryDirectory();
      const directory = join(parent, "owned");
      const moved = join(parent, "moved");
      await mkdir(directory, { mode: 0o700 });
      const owned = await recordOwned(directory, "directory");
      await rename(directory, moved);
      symlinkSync(moved, directory);

      await expect(finalizeOwnedDirectory(owned, 0o755)).resolves.toBe(false);
      expect((await stat(moved)).mode & 0o777).toBe(0o700);
    },
  );

  it.runIf(process.platform !== "win32")(
    "uses a non-mutating file fallback when no-follow open is unavailable",
    async () => {
      const parent = await temporaryDirectory();
      const file = join(parent, "owned");
      const moved = join(parent, "moved");
      const content = "verified content\n";
      await writeFile(file, content, { flag: "wx", mode: 0o600 });
      const owned = await recordOwned(file, "file");
      const expected = { bytes: Buffer.byteLength(content), sha256: digest(content) };
      const unavailable = { noFollow: undefined };

      await expect(finalizeOwnedFile(owned, expected, 0o644, unavailable)).resolves.toBe(true);
      expect((await stat(file)).mode & 0o777).toBe(0o600);

      await rename(file, moved);
      symlinkSync(moved, file);
      await expect(finalizeOwnedFile(owned, expected, 0o644, unavailable)).resolves.toBe(false);
      expect((await stat(moved)).mode & 0o777).toBe(0o600);
    },
  );

  it("rejects unknown entries and content, size, identity, or expectation changes", async () => {
    const unknown = await createTree();
    await writeFile(join(unknown.root, "foreign"), "unknown", { flag: "wx" });
    await expect(
      verifyOwnedTree(unknown.root, unknown.entries, unknown.expected, false),
    ).resolves.toBe(false);

    const changed = await createTree();
    await writeFile(changed.file, "x".repeat(Buffer.byteLength("verified content\n")), {
      flag: "w",
    });
    await expect(
      verifyOwnedTree(changed.root, changed.entries, changed.expected, false),
    ).resolves.toBe(false);

    const truncated = await createTree();
    await writeFile(truncated.file, "short", { flag: "w" });
    await expect(
      verifyOwnedTree(truncated.root, truncated.entries, truncated.expected, false),
    ).resolves.toBe(false);

    const replaced = await createTree();
    const replacement = join(replaced.root, "replacement");
    await writeFile(replacement, "verified content\n", { flag: "wx" });
    await unlink(replaced.file);
    await rename(replacement, replaced.file);
    await expect(
      verifyOwnedTree(replaced.root, replaced.entries, replaced.expected, false),
    ).resolves.toBe(false);

    const unexpectedFile = await createTree();
    await expect(
      verifyOwnedTree(unexpectedFile.root, unexpectedFile.entries, new Map(), false),
    ).resolves.toBe(false);
  });

  it.runIf(process.platform !== "win32")(
    "does not follow a replacement symlink during verification",
    async () => {
      const fixture = await createTree();
      const external = join(await temporaryDirectory(), "external");
      await writeFile(external, "verified content\n", { flag: "wx" });
      await unlink(fixture.file);
      symlinkSync(external, fixture.file);

      await expect(
        verifyOwnedTree(fixture.root, fixture.entries, fixture.expected, true),
      ).resolves.toBe(false);
      await expect(readFile(external, "utf8")).resolves.toBe("verified content\n");
    },
  );

  it.runIf(process.platform !== "win32")(
    "does not read or chmod a same-inode file through a replacement symlink",
    async () => {
      const fixture = await createTree();
      const moved = join(fixture.root, "..", "moved-file");
      await rename(fixture.file, moved);
      await chmod(moved, 0o600);
      symlinkSync(moved, fixture.file);

      await expect(
        verifyOwnedTree(fixture.root, fixture.entries, fixture.expected, true),
      ).resolves.toBe(false);
      expect((await stat(moved)).mode & 0o777).toBe(0o600);
    },
  );

  it("records only the requested non-symbolic filesystem type", async () => {
    const parent = await temporaryDirectory();
    const file = join(parent, "file");
    const directory = join(parent, "directory");
    await writeFile(file, "content", { flag: "wx" });
    await mkdir(directory);

    await expect(recordOwned(file, "file")).resolves.toMatchObject({ kind: "file" });
    await expect(recordOwned(directory, "directory")).resolves.toMatchObject({ kind: "directory" });
    await expect(recordOwned(file, "directory")).rejects.toBeInstanceOf(ProjectCreationError);
    await expect(recordOwned(directory, "file")).rejects.toBeInstanceOf(ProjectCreationError);

    if (process.platform !== "win32") {
      const link = join(parent, "link");
      symlinkSync(file, link);
      await expect(recordOwned(link, "file")).rejects.toBeInstanceOf(ProjectCreationError);
    }
  });

  it("requires the exact root directory journal entry", async () => {
    const fixture = await createTree();

    await expect(verifyOwnedTree(fixture.root, [], fixture.expected, false)).resolves.toBe(false);
    await expect(
      verifyOwnedTree(fixture.root, fixture.entries.slice(1), fixture.expected, false),
    ).resolves.toBe(false);
  });

  it("requires every expected file to have an owned journal entry", async () => {
    const fixture = await createTree();
    await unlink(fixture.file);
    const withoutFile = fixture.entries.filter((entry) => entry.path !== fixture.file);

    await expect(verifyOwnedTree(fixture.root, withoutFile, fixture.expected, false)).resolves.toBe(
      false,
    );
  });

  it("never satisfies an expected file with a directory entry", async () => {
    const parent = await temporaryDirectory();
    const root = join(parent, "root");
    const child = join(root, "child");
    await mkdir(child, { recursive: true });
    const entries = [await recordOwned(root, "directory"), await recordOwned(child, "directory")];
    const expected = new Map([["child", { bytes: 0, sha256: digest("") }]]);

    await expect(verifyOwnedTree(root, entries, expected, false)).resolves.toBe(false);
  });

  it("rejects duplicate, orphaned, and out-of-root journal entries", async () => {
    const fixture = await createTree();
    const outside = join(await temporaryDirectory(), "outside");
    await writeFile(outside, "foreign", { flag: "wx" });
    const outsideEntry = await recordOwned(outside, "file");
    const outsideMode = (await stat(outside)).mode;

    await expect(
      verifyOwnedTree(
        fixture.root,
        [...fixture.entries, fixture.entries[1] as OwnedEntry],
        fixture.expected,
        false,
      ),
    ).resolves.toBe(false);
    await expect(
      verifyOwnedTree(
        fixture.root,
        [fixture.entries[0] as OwnedEntry, outsideEntry],
        new Map(),
        true,
      ),
    ).resolves.toBe(false);
    expect((await stat(outside)).mode).toBe(outsideMode);

    const orphanEntries = fixture.entries.filter(
      (entry) => entry.path !== join(fixture.root, "nested"),
    );
    await expect(
      verifyOwnedTree(fixture.root, orphanEntries, fixture.expected, false),
    ).resolves.toBe(false);
  });
});
