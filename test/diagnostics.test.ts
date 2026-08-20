import { describe, expect, it } from "vitest";

import { compareDiagnostics, DiagnosticCollector } from "../src/validate/diagnostics.js";
import type { AgentSkillDiagnostic } from "../src/validate/types.js";

function diagnostic(overrides: Partial<AgentSkillDiagnostic> = {}): AgentSkillDiagnostic {
  return {
    code: "z.code",
    severity: "warning",
    scope: "portable",
    file: "z.md",
    message: "z message",
    ...overrides,
  };
}

describe("validation diagnostics", () => {
  it("uses a total deterministic ordering for every diagnostic field", () => {
    const values = [
      diagnostic(),
      diagnostic({ severity: "error" }),
      diagnostic({ file: "a.md" }),
      diagnostic({ line: 2 }),
      diagnostic({ line: 2, column: 3 }),
      diagnostic({ code: "a.code" }),
      diagnostic({ scope: "agent-skills" }),
      diagnostic({ message: "a message" }),
    ];
    const first = [...values].sort(compareDiagnostics);
    const second = [...values].reverse().sort(compareDiagnostics);

    expect(second).toEqual(first);
    expect(first[0]?.severity).toBe("error");
    expect(
      compareDiagnostics(values[0] as AgentSkillDiagnostic, values[0] as AgentSkillDiagnostic),
    ).toBe(0);
    expect(
      compareDiagnostics(diagnostic({ message: "\ud800" }), diagnostic({ message: "\ud801" })),
    ).not.toBe(0);
    expect(
      compareDiagnostics(
        diagnostic({ line: Number.MAX_SAFE_INTEGER }),
        diagnostic({ line: undefined }),
      ),
    ).not.toBe(0);
    expect(compareDiagnostics(diagnostic({ line: -0 }), diagnostic({ line: 0 }))).toBeLessThan(0);
    expect(
      compareDiagnostics(diagnostic({ line: Number.NaN }), diagnostic({ line: Infinity })),
    ).toBeGreaterThan(0);
    const orderedPairs: ReadonlyArray<readonly [AgentSkillDiagnostic, AgentSkillDiagnostic]> = [
      [diagnostic({ severity: "error" }), diagnostic({ severity: "warning" })],
      [diagnostic({ file: "a.md" }), diagnostic({ file: "z.md" })],
      [diagnostic({ line: 1 }), diagnostic({ line: 2 })],
      [diagnostic({ line: 1, column: 1 }), diagnostic({ line: 1, column: 2 })],
      [diagnostic({ code: "a.code" }), diagnostic({ code: "z.code" })],
      [diagnostic({ scope: "agent-skills" }), diagnostic({ scope: "portable" })],
      [diagnostic({ message: "a message" }), diagnostic({ message: "z message" })],
      [diagnostic({ line: Infinity }), diagnostic({ line: Number.NaN })],
    ];
    for (const [left, right] of orderedPairs) {
      expect(compareDiagnostics(left, right)).toBeLessThan(0);
      expect(compareDiagnostics(right, left)).toBeGreaterThan(0);
    }
    expect(
      compareDiagnostics(diagnostic({ column: undefined }), diagnostic({ column: 1 })),
    ).toBeGreaterThan(0);
  });

  it("emits optional locations and omits invalid metadata", () => {
    const collector = new DiagnosticCollector();
    collector.add("example", "error", "openai", "example", {
      file: ".",
      line: 1,
      column: 2,
    });
    const report = collector.finish({ name: "safe", description: "safe" });

    expect(report.ok).toBe(false);
    expect(report.metadata).toBeUndefined();
    expect(report.diagnostics[0]).toMatchObject({ file: ".", line: 1, column: 2 });

    const empty = new DiagnosticCollector().finish();
    expect(empty).toEqual({ schemaVersion: 1, ok: true, diagnostics: [] });
    const successful = new DiagnosticCollector().finish({ name: "safe", description: "safe" });
    expect(successful.metadata).toEqual({ name: "safe", description: "safe" });
  });

  it("finishes once and never grows beyond the diagnostic budget", () => {
    const collector = new DiagnosticCollector();
    for (let index = 0; index < 300; index += 1) {
      collector.add(`example.${index}`, "error", "skillpress", "example");
    }
    const first = collector.finish();
    collector.add("late", "error", "skillpress", "late");
    const second = collector.finish();

    expect(second).toBe(first);
    expect(second.diagnostics).toHaveLength(256);
    expect(
      second.diagnostics.filter((entry) => entry.code === "skill.diagnostics.truncated"),
    ).toHaveLength(1);
  });
});
