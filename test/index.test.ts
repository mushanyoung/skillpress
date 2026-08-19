import { describe, expect, it } from "vitest";

import * as skillpress from "../src/index.js";

describe("public API", () => {
  it("exports the CLI entrypoints and version", () => {
    expect(skillpress.VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    expect(skillpress.renderHelp()).toContain(skillpress.VERSION);
    expect(skillpress.runCli).toBeTypeOf("function");
  });
});
