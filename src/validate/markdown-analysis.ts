import type {
  Definition,
  Heading,
  Image,
  ImageReference,
  Link,
  LinkReference,
  Nodes,
  Root,
} from "mdast";
import { fromMarkdown } from "mdast-util-from-markdown";

export const MAX_SKILL_MARKDOWN_AST_NODES = 20_000;
export const MAX_SKILL_MARKDOWN_DEFINITIONS_PER_FILE = 1_024;
export const MAX_SKILL_MARKDOWN_TARGETS_PER_FILE = 1_024;
export const MAX_SKILL_MARKDOWN_SOURCE_BYTES = 512 * 1024;
export const MAX_SKILL_MARKDOWN_SYNTAX_MARKERS = 8_192;

const COMMONMARK_SYNTAX_MARKER = /[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~]/u;

export interface MarkdownLocation {
  readonly line: number;
  readonly column: number;
}

export interface MarkdownTarget {
  readonly kind: "link" | "image";
  readonly form: "inline" | "reference";
  readonly url: string;
  readonly location: MarkdownLocation;
  readonly destinationLocation: MarkdownLocation;
  readonly referenceType?: "collapsed" | "full" | "shortcut";
  readonly definition?: MarkdownDefinition;
}

export interface MarkdownHeading {
  readonly depth: 1 | 2 | 3 | 4 | 5 | 6;
  readonly text: string;
  readonly location: MarkdownLocation;
}

export interface MarkdownDefinition {
  readonly identifier: string;
  readonly url: string;
  readonly location: MarkdownLocation;
}

export interface MarkdownAnalysisIssue {
  readonly code:
    | "skill.markdown.complexity"
    | "skill.markdown.duplicate_definition"
    | "skill.markdown.parse"
    | "skill.markdown.too_many_definitions"
    | "skill.markdown.too_large"
    | "skill.markdown.too_many_targets";
  readonly message: string;
  readonly location?: MarkdownLocation;
}

export interface MarkdownAnalysis {
  readonly nodeCount: number;
  readonly lineCount: number;
  readonly targets: readonly MarkdownTarget[];
  readonly headings: readonly MarkdownHeading[];
  readonly definitions: readonly MarkdownDefinition[];
  readonly unusedDefinitions: readonly MarkdownDefinition[];
  readonly issues: readonly MarkdownAnalysisIssue[];
}

interface PendingTarget {
  readonly node: Link | Image | LinkReference | ImageReference;
  readonly kind: "link" | "image";
  readonly url?: string;
  readonly identifier?: string;
}

type ParseMarkdown = (source: string) => Root;

function at(node: Nodes): MarkdownLocation {
  return {
    line: node.position?.start.line ?? 1,
    column: node.position?.start.column ?? 1,
  };
}

function lineCount(value: string): number {
  if (value.length === 0) return 0;
  let lines = 1;
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] === "\n") lines += 1;
    else if (value[index] === "\r") {
      lines += 1;
      if (value[index + 1] === "\n") index += 1;
    }
  }
  return lines;
}

function exceedsSyntaxBudget(source: string): boolean {
  let markers = 0;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index] as string;
    if (character === "\n") markers += 1;
    else if (character === "\r") {
      markers += 1;
      if (source[index + 1] === "\n") index += 1;
    } else if (COMMONMARK_SYNTAX_MARKER.test(character)) markers += 1;
    if (markers > MAX_SKILL_MARKDOWN_SYNTAX_MARKERS) return true;
  }
  return false;
}

function children(node: Nodes): readonly Nodes[] {
  return "children" in node ? (node.children as readonly Nodes[]) : [];
}

function headingText(heading: Heading): string {
  const text: string[] = [];
  const stack = [...children(heading)].reverse();
  while (stack.length > 0) {
    const node = stack.pop() as Nodes;
    if ((node.type === "text" || node.type === "inlineCode") && "value" in node) {
      text.push(node.value as string);
      continue;
    }
    if (node.type === "image" || node.type === "imageReference") {
      text.push((node as Image | ImageReference).alt ?? "");
      continue;
    }
    if (node.type === "html") continue;
    if (node.type === "break") {
      text.push(" ");
      continue;
    }
    const nested = children(node);
    for (let index = nested.length - 1; index >= 0; index -= 1) {
      stack.push(nested[index] as Nodes);
    }
  }
  return text.join("");
}

function inlineTarget(kind: "link" | "image", url: string, node: Nodes): MarkdownTarget {
  const location = Object.freeze(at(node));
  return Object.freeze({
    kind,
    form: "inline",
    url,
    location,
    destinationLocation: location,
  });
}

function referenceTarget(pending: PendingTarget, found: MarkdownDefinition): MarkdownTarget {
  const reference = pending.node as LinkReference | ImageReference;
  return Object.freeze({
    kind: pending.kind,
    form: "reference",
    url: found.url,
    location: Object.freeze(at(pending.node)),
    destinationLocation: found.location,
    referenceType: reference.referenceType,
    definition: found,
  });
}

function definition(node: Definition): MarkdownDefinition {
  return Object.freeze({
    identifier: node.identifier,
    url: node.url,
    location: Object.freeze(at(node)),
  });
}

function issue(
  code: MarkdownAnalysisIssue["code"],
  message: string,
  location?: MarkdownLocation,
): MarkdownAnalysisIssue {
  return Object.freeze({
    code,
    message,
    ...(location === undefined ? {} : { location: Object.freeze(location) }),
  });
}

function result(
  source: string,
  targets: readonly MarkdownTarget[],
  headings: readonly MarkdownHeading[],
  definitions: readonly MarkdownDefinition[],
  unusedDefinitions: readonly MarkdownDefinition[],
  issues: readonly MarkdownAnalysisIssue[],
  countSourceLines = true,
  nodeCount = 0,
): MarkdownAnalysis {
  return Object.freeze({
    nodeCount,
    lineCount: countSourceLines ? lineCount(source) : 0,
    targets: Object.freeze([...targets]),
    headings: Object.freeze([...headings]),
    definitions: Object.freeze([...definitions]),
    unusedDefinitions: Object.freeze([...unusedDefinitions]),
    issues: Object.freeze([...issues]),
  });
}

/** Parse CommonMark into a bounded inert summary. No target is opened or fetched. */
export function analyzeMarkdown(
  source: string,
  parseMarkdown: ParseMarkdown = fromMarkdown,
): MarkdownAnalysis {
  if (
    source.length > MAX_SKILL_MARKDOWN_SOURCE_BYTES ||
    Buffer.byteLength(source, "utf8") > MAX_SKILL_MARKDOWN_SOURCE_BYTES
  ) {
    return result(
      source,
      [],
      [],
      [],
      [],
      [
        issue(
          "skill.markdown.too_large",
          `Markdown exceeds ${MAX_SKILL_MARKDOWN_SOURCE_BYTES} bytes`,
        ),
      ],
      false,
    );
  }
  if (exceedsSyntaxBudget(source)) {
    return result(
      source,
      [],
      [],
      [],
      [],
      [
        issue(
          "skill.markdown.complexity",
          `Markdown syntax exceeds ${MAX_SKILL_MARKDOWN_SYNTAX_MARKERS} markers`,
        ),
      ],
    );
  }
  let root: Nodes;
  try {
    root = parseMarkdown(source);
  } catch {
    return result(
      source,
      [],
      [],
      [],
      [],
      [issue("skill.markdown.parse", "Markdown could not be parsed safely")],
    );
  }

  const definitions = new Map<string, MarkdownDefinition>();
  const duplicateDefinitions: MarkdownAnalysisIssue[] = [];
  const pendingTargets: PendingTarget[] = [];
  const headings: MarkdownHeading[] = [];
  const stack: Nodes[] = [root];
  let nodes = 0;
  let definitionNodes = 0;
  while (stack.length > 0) {
    const node = stack.pop() as Nodes;
    nodes += 1;
    if (nodes > MAX_SKILL_MARKDOWN_AST_NODES) {
      return result(
        source,
        [],
        [],
        [],
        [],
        [
          issue(
            "skill.markdown.complexity",
            `Markdown node count exceeds ${MAX_SKILL_MARKDOWN_AST_NODES}`,
            at(node),
          ),
        ],
      );
    }
    if (node.type === "definition") {
      definitionNodes += 1;
      if (definitionNodes > MAX_SKILL_MARKDOWN_DEFINITIONS_PER_FILE) {
        return result(
          source,
          [],
          [],
          [],
          [],
          [
            issue(
              "skill.markdown.too_many_definitions",
              `Markdown contains more than ${MAX_SKILL_MARKDOWN_DEFINITIONS_PER_FILE} reference definitions`,
              at(node),
            ),
          ],
        );
      }
      const item = definition(node);
      if (definitions.has(node.identifier)) {
        duplicateDefinitions.push(
          issue(
            "skill.markdown.duplicate_definition",
            "Markdown reference definitions must be unique",
            at(node),
          ),
        );
      } else definitions.set(node.identifier, item);
    } else if (node.type === "link" || node.type === "image") {
      const resource = node as Link | Image;
      pendingTargets.push({ kind: node.type, node: resource, url: resource.url });
    } else if (node.type === "linkReference" || node.type === "imageReference") {
      const reference = node as LinkReference | ImageReference;
      pendingTargets.push({
        node: reference,
        kind: node.type === "linkReference" ? "link" : "image",
        identifier: reference.identifier,
      });
    } else if (node.type === "heading") {
      const heading = node as Heading;
      headings.push(
        Object.freeze({
          depth: heading.depth,
          text: headingText(heading),
          location: Object.freeze(at(heading)),
        }),
      );
    }
    if (pendingTargets.length > MAX_SKILL_MARKDOWN_TARGETS_PER_FILE) {
      return result(
        source,
        [],
        [],
        [],
        [],
        [
          issue(
            "skill.markdown.too_many_targets",
            `Markdown contains more than ${MAX_SKILL_MARKDOWN_TARGETS_PER_FILE} links and images`,
            at(node),
          ),
        ],
      );
    }
    const nested = children(node);
    for (let index = nested.length - 1; index >= 0; index -= 1) {
      stack.push(nested[index] as Nodes);
    }
  }

  const usedDefinitions = new Set<string>();
  const targets: MarkdownTarget[] = [];
  for (const pending of pendingTargets) {
    if (pending.url !== undefined) {
      targets.push(inlineTarget(pending.kind, pending.url, pending.node));
      continue;
    }
    const identifier = pending.identifier as string;
    const found = definitions.get(identifier);
    if (found === undefined) continue;
    usedDefinitions.add(identifier);
    targets.push(referenceTarget(pending, found));
  }
  const definitionList = [...definitions.values()];
  const unusedDefinitions = definitionList.filter((item) => !usedDefinitions.has(item.identifier));
  return result(
    source,
    targets,
    headings,
    definitionList,
    unusedDefinitions,
    duplicateDefinitions,
    true,
    nodes,
  );
}
