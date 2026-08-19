export interface CapabilityBriefIssue {
  readonly code: string;
  readonly path: string;
  readonly message: string;
}

export class CapabilityBriefError extends Error {
  readonly issues: readonly CapabilityBriefIssue[];

  constructor(message: string, issues: readonly CapabilityBriefIssue[], cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "CapabilityBriefError";
    this.issues = issues;
  }
}

export type ProjectCreationErrorKind = "io" | "unsafe-output";

export class ProjectCreationError extends Error {
  readonly issues: readonly CapabilityBriefIssue[];
  readonly kind: ProjectCreationErrorKind;

  constructor(
    message: string,
    kind: ProjectCreationErrorKind,
    issues: readonly CapabilityBriefIssue[],
    cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "ProjectCreationError";
    this.kind = kind;
    this.issues = issues;
  }
}
