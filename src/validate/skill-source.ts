import type { DiagnosticCollector } from "./diagnostics.js";
import { MAX_SKILL_FRONTMATTER_BYTES } from "./types.js";

interface TextLine {
  readonly start: number;
  readonly next: number;
  readonly content: string;
}

export interface SkillDocumentEnvelope {
  readonly yaml: string;
  readonly body: string;
}

function lineAt(text: string, start: number): TextLine {
  let end = start;
  while (end < text.length && text[end] !== "\r" && text[end] !== "\n") end += 1;
  let next = end;
  if (text[end] === "\r" && text[end + 1] === "\n") next += 2;
  else if (text[end] === "\r" || text[end] === "\n") next += 1;
  return { start, next, content: text.slice(start, end) };
}

function addControlDiagnostics(text: string, diagnostics: DiagnosticCollector): boolean {
  let found = false;
  let line = 1;
  let column = 1;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    const forbidden =
      code <= 0x08 ||
      code === 0x0b ||
      code === 0x0c ||
      (code >= 0x0e && code <= 0x1f) ||
      (code >= 0x7f && code <= 0x9f);
    if (forbidden) {
      found = true;
      diagnostics.add(
        "skill.document.control_character",
        "error",
        "skillpress",
        "SKILL.md contains a forbidden control character",
        { line, column },
      );
    }
    if (code === 0x0a) {
      line += 1;
      column = 1;
    } else if (code === 0x0d && text.charCodeAt(index + 1) !== 0x0a) {
      line += 1;
      column = 1;
    } else column += 1;
  }
  return found;
}

export function parseSkillDocumentEnvelope(
  text: string,
  diagnostics: DiagnosticCollector,
): SkillDocumentEnvelope | undefined {
  if (text.charCodeAt(0) === 0xfeff) {
    diagnostics.add(
      "skill.document.encoding",
      "error",
      "skillpress",
      "SKILL.md must not begin with a Unicode byte-order mark",
      { line: 1, column: 1 },
    );
    return undefined;
  }
  if (addControlDiagnostics(text, diagnostics)) return undefined;
  const opening = lineAt(text, 0);
  if (opening.content !== "---") {
    diagnostics.add(
      "skill.frontmatter.missing",
      "error",
      "agent-skills",
      "SKILL.md must begin with a YAML frontmatter delimiter",
      { line: 1, column: 1 },
    );
    return undefined;
  }
  let closing: TextLine | undefined;
  for (let cursor = opening.next; cursor < text.length; ) {
    const line = lineAt(text, cursor);
    if (line.content === "---") {
      closing = line;
      break;
    }
    if (line.next === cursor) break;
    cursor = line.next;
  }
  if (closing === undefined) {
    diagnostics.add(
      "skill.frontmatter.unclosed",
      "error",
      "agent-skills",
      "YAML frontmatter must end with an exact --- delimiter",
      { line: 1, column: 1 },
    );
    return undefined;
  }
  const yaml = text.slice(opening.next, closing.start);
  if (Buffer.byteLength(yaml, "utf8") > MAX_SKILL_FRONTMATTER_BYTES) {
    diagnostics.add(
      "skill.frontmatter.too_large",
      "error",
      "skillpress",
      `YAML frontmatter exceeds ${MAX_SKILL_FRONTMATTER_BYTES} bytes`,
      { line: 2, column: 1 },
    );
    return undefined;
  }
  return { yaml, body: text.slice(closing.next) };
}
