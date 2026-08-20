import {
  type AgentSkillDiagnostic,
  type AgentSkillDiagnosticScope,
  type AgentSkillDiagnosticSeverity,
  type AgentSkillMetadata,
  type AgentSkillValidationReport,
  type DiagnosticLocation,
  MAX_SKILL_DIAGNOSTICS,
} from "./types.js";

const SKILL_DOCUMENT_NAME = "SKILL.md";

function compareText(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function compareLocationNumber(left: number | undefined, right: number | undefined): number {
  if (Object.is(left, right)) return 0;
  if (left === undefined) return 1;
  if (right === undefined) return -1;
  if (Number.isNaN(left)) return 1;
  if (Number.isNaN(right)) return -1;
  if (left === right) return Object.is(left, -0) ? -1 : 1;
  return left < right ? -1 : 1;
}

export function compareDiagnostics(
  left: AgentSkillDiagnostic,
  right: AgentSkillDiagnostic,
): number {
  const severity = left.severity === right.severity ? 0 : left.severity === "error" ? -1 : 1;
  return (
    severity ||
    compareText(left.file, right.file) ||
    compareLocationNumber(left.line, right.line) ||
    compareLocationNumber(left.column, right.column) ||
    compareText(left.code, right.code) ||
    compareText(left.scope, right.scope) ||
    compareText(left.message, right.message)
  );
}

export class DiagnosticCollector {
  readonly #diagnostics: AgentSkillDiagnostic[] = [];
  #finished: AgentSkillValidationReport | undefined;
  #truncated = false;

  add(
    code: string,
    severity: AgentSkillDiagnosticSeverity,
    scope: AgentSkillDiagnosticScope,
    message: string,
    location: DiagnosticLocation = {},
  ): void {
    if (this.#finished !== undefined) return;
    if (this.#diagnostics.length >= MAX_SKILL_DIAGNOSTICS - 1) {
      this.#truncated = true;
      return;
    }
    this.#diagnostics.push(
      Object.freeze({
        code,
        severity,
        scope,
        file: location.file ?? SKILL_DOCUMENT_NAME,
        message,
        ...(location.line === undefined ? {} : { line: location.line }),
        ...(location.column === undefined ? {} : { column: location.column }),
      }),
    );
  }

  finish(metadata?: AgentSkillMetadata): AgentSkillValidationReport {
    if (this.#finished !== undefined) return this.#finished;
    if (this.#truncated) {
      this.#diagnostics.push(
        Object.freeze({
          code: "skill.diagnostics.truncated",
          severity: "error",
          scope: "skillpress",
          file: SKILL_DOCUMENT_NAME,
          message: `validation diagnostics were truncated at ${MAX_SKILL_DIAGNOSTICS} entries`,
        }),
      );
    }
    this.#diagnostics.sort(compareDiagnostics);
    const diagnostics = Object.freeze([...this.#diagnostics]);
    const ok = diagnostics.every((diagnostic) => diagnostic.severity !== "error");
    this.#finished = Object.freeze({
      schemaVersion: 1 as const,
      ok,
      diagnostics,
      ...(ok && metadata !== undefined ? { metadata } : {}),
    });
    return this.#finished;
  }
}
