import { realpathSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const temporaryRoot = realpathSync(tmpdir());

export function skillDocument(
  frontmatter: string,
  body = "# Instructions\n\nDo the work safely.\n",
) {
  return `---\n${frontmatter}\n---\n${body}`;
}

export function createSkillFixtures() {
  const directories: string[] = [];
  return {
    async cleanup(): Promise<void> {
      await Promise.all(
        directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
      );
    },
    async parent(): Promise<string> {
      const parent = await mkdtemp(join(temporaryRoot, "skillpress-validator-test-"));
      directories.push(parent);
      return parent;
    },
    async skill(
      name: string,
      content: string | Uint8Array,
    ): Promise<{ readonly directory: string; readonly path: string }> {
      const parent = await this.parent();
      const directory = join(parent, name);
      await mkdir(directory);
      const path = join(directory, "SKILL.md");
      await writeFile(path, content, { mode: 0o600 });
      return { directory, path };
    },
  };
}
