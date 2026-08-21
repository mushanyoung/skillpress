import { describe, expect, it } from "vitest";

import { DiagnosticCollector } from "../src/validate/diagnostics.js";
import type { MarkdownAnalysisIssue } from "../src/validate/markdown-analysis.js";
import type { MarkdownDestinationIssue } from "../src/validate/markdown-destination.js";
import type {
  BundledResourceNameFinding,
  MarkdownResourceGraph,
  MarkdownResourceGraphFailureReason,
  MarkdownResourceGraphFinding,
  MarkdownResourcePlaceholderFinding,
} from "../src/validate/markdown-resource-graph.js";
import {
  addBundledResourceNameFindingDiagnostics,
  addMarkdownResourceGraphFailureDiagnostic,
  addMarkdownResourceGraphFindingDiagnostics,
  addMarkdownResourcePlaceholderFindingDiagnostics,
} from "../src/validate/markdown-resource-diagnostics.js";

const SOURCE = "references/source.md";
const LOCATION = { line: 7, column: 9 } as const;

function graph(finding: MarkdownResourceGraphFinding): MarkdownResourceGraph {
  return {
    surface: "commonmark-links-images-v1",
    complete: false,
    documents: [],
    edges: [],
    reachableFiles: ["SKILL.md"],
    findings: [finding],
    totals: {
      files: 0,
      bytes: 0,
      nodes: 0,
      targets: 0,
      work: 0,
      components: 0,
      aliasCandidates: 0,
    },
  };
}

function mapped(finding: MarkdownResourceGraphFinding) {
  const diagnostics = new DiagnosticCollector();
  addMarkdownResourceGraphFindingDiagnostics(diagnostics, graph(finding));
  return diagnostics.finish().diagnostics;
}

function mappedResource(finding: BundledResourceNameFinding) {
  const diagnostics = new DiagnosticCollector();
  addBundledResourceNameFindingDiagnostics(diagnostics, [finding]);
  return diagnostics.finish().diagnostics;
}

function mappedPlaceholder(...findings: readonly MarkdownResourcePlaceholderFinding[]) {
  const diagnostics = new DiagnosticCollector();
  addMarkdownResourcePlaceholderFindingDiagnostics(diagnostics, findings);
  return diagnostics.finish().diagnostics;
}

function expected(code: string, message: string) {
  return [
    {
      code,
      severity: "error",
      scope: "skillpress",
      file: SOURCE,
      message,
      line: LOCATION.line,
      column: LOCATION.column,
    },
  ];
}

describe("Markdown resource diagnostics", () => {
  it.each([
    [
      "environment_file",
      "skill.resources.environment_file",
      "skill resource tree must not contain environment files",
    ],
    [
      "credential_file",
      "skill.resources.credential_file",
      "skill resource tree must not contain credential-like files",
    ],
  ] as const)("maps bundled resource finding %s", (kind, code, message) => {
    expect(mappedResource({ kind, file: SOURCE })).toEqual([
      { code, severity: "error", scope: "skillpress", file: SOURCE, message },
    ]);
  });

  it("maps placeholder observations to one fixed raw-free diagnostic", () => {
    const finding = {
      file: SOURCE,
      location: LOCATION,
    } as const;
    const diagnostic = expected(
      "skill.markdown.placeholder",
      "Markdown visible text must not contain placeholders",
    );
    const diagnostics = mappedPlaceholder(finding, finding);
    expect(diagnostics).toEqual([...diagnostic, ...diagnostic]);
    expect(JSON.stringify(diagnostics)).not.toContain("TODO");
  });

  it.each([
    ["skill.markdown.complexity", "Markdown exceeds the supported analysis complexity"],
    ["skill.markdown.duplicate_definition", "Markdown reference definitions must be unique"],
    ["skill.markdown.parse", "Markdown could not be parsed safely"],
    [
      "skill.markdown.too_many_definitions",
      "Markdown contains more than 1024 reference definitions",
    ],
    ["skill.markdown.too_large", "Markdown exceeds 524288 bytes"],
    ["skill.markdown.too_many_targets", "Markdown contains more than 1024 links and images"],
  ] as const)("maps Markdown finding %s", (code, message) => {
    expect(mapped({ kind: "markdown", code, file: SOURCE, location: LOCATION })).toEqual(
      expected(code, message),
    );
  });

  it.each([
    ["absolute_path", "Markdown destinations must not use absolute paths"],
    ["ambiguous_encoding", "Markdown destinations must not use ambiguous percent encoding"],
    ["backslash", "Markdown destinations must use forward slashes"],
    ["component_too_large", "Markdown destination path components must not exceed 255 bytes"],
    ["dot_component", "Markdown destinations must not contain dot path components"],
    ["empty_component", "Markdown destinations must not contain empty path components"],
    ["encoded_delimiter", "Markdown destinations must not percent-encode URI delimiters"],
    ["encoded_separator", "Markdown destinations must not percent-encode path separators"],
    ["invalid_external", "external Markdown destinations must be valid URI references"],
    ["malformed_encoding", "Markdown destinations must contain valid percent encoding"],
    ["non_nfc", "Markdown destinations must use NFC Unicode normalization"],
    ["nonportable_component", "Markdown destination path components must use portable names"],
    ["query", "local Markdown destinations must not contain query strings"],
    ["too_large", "Markdown destinations must not exceed 4096 bytes"],
    ["too_many_components", "Markdown destinations must not exceed 64 path components"],
    ["type", "Markdown destinations must be strings"],
    ["unsafe_scheme", "Markdown destinations must not use unsafe URI schemes"],
    ["unsafe_unicode", "Markdown destinations must use unambiguous Unicode"],
    ["windows_drive", "Markdown destinations must not use Windows drive paths"],
  ] as const satisfies readonly (readonly [MarkdownDestinationIssue, string])[])(
    "maps destination finding %s",
    (reason, message) => {
      expect(mapped({ kind: "destination", reason, file: SOURCE, location: LOCATION })).toEqual(
        expected(`skill.reference.destination.${reason}`, message),
      );
    },
  );

  it.each([
    ["missing", "local Markdown destination does not exist"],
    ["not_directory", "a Markdown destination path component is not a directory"],
    ["noncanonical", "local Markdown destination must use exact canonical path spelling"],
    ["ambiguous", "local Markdown destination is ambiguous"],
    ["not_file", "local Markdown destination must resolve to a regular file"],
  ] as const)("maps resolution finding %s", (reason, message) => {
    const extra =
      reason === "noncanonical"
        ? { componentIndex: 0, match: "fold" as const, exact: "secret-exact.md" }
        : reason === "ambiguous"
          ? {
              componentIndex: 0,
              match: "fold" as const,
              exacts: ["secret-a.md", "secret-b.md"],
            }
          : reason === "not_file"
            ? {}
            : { componentIndex: 0 };
    const finding = {
      kind: "resolution",
      reason,
      file: SOURCE,
      target: "secret-target.md",
      location: LOCATION,
      ...extra,
    } as MarkdownResourceGraphFinding;
    const diagnostics = mapped(finding);
    expect(diagnostics).toEqual(expected(`skill.reference.${reason}`, message));
    expect(JSON.stringify(diagnostics)).not.toContain("secret-");
  });

  it.each([
    ["too_large", "referenced Markdown file exceeds 524288 bytes"],
    ["invalid_metadata", "referenced Markdown file has invalid filesystem metadata"],
    ["invalid_read", "referenced Markdown file returned an invalid read result"],
    ["invalid_utf8", "referenced Markdown file must contain valid UTF-8"],
    ["io", "referenced Markdown file cannot be read safely"],
  ] as const)("maps referenced-file read finding %s", (reason, message) => {
    const finding = {
      kind: "read",
      reason,
      file: SOURCE,
      target: "secret-target.md",
      location: LOCATION,
    } as const;
    const diagnostics = mapped(finding);
    expect(diagnostics).toEqual(expected(`skill.reference.read.${reason}`, message));
    expect(JSON.stringify(diagnostics)).not.toContain("secret-target");
  });

  it.each([
    ["files", "Markdown resource graph exceeds 256 Markdown files"],
    ["bytes", "Markdown resource graph exceeds 8388608 read bytes"],
    ["nodes", "Markdown resource graph exceeds 100000 analysis nodes"],
    ["targets", "Markdown resource graph exceeds 4096 links and images"],
    ["work", "Markdown resource graph exceeds 131072 work units"],
    ["components", "Markdown resource graph exceeds 8192 local path components"],
    ["alias_candidates", "Markdown resource graph exceeds 8192 alias candidates"],
  ] as const)("maps graph budget finding %s", (limit, message) => {
    expect(mapped({ kind: "budget", limit, file: SOURCE, location: LOCATION })).toEqual(
      expected(`skill.reference.budget.${limit}`, message),
    );
  });

  it("omits a missing Markdown location instead of inventing one", () => {
    const code: MarkdownAnalysisIssue["code"] = "skill.markdown.parse";
    const descriptor = Object.getOwnPropertyDescriptor(Object.prototype, "location");
    let inheritedReads = 0;
    let diagnostics: ReturnType<typeof mapped> | undefined;
    try {
      Object.defineProperty(Object.prototype, "location", {
        configurable: true,
        get() {
          inheritedReads += 1;
          throw new Error("inherited location was read");
        },
      });
      diagnostics = mapped({ kind: "markdown", code, file: SOURCE });
    } finally {
      if (descriptor === undefined) Reflect.deleteProperty(Object.prototype, "location");
      else Object.defineProperty(Object.prototype, "location", descriptor);
    }
    expect(inheritedReads).toBe(0);
    expect(diagnostics).toEqual([
      {
        code,
        severity: "error",
        scope: "skillpress",
        file: SOURCE,
        message: "Markdown could not be parsed safely",
      },
    ]);
  });

  it.each([
    [
      "invalid_input",
      "skill.resources.read",
      "skill resource tree cannot be validated safely",
      ".",
    ],
    ["aborted", "skill.resources.read", "skill resource tree cannot be validated safely", "."],
    [
      "changed",
      "skill.root.changed",
      "skill directory changed while Markdown resources were being read",
      ".",
    ],
    [
      "invalid_inventory",
      "skill.resources.read",
      "skill resource tree cannot be validated safely",
      ".",
    ],
    [
      "invalid_metadata",
      "skill.resources.read",
      "skill resource tree cannot be validated safely",
      ".",
    ],
    [
      "unsupported_kind",
      "skill.resources.unsupported_kind",
      "skill resource tree must contain only regular files and directories",
      ".",
    ],
    [
      "too_many_entries",
      "skill.resources.too_many_entries",
      "skill resource tree exceeds 8192 entries",
      ".",
    ],
    ["too_deep", "skill.resources.too_deep", "skill resource tree exceeds 64 levels", "."],
    [
      "paths_too_large",
      "skill.resources.paths_too_large",
      "skill resource paths exceed 8388608 total bytes",
      ".",
    ],
    ["too_large", "skill.document.too_large", "SKILL.md exceeds 524288 bytes", "SKILL.md"],
    ["invalid_read", "skill.document.read", "SKILL.md returned an invalid read result", "SKILL.md"],
    ["invalid_utf8", "skill.document.encoding", "SKILL.md must contain valid UTF-8", "SKILL.md"],
    ["inconsistent", "skill.resources.read", "skill resource tree cannot be validated safely", "."],
    ["io", "skill.resources.read", "skill resource tree cannot be validated safely", "."],
  ] as const satisfies readonly (readonly [
    MarkdownResourceGraphFailureReason,
    string,
    string,
    string,
  ])[])("maps graph transaction failure %s", (reason, code, message, file) => {
    const diagnostics = new DiagnosticCollector();
    addMarkdownResourceGraphFailureDiagnostic(diagnostics, reason);
    expect(diagnostics.finish().diagnostics).toEqual([
      { code, severity: "error", scope: "skillpress", file, message },
    ]);
  });
});
