import { expect } from "vitest";

import { validateAgentSkill } from "../../src/validate/agent-skill.js";
import type { AgentSkillValidationReport } from "../../src/validate/types.js";

export function diagnosticCodes(report: AgentSkillValidationReport): string[] {
  return report.diagnostics.map((diagnostic) => diagnostic.code);
}

export async function expectDiagnosticCodes(
  directory: string,
  ...expected: string[]
): Promise<AgentSkillValidationReport> {
  const report = await validateAgentSkill(directory);
  for (const code of expected) expect(diagnosticCodes(report)).toContain(code);
  return report;
}
