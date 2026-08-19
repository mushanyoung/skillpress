import { afterEach, describe, expect, it, vi } from "vitest";

import { renderHelp, runCli } from "../src/cli.js";
import { VERSION } from "../src/version.js";

function captureIo(): {
  readonly stdout: string[];
  readonly stderr: string[];
  readonly io: {
    readonly stdout: (text: string) => void;
    readonly stderr: (text: string) => void;
  };
} {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    stdout,
    stderr,
    io: {
      stdout: (text) => stdout.push(text),
      stderr: (text) => stderr.push(text),
    },
  };
}

describe("SkillPress CLI scaffold", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each([{ args: [] }, { args: ["--help"] }, { args: ["-h"] }, { args: ["help"] }])(
    "renders help for $args",
    async ({ args }) => {
      const capture = captureIo();

      await expect(runCli(args, capture.io)).resolves.toBe(0);
      expect(capture.stdout).toEqual([renderHelp()]);
      expect(capture.stderr).toEqual([]);
      expect(renderHelp()).toContain("SkillPress");
    },
  );

  it.each([{ args: ["--version"] }, { args: ["-v"] }])(
    "renders the package version for $args",
    async ({ args }) => {
      const capture = captureIo();

      await expect(runCli(args, capture.io)).resolves.toBe(0);
      expect(capture.stdout).toEqual([`${VERSION}\n`]);
      expect(capture.stderr).toEqual([]);
    },
  );

  it("rejects a command that has not landed", async () => {
    const capture = captureIo();

    await expect(runCli(["create"], capture.io)).resolves.toBe(2);
    expect(capture.stdout).toEqual([]);
    expect(capture.stderr.join("")).toContain("Unknown command: create");
  });

  it("uses process stdout when no IO adapter is supplied", async () => {
    const write = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await expect(runCli(["--version"])).resolves.toBe(0);
    expect(write).toHaveBeenCalledWith(`${VERSION}\n`);
  });

  it("uses process stderr when no IO adapter is supplied", async () => {
    const write = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    await expect(runCli(["not-a-command"])).resolves.toBe(2);
    expect(write).toHaveBeenCalledWith(expect.stringContaining("Unknown command"));
  });
});
