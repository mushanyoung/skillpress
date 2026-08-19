export interface ConfigIssue {
  readonly code: string;
  readonly path: string;
  readonly message: string;
}

export class ProjectConfigError extends Error {
  readonly issues: readonly ConfigIssue[];

  constructor(message: string, issues: readonly ConfigIssue[], cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "ProjectConfigError";
    this.issues = issues;
  }
}
