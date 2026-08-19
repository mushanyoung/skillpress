import { spawnSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { VERSION } from "../src/version.js";

const binPath = fileURLToPath(new URL("../dist/bin.js", import.meta.url));
const staleBuildPath = fileURLToPath(new URL("../dist/stale-build-output.js", import.meta.url));

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

  it("removes stale output before rebuilding", () => {
    writeFileSync(staleBuildPath, "stale\n", { encoding: "utf8", mode: 0o600 });
    const npm = process.platform === "win32" ? "npm.cmd" : "npm";
    const result = spawnSync(npm, ["run", "build"], {
      cwd: fileURLToPath(new URL("..", import.meta.url)),
      encoding: "utf8",
      env: process.env,
      timeout: 30_000,
    });

    if (result.error !== undefined) {
      throw result.error;
    }

    expect(result.status, result.stderr).toBe(0);
    expect(existsSync(staleBuildPath)).toBe(false);
    expect(existsSync(binPath)).toBe(true);
  });
});
