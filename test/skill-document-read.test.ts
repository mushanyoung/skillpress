import { constants, symlinkSync } from "node:fs";
import { mkdir, open, rename, unlink, writeFile } from "node:fs/promises";
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
    expect(result).toMatchObject({ ok: false, code: "skill.document.changed" });
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
        { noFollow: undefined, nonBlock: undefined },
      );
      expect(result).toMatchObject({ ok: false, code: "skill.document.changed" });
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
      expect(result).toMatchObject({ ok: false, code: "skill.document.changed" });
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
    let closed = false;
    const invalidRead = await readInspectedAgentSkillDocument(inspection, async () => ({
      async stat() {
        return inspection.metadata;
      },
      async read(_buffer, _offset, length) {
        return { bytesRead: length + 1 };
      },
      async close() {
        closed = true;
      },
    }));
    expect(invalidRead).toMatchObject({ ok: false, code: "skill.document.read" });
    expect(closed).toBe(true);

    const thrown = await readInspectedAgentSkillDocument(inspection, async () => {
      throw new Proxy(new Error("poison"), {
        getPrototypeOf() {
          throw new Error("poison prototype");
        },
      });
    });
    expect(thrown).toMatchObject({ ok: false, code: "skill.document.read" });
  });

  it("bounds invalid metadata and streams while ignoring close failures", async () => {
    const fixture = await fixtures.skill(
      "bounded-read",
      skillDocument("name: bounded-read\ndescription: A description.\nlicense: MIT"),
    );
    const inspection = await inspectSkillFixture(fixture.directory, fixture.path);
    const negative = await readInspectedAgentSkillDocument(
      { ...inspection, metadata: { size: -1n } as typeof inspection.metadata },
      async () => open(fixture.path),
    );
    expect(negative).toMatchObject({ ok: false, code: "skill.document.read" });

    let closed = false;
    const oversizedStream = await readInspectedAgentSkillDocument(inspection, async () => ({
      async stat() {
        return inspection.metadata;
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
    expect(oversizedStream).toMatchObject({ ok: false, code: "skill.document.too_large" });
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
    expect(rejected).toMatchObject({ ok: false, code: "skill.document.too_large" });
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
      { noFollow: undefined, nonBlock: undefined },
    );
    expect(valid).toMatchObject({ ok: true });

    await unlink(fixture.path);
    const missing = await readInspectedAgentSkillDocument(
      inspection,
      async () => open(fixture.path),
      { noFollow: undefined, nonBlock: undefined },
    );
    expect(missing).toMatchObject({ ok: false, code: "skill.document.read" });
  });
});
