import {
  MAX_SKILL_MARKDOWN_DEFINITIONS_PER_FILE,
  MAX_SKILL_MARKDOWN_SOURCE_BYTES,
  MAX_SKILL_MARKDOWN_TARGETS_PER_FILE,
  type MarkdownAnalysisIssue,
} from "./markdown-analysis.js";
import {
  MAX_SKILL_REFERENCE_COMPONENT_BYTES,
  MAX_SKILL_REFERENCE_DESTINATION_BYTES,
  MAX_SKILL_REFERENCE_PATH_COMPONENTS,
  type MarkdownDestinationIssue,
} from "./markdown-destination.js";
import {
  MAX_SKILL_MARKDOWN_GRAPH_ALIAS_CANDIDATES,
  MAX_SKILL_MARKDOWN_GRAPH_BYTES,
  MAX_SKILL_MARKDOWN_GRAPH_COMPONENTS,
  MAX_SKILL_MARKDOWN_GRAPH_FILES,
  MAX_SKILL_MARKDOWN_GRAPH_NODES,
  MAX_SKILL_MARKDOWN_GRAPH_TARGETS,
  MAX_SKILL_MARKDOWN_GRAPH_WORK,
  type MarkdownResourceGraph,
  type MarkdownResourceGraphFailureReason,
  type MarkdownResourceGraphFinding,
  type MarkdownResourceGraphLocation,
} from "./markdown-resource-graph.js";
import {
  MAX_RESOURCE_TREE_DEPTH,
  MAX_RESOURCE_TREE_ENTRIES,
  MAX_RESOURCE_TREE_TOTAL_RELATIVE_PATH_BYTES,
} from "./resource-tree-layout.js";
import type { DiagnosticCollector } from "./diagnostics.js";
import { MAX_SKILL_DOCUMENT_BYTES, type DiagnosticLocation } from "./types.js";

const objectGetOwnPropertyDescriptorSnapshot = Object.getOwnPropertyDescriptor;

function add(
  diagnostics: DiagnosticCollector,
  code: string,
  message: string,
  location: DiagnosticLocation = {},
): void {
  diagnostics.add(code, "error", "skillpress", message, location);
}

function ownLocation(
  finding: MarkdownResourceGraphFinding,
): MarkdownResourceGraphLocation | undefined {
  const descriptor = objectGetOwnPropertyDescriptorSnapshot(finding, "location");
  if (descriptor === undefined) return undefined;
  const valueDescriptor = objectGetOwnPropertyDescriptorSnapshot(descriptor, "value");
  return valueDescriptor?.value as MarkdownResourceGraphLocation | undefined;
}

function markdownMessage(code: MarkdownAnalysisIssue["code"]): string {
  switch (code) {
    case "skill.markdown.complexity":
      return "Markdown exceeds the supported analysis complexity";
    case "skill.markdown.duplicate_definition":
      return "Markdown reference definitions must be unique";
    case "skill.markdown.parse":
      return "Markdown could not be parsed safely";
    case "skill.markdown.too_many_definitions":
      return `Markdown contains more than ${MAX_SKILL_MARKDOWN_DEFINITIONS_PER_FILE} reference definitions`;
    case "skill.markdown.too_large":
      return `Markdown exceeds ${MAX_SKILL_MARKDOWN_SOURCE_BYTES} bytes`;
    case "skill.markdown.too_many_targets":
      return `Markdown contains more than ${MAX_SKILL_MARKDOWN_TARGETS_PER_FILE} links and images`;
  }
}

function destinationMessage(reason: MarkdownDestinationIssue): string {
  switch (reason) {
    case "absolute_path":
      return "Markdown destinations must not use absolute paths";
    case "ambiguous_encoding":
      return "Markdown destinations must not use ambiguous percent encoding";
    case "backslash":
      return "Markdown destinations must use forward slashes";
    case "component_too_large":
      return `Markdown destination path components must not exceed ${MAX_SKILL_REFERENCE_COMPONENT_BYTES} bytes`;
    case "dot_component":
      return "Markdown destinations must not contain dot path components";
    case "empty_component":
      return "Markdown destinations must not contain empty path components";
    case "encoded_delimiter":
      return "Markdown destinations must not percent-encode URI delimiters";
    case "encoded_separator":
      return "Markdown destinations must not percent-encode path separators";
    case "invalid_external":
      return "external Markdown destinations must be valid URI references";
    case "malformed_encoding":
      return "Markdown destinations must contain valid percent encoding";
    case "non_nfc":
      return "Markdown destinations must use NFC Unicode normalization";
    case "nonportable_component":
      return "Markdown destination path components must use portable names";
    case "query":
      return "local Markdown destinations must not contain query strings";
    case "too_large":
      return `Markdown destinations must not exceed ${MAX_SKILL_REFERENCE_DESTINATION_BYTES} bytes`;
    case "too_many_components":
      return `Markdown destinations must not exceed ${MAX_SKILL_REFERENCE_PATH_COMPONENTS} path components`;
    case "type":
      return "Markdown destinations must be strings";
    case "unsafe_scheme":
      return "Markdown destinations must not use unsafe URI schemes";
    case "unsafe_unicode":
      return "Markdown destinations must use unambiguous Unicode";
    case "windows_drive":
      return "Markdown destinations must not use Windows drive paths";
  }
}

function resolutionMessage(
  reason: Extract<MarkdownResourceGraphFinding, { kind: "resolution" }>["reason"],
): string {
  switch (reason) {
    case "missing":
      return "local Markdown destination does not exist";
    case "not_directory":
      return "a Markdown destination path component is not a directory";
    case "noncanonical":
      return "local Markdown destination must use exact canonical path spelling";
    case "ambiguous":
      return "local Markdown destination is ambiguous";
    case "not_file":
      return "local Markdown destination must resolve to a regular file";
  }
}

function readMessage(
  reason: Extract<MarkdownResourceGraphFinding, { kind: "read" }>["reason"],
): string {
  switch (reason) {
    case "too_large":
      return `referenced Markdown file exceeds ${MAX_SKILL_DOCUMENT_BYTES} bytes`;
    case "invalid_metadata":
      return "referenced Markdown file has invalid filesystem metadata";
    case "invalid_read":
      return "referenced Markdown file returned an invalid read result";
    case "invalid_utf8":
      return "referenced Markdown file must contain valid UTF-8";
    case "io":
      return "referenced Markdown file cannot be read safely";
  }
}

function budgetMessage(
  limit: Extract<MarkdownResourceGraphFinding, { kind: "budget" }>["limit"],
): string {
  switch (limit) {
    case "files":
      return `Markdown resource graph exceeds ${MAX_SKILL_MARKDOWN_GRAPH_FILES} Markdown files`;
    case "bytes":
      return `Markdown resource graph exceeds ${MAX_SKILL_MARKDOWN_GRAPH_BYTES} read bytes`;
    case "nodes":
      return `Markdown resource graph exceeds ${MAX_SKILL_MARKDOWN_GRAPH_NODES} analysis nodes`;
    case "targets":
      return `Markdown resource graph exceeds ${MAX_SKILL_MARKDOWN_GRAPH_TARGETS} links and images`;
    case "work":
      return `Markdown resource graph exceeds ${MAX_SKILL_MARKDOWN_GRAPH_WORK} work units`;
    case "components":
      return `Markdown resource graph exceeds ${MAX_SKILL_MARKDOWN_GRAPH_COMPONENTS} local path components`;
    case "alias_candidates":
      return `Markdown resource graph exceeds ${MAX_SKILL_MARKDOWN_GRAPH_ALIAS_CANDIDATES} alias candidates`;
  }
}

/** Add fixed diagnostics for a completed, bounded graph observation. */
export function addMarkdownResourceGraphFindingDiagnostics(
  diagnostics: DiagnosticCollector,
  graph: MarkdownResourceGraph,
): void {
  for (let index = 0; index < graph.findings.length; index += 1) {
    const finding = graph.findings[index] as MarkdownResourceGraphFinding;
    const at = ownLocation(finding);
    const location = {
      file: finding.file,
      ...(at === undefined ? {} : { line: at.line, column: at.column }),
    };
    switch (finding.kind) {
      case "markdown":
        add(diagnostics, finding.code, markdownMessage(finding.code), location);
        break;
      case "destination":
        add(
          diagnostics,
          `skill.reference.destination.${finding.reason}`,
          destinationMessage(finding.reason),
          location,
        );
        break;
      case "resolution":
        add(
          diagnostics,
          `skill.reference.${finding.reason}`,
          resolutionMessage(finding.reason),
          location,
        );
        break;
      case "read":
        add(
          diagnostics,
          `skill.reference.read.${finding.reason}`,
          readMessage(finding.reason),
          location,
        );
        break;
      case "budget":
        add(
          diagnostics,
          `skill.reference.budget.${finding.limit}`,
          budgetMessage(finding.limit),
          location,
        );
    }
  }
}

/** Add one stable diagnostic for a graph transaction that could not publish text. */
export function addMarkdownResourceGraphFailureDiagnostic(
  diagnostics: DiagnosticCollector,
  reason: MarkdownResourceGraphFailureReason,
): void {
  switch (reason) {
    case "too_large":
      add(
        diagnostics,
        "skill.document.too_large",
        `SKILL.md exceeds ${MAX_SKILL_DOCUMENT_BYTES} bytes`,
      );
      return;
    case "invalid_utf8":
      add(diagnostics, "skill.document.encoding", "SKILL.md must contain valid UTF-8");
      return;
    case "invalid_read":
      add(diagnostics, "skill.document.read", "SKILL.md returned an invalid read result");
      return;
    case "changed":
      add(
        diagnostics,
        "skill.root.changed",
        "skill directory changed while Markdown resources were being read",
        { file: "." },
      );
      return;
    case "unsupported_kind":
      add(
        diagnostics,
        "skill.resources.unsupported_kind",
        "skill resource tree must contain only regular files and directories",
        { file: "." },
      );
      return;
    case "too_many_entries":
      add(
        diagnostics,
        "skill.resources.too_many_entries",
        `skill resource tree exceeds ${MAX_RESOURCE_TREE_ENTRIES} entries`,
        { file: "." },
      );
      return;
    case "too_deep":
      add(
        diagnostics,
        "skill.resources.too_deep",
        `skill resource tree exceeds ${MAX_RESOURCE_TREE_DEPTH} levels`,
        { file: "." },
      );
      return;
    case "paths_too_large":
      add(
        diagnostics,
        "skill.resources.paths_too_large",
        `skill resource paths exceed ${MAX_RESOURCE_TREE_TOTAL_RELATIVE_PATH_BYTES} total bytes`,
        { file: "." },
      );
      return;
    case "invalid_input":
    case "aborted":
    case "invalid_inventory":
    case "invalid_metadata":
    case "inconsistent":
    case "io":
      add(diagnostics, "skill.resources.read", "skill resource tree cannot be validated safely", {
        file: ".",
      });
  }
}
