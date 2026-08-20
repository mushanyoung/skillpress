import { describe, expect, it } from "vitest";

import * as skillpress from "../src/index.js";

describe("public API", () => {
  it("exports the CLI scaffold and project writer entrypoints", () => {
    expect(skillpress.VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    expect(skillpress.renderHelp()).toContain(skillpress.VERSION);
    expect(skillpress.runCli).toBeTypeOf("function");
    expect(skillpress.ProjectCreationError).toBeTypeOf("function");
    expect(skillpress.writeRenderedProject).toBeTypeOf("function");
  });
});
