import { describe, expect, it } from "vitest";

import { CapabilityBriefError, ProjectCreationError } from "../src/create/errors.js";

describe("create error contracts", () => {
  it("retains only an explicitly supplied trusted cause", () => {
    const cause = new Error("trusted internal cause");
    const brief = new CapabilityBriefError("brief failed", [], cause);
    const creation = new ProjectCreationError("create failed", "io", [], cause);

    expect(brief.cause).toBe(cause);
    expect(creation.cause).toBe(cause);
    expect(new CapabilityBriefError("brief failed", []).cause).toBeUndefined();
    expect(new ProjectCreationError("create failed", "io", []).cause).toBeUndefined();
  });
});
