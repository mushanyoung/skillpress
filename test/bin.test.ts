import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { VERSION } from "../src/version.js";

const binPath = fileURLToPath(new URL("../dist/bin.js", import.meta.url));

function invokeBin(...args: readonly string[]): {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
} {
  const result = spawnSync(process.execPath, [binPath, ...args], {
    encoding: "utf8",
    env: {},
    timeout: 5_000,
  });

  if (result.error !== undefined) {
    throw result.error;
  }

  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

describe("compiled SkillPress binary", () => {
  it("prints help as a real process", () => {
    const result = invokeBin("--help");

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Usage:");
    expect(result.stderr).toBe("");
  });

  it("prints the package version as a real process", () => {
    const result = invokeBin("--version");

    expect(result.status).toBe(0);
    expect(result.stdout).toBe(`${VERSION}\n`);
    expect(result.stderr).toBe("");
  });

  it("returns the usage exit code for an unknown command", () => {
    const result = invokeBin("create");

    expect(result.status).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("Unknown command: create");
  });
});
