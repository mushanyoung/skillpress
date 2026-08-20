import { constants, symlinkSync } from "node:fs";
import { lstat, mkdir, open, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { readInspectedAgentSkillDocument } from "../src/validate/skill-document-read.js";
import { MAX_SKILL_DOCUMENT_BYTES } from "../src/validate/types.js";
import { inspectSkillFixture } from "./helpers/document-inspection.js";
import { createSkillFixtures, skillDocument } from "./helpers/skill-fixtures.js";

const fixtures = createSkillFixtures();
afterEach(() => fixtures.cleanup());

describe("bounded Agent Skill document reads", () => {
  it("rejects file identity swaps between inspection and opening", async () => {
    const expected = await fixtures.skill(
      "expected",
      skillDocument("name: expected\ndescription: A description.\nlicense: MIT"),
    );
    const replacement = await fixtures.skill(
      "replacement",
      skillDocument("name: replaced\ndescription: A description.\nlicense: MIT"),
    );
    const inspection = await inspectSkillFixture(expected.directory, expected.path);
    const result = await readInspectedAgentSkillDocument(inspection, async () =>
      open(replacement.path, "r"),
    );
    expect(result).toEqual({
      ok: false,
      code: "skill.document.changed",
      message: "SKILL.md changed while it was being opened",
    });
    expect(Object.isFrozen(result)).toBe(true);
  });

  it.runIf(process.platform !== "win32")(
    "does not follow a replacement symlink when no-follow flags are unavailable",
    async () => {
      const fixture = await fixtures.skill(
        "fallback",
        skillDocument("name: fallback\ndescription: A description.\nlicense: MIT"),
      );
      const inspection = await inspectSkillFixture(fixture.directory, fixture.path);
      const moved = join(fixture.directory, "moved.md");
      await rename(fixture.path, moved);
      symlinkSync(moved, fixture.path);
      let opened = false;
      const result = await readInspectedAgentSkillDocument(
        inspection,
        async () => {
          opened = true;
          return open(moved, "r");
        },
        { noFollow: false, nonBlock: false },
      );
      expect(result).toEqual({
        ok: false,
        code: "skill.document.changed",
        message: "SKILL.md changed before it was opened",
      });
      expect(opened).toBe(false);
    },
  );

  it.runIf(process.platform !== "win32")(
    "rejects a root reached through a replacement ancestor symlink",
    async () => {
      const parent = await fixtures.parent();
      const container = join(parent, "container");
      const directory = join(container, "nested-skill");
      await mkdir(directory, { recursive: true });
      const path = join(directory, "SKILL.md");
      await writeFile(
        path,
        skillDocument("name: nested-skill\ndescription: A description.\nlicense: MIT"),
      );
      const inspection = await inspectSkillFixture(directory, path);
      const moved = join(parent, "container-moved");
      await rename(container, moved);
      symlinkSync(moved, container);

      const result = await readInspectedAgentSkillDocument(inspection);
      expect(result).toEqual({
        ok: false,
        code: "skill.document.changed",
        message: "skill directory changed before SKILL.md was opened",
      });
    },
  );

  it.runIf(process.platform !== "win32")(
    "opens inspected files with the platform non-blocking flag",
    async () => {
      const fixture = await fixtures.skill(
        "non-blocking",
        skillDocument("name: non-blocking\ndescription: A description.\nlicense: MIT"),
      );
      const replacement = await fixtures.skill(
        "non-blocking-replacement",
        skillDocument("name: replacement\ndescription: A description.\nlicense: MIT"),
      );
      const inspection = await inspectSkillFixture(fixture.directory, fixture.path);
      let flags = 0;
      const result = await readInspectedAgentSkillDocument(inspection, async (_path, value) => {
        flags = value;
        return open(replacement.path, "r");
      });

      expect(result).toMatchObject({ ok: false, code: "skill.document.changed" });
      expect(flags & constants.O_NONBLOCK).toBe(constants.O_NONBLOCK);
    },
  );

  it("normalizes invalid file handles and open failures", async () => {
    const fixture = await fixtures.skill(
      "hostile-read",
      skillDocument("name: hostile-read\ndescription: A description.\nlicense: MIT"),
    );
    const inspection = await inspectSkillFixture(fixture.directory, fixture.path);
    const rawMetadata = await lstat(fixture.path, { bigint: true });
    let closed = false;
    const invalidRead = await readInspectedAgentSkillDocument(inspection, async () => ({
      async stat() {
        return rawMetadata;
      },
      async read(_buffer, _offset, length) {
        return { bytesRead: length + 1 };
      },
      async close() {
        closed = true;
      },
    }));
    expect(invalidRead).toEqual({
      ok: false,
      code: "skill.document.read",
      message: "SKILL.md returned an invalid read result",
    });
    expect(closed).toBe(true);

    const thrown = await readInspectedAgentSkillDocument(inspection, async () => {
      throw new Proxy(new Error("poison"), {
        getPrototypeOf() {
          throw new Error("poison prototype");
        },
      });
    });
    expect(thrown).toEqual({
      ok: false,
      code: "skill.document.read",
      message: "SKILL.md cannot be read safely",
    });
  });

  it("bounds invalid metadata and streams while ignoring close failures", async () => {
    const fixture = await fixtures.skill(
      "bounded-read",
      skillDocument("name: bounded-read\ndescription: A description.\nlicense: MIT"),
    );
    const inspection = await inspectSkillFixture(fixture.directory, fixture.path);
    const rawMetadata = await lstat(fixture.path, { bigint: true });
    const negative = await readInspectedAgentSkillDocument(
      { ...inspection, metadata: { size: -1n } as typeof inspection.metadata },
      async () => open(fixture.path),
    );
    expect(negative).toEqual({
      ok: false,
      code: "skill.document.read",
      message: "SKILL.md has invalid filesystem metadata",
    });

    let closed = false;
    const oversizedStream = await readInspectedAgentSkillDocument(inspection, async () => ({
      async stat() {
        return rawMetadata;
      },
      async read(buffer, _offset, length) {
        buffer.fill(0x61, 0, length);
        return { bytesRead: length };
      },
      async close() {
        closed = true;
        throw new Error("close failed");
      },
    }));
    expect(oversizedStream).toEqual({
      ok: false,
      code: "skill.document.too_large",
      message: `SKILL.md exceeds ${MAX_SKILL_DOCUMENT_BYTES} bytes`,
    });
    expect(closed).toBe(true);
  });

  it("accepts the exact byte boundary and rejects inspected oversize metadata", async () => {
    const fixture = await fixtures.skill(
      "read-boundary",
      new Uint8Array(MAX_SKILL_DOCUMENT_BYTES).fill(0x61),
    );
    const inspection = await inspectSkillFixture(fixture.directory, fixture.path);
    const accepted = await readInspectedAgentSkillDocument(inspection);
    expect(accepted).toMatchObject({ ok: true });

    const rejected = await readInspectedAgentSkillDocument({
      ...inspection,
      metadata: {
        ...inspection.metadata,
        size: BigInt(MAX_SKILL_DOCUMENT_BYTES + 1),
      } as typeof inspection.metadata,
    });
    expect(rejected).toEqual({
      ok: false,
      code: "skill.document.too_large",
      message: `SKILL.md exceeds ${MAX_SKILL_DOCUMENT_BYTES} bytes`,
    });
  });

  it("uses the non-mutating fallback for unchanged and missing files", async () => {
    const fixture = await fixtures.skill(
      "fallback-valid",
      skillDocument("name: fallback-valid\ndescription: A description.\nlicense: MIT"),
    );
    const inspection = await inspectSkillFixture(fixture.directory, fixture.path);
    const valid = await readInspectedAgentSkillDocument(
      inspection,
      async (path, flags) => open(path, flags),
      { noFollow: false, nonBlock: false },
    );
    expect(valid).toMatchObject({ ok: true });

    await unlink(fixture.path);
    const missing = await readInspectedAgentSkillDocument(
      inspection,
      async () => open(fixture.path),
      { noFollow: false, nonBlock: false },
    );
    expect(missing).toEqual({
      ok: false,
      code: "skill.document.read",
      message: "SKILL.md cannot be read safely",
    });
  });

  it("preserves the post-read context-change message", async () => {
    const fixture = await fixtures.skill(
      "context-after-read",
      skillDocument("name: context-after-read\ndescription: A description.\nlicense: MIT"),
    );
    const inspection = await inspectSkillFixture(fixture.directory, fixture.path);
    let checks = 0;
    const result = await readInspectedAgentSkillDocument(
      inspection,
      (path, flags) => open(path, flags),
      {
        noFollow:
          typeof (constants as Partial<typeof constants>).O_NOFOLLOW === "number" &&
          (constants as Partial<typeof constants>).O_NOFOLLOW !== 0,
        nonBlock:
          typeof (constants as Partial<typeof constants>).O_NONBLOCK === "number" &&
          (constants as Partial<typeof constants>).O_NONBLOCK !== 0,
      },
      async () => {
        checks += 1;
        return checks === 1;
      },
    );
    expect(result).toEqual({
      ok: false,
      code: "skill.document.changed",
      message: "SKILL.md changed while it was being read",
    });
  });

  it("captures the authoritative root before verification awaits", async () => {
    const expected = await fixtures.skill(
      "stable-root",
      skillDocument("name: stable-root\ndescription: A description.\nlicense: MIT"),
    );
    const replacement = await fixtures.skill(
      "replacement-root",
      skillDocument("name: replacement-root\ndescription: A description.\nlicense: MIT"),
    );
    const inspection = await inspectSkillFixture(expected.directory, expected.path);
    const other = await inspectSkillFixture(replacement.directory, replacement.path);
    const mutable = { ...inspection };
    const observed: Array<typeof inspection.root> = [];
    const result = await readInspectedAgentSkillDocument(
      mutable,
      (path, flags) => open(path, flags),
      {
        noFollow:
          typeof (constants as Partial<typeof constants>).O_NOFOLLOW === "number" &&
          (constants as Partial<typeof constants>).O_NOFOLLOW !== 0,
        nonBlock:
          typeof (constants as Partial<typeof constants>).O_NONBLOCK === "number" &&
          (constants as Partial<typeof constants>).O_NONBLOCK !== 0,
      },
      async (root) => {
        observed.push(root);
        mutable.root = other.root;
        return true;
      },
    );
    expect(result).toMatchObject({ ok: true });
    expect(observed).toEqual([inspection.root, inspection.root]);
  });

  it("normalizes a hostile root getter before calling the generic reader", async () => {
    const fixture = await fixtures.skill(
      "hostile-root",
      skillDocument("name: hostile-root\ndescription: A description.\nlicense: MIT"),
    );
    const inspection = await inspectSkillFixture(fixture.directory, fixture.path);
    const hostile = new Proxy(inspection, {
      get(target, property, receiver) {
        if (property === "root") throw new Error("secret root getter");
        return Reflect.get(target, property, receiver);
      },
    });
    const result = await readInspectedAgentSkillDocument(hostile);
    expect(result).toEqual({
      ok: false,
      code: "skill.document.read",
      message: "SKILL.md cannot be read safely",
    });
    expect(JSON.stringify(result)).not.toContain("secret");
  });
});
