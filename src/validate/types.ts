export const MAX_SKILL_DOCUMENT_BYTES = 512 * 1024;
export const MAX_SKILL_FRONTMATTER_BYTES = 64 * 1024;
export const MAX_SKILL_DIAGNOSTICS = 256;
export const MAX_SKILL_DIRECTORY_ENTRIES = 1024;

export type AgentSkillDiagnosticSeverity = "error" | "warning";
export type AgentSkillDiagnosticScope =
  | "agent-skills"
  | "portable"
  | "skillpress"
  | "openai"
  | "anthropic";

export interface AgentSkillDiagnostic {
  readonly code: string;
  readonly severity: AgentSkillDiagnosticSeverity;
  readonly scope: AgentSkillDiagnosticScope;
  readonly file: string;
  readonly message: string;
  readonly line?: number;
  readonly column?: number;
}

export interface AgentSkillMetadata {
  readonly name: string;
  readonly description: string;
  readonly license?: string;
  readonly compatibility?: string;
  readonly metadata?: Readonly<Record<string, string>>;
  readonly allowedTools?: string;
}

export interface AgentSkillValidationReport {
  readonly schemaVersion: 1;
  readonly ok: boolean;
  readonly diagnostics: readonly AgentSkillDiagnostic[];
  readonly metadata?: AgentSkillMetadata;
}

export interface AgentSkillValidationOptions {
  readonly expectedName?: string;
}

export interface DiagnosticLocation {
  readonly file?: string;
  readonly line?: number;
  readonly column?: number;
}

export interface ParsedMapEntry {
  readonly key: string | undefined;
  readonly value: string | undefined;
}

export type ParsedFrontmatterValue =
  | { readonly kind: "string"; readonly value: string }
  | { readonly kind: "map"; readonly entries: readonly ParsedMapEntry[] }
  | { readonly kind: "other" };

export interface ParsedFrontmatterField {
  readonly value: ParsedFrontmatterValue;
  readonly location: DiagnosticLocation;
}

export interface ParsedAgentSkillFrontmatter {
  readonly fields: ReadonlyMap<string, ParsedFrontmatterField>;
  readonly body: string;
  /** One-based SKILL.md line containing the first body character. */
  readonly bodyStartLine: number;
  /** UTF-16 code-unit offset of the body in the original SKILL.md string. */
  readonly bodyStartOffset: number;
}

export interface MutableAgentSkillMetadata {
  name?: string;
  description?: string;
  license?: string;
  compatibility?: string;
  metadata?: Readonly<Record<string, string>>;
  allowedTools?: string;
}
