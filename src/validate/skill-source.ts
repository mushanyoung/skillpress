import { Buffer } from "node:buffer";

import type { DiagnosticCollector } from "./diagnostics.js";
import { MAX_SKILL_FRONTMATTER_BYTES } from "./types.js";

interface TextLine {
  readonly start: number;
  readonly end: number;
  readonly next: number;
}

interface ControlLocation {
  readonly line: number;
  readonly column: number;
}

export interface SkillDocumentEnvelope {
  readonly yaml: string;
  readonly body: string;
  /** One-based source line containing the first body character. */
  readonly bodyStartLine: number;
  /** UTF-16 code-unit offset into the original document string. */
  readonly bodyStartOffset: number;
}

export type SkillDocumentEnvelopeProjectionFailureReason =
  | "invalid_input"
  | "byte_order_mark"
  | "control_character"
  | "missing_frontmatter"
  | "unclosed_frontmatter"
  | "frontmatter_too_large";

export type SkillDocumentEnvelopeProjectionResult =
  | Readonly<{ ok: true; envelope: SkillDocumentEnvelope }>
  | Readonly<{ ok: false; reason: SkillDocumentEnvelopeProjectionFailureReason }>;

type ScanFailureReason = Exclude<SkillDocumentEnvelopeProjectionFailureReason, "invalid_input">;
type ScanResult =
  | Readonly<{ ok: true; envelope: SkillDocumentEnvelope }>
  | Readonly<{
      ok: false;
      reason: ScanFailureReason;
      controls?: readonly ControlLocation[];
    }>;

// Module initialization is the trust boundary for the lexical intrinsics below.
const applySnapshot = Reflect.apply;
const bufferByteLengthSnapshot = Buffer.byteLength;
const bufferConstructorSnapshot = Buffer;
const objectConstructorSnapshot = Object;
const definePropertySnapshot = objectConstructorSnapshot.defineProperty;
const freezeSnapshot = objectConstructorSnapshot.freeze;
const charCodeAtSnapshot = String.prototype.charCodeAt;
const sliceSnapshot = String.prototype.slice;

type Intrinsic = (...args: never[]) => unknown;
function applyIntrinsic<T>(intrinsic: Intrinsic, receiver: unknown, args: unknown[]): T {
  return applySnapshot(intrinsic, receiver, args) as T;
}

function freeze<T extends object>(value: T): Readonly<T> {
  return applyIntrinsic<Readonly<T>>(freezeSnapshot, objectConstructorSnapshot, [value]);
}

function append<T>(values: T[], value: T): void {
  applyIntrinsic(definePropertySnapshot, objectConstructorSnapshot, [
    values,
    values.length,
    { configurable: true, enumerable: true, value, writable: true },
  ]);
}

function charCodeAt(text: string, index: number): number {
  return applyIntrinsic<number>(charCodeAtSnapshot, text, [index]);
}

function slice(text: string, start: number, end?: number): string {
  return applyIntrinsic<string>(sliceSnapshot, text, end === undefined ? [start] : [start, end]);
}

function byteLength(text: string): number {
  return applyIntrinsic<number>(bufferByteLengthSnapshot, bufferConstructorSnapshot, [
    text,
    "utf8",
  ]);
}

function lineAt(text: string, start: number): TextLine {
  let end = start;
  while (end < text.length) {
    const code = charCodeAt(text, end);
    if (code === 0x0d || code === 0x0a) break;
    end += 1;
  }
  let next = end;
  if (charCodeAt(text, end) === 0x0d && charCodeAt(text, end + 1) === 0x0a) next += 2;
  else if (charCodeAt(text, end) === 0x0d || charCodeAt(text, end) === 0x0a) next += 1;
  return freeze({ start, end, next });
}

function isDelimiter(text: string, line: TextLine): boolean {
  return (
    line.end - line.start === 3 &&
    charCodeAt(text, line.start) === 0x2d &&
    charCodeAt(text, line.start + 1) === 0x2d &&
    charCodeAt(text, line.start + 2) === 0x2d
  );
}

function controlLocations(text: string): readonly ControlLocation[] {
  const controls: ControlLocation[] = [];
  let line = 1;
  let column = 1;
  for (let index = 0; index < text.length; index += 1) {
    const code = charCodeAt(text, index);
    const forbidden =
      code <= 0x08 ||
      code === 0x0b ||
      code === 0x0c ||
      (code >= 0x0e && code <= 0x1f) ||
      (code >= 0x7f && code <= 0x9f);
    if (forbidden && controls.length < 256) append(controls, freeze({ line, column }));
    if (code === 0x0a) {
      line += 1;
      column = 1;
    } else if (code === 0x0d && charCodeAt(text, index + 1) !== 0x0a) {
      line += 1;
      column = 1;
    } else column += 1;
  }
  return freeze(controls);
}

const BYTE_ORDER_MARK_SCAN = freeze({ ok: false, reason: "byte_order_mark" } as const);
const MISSING_FRONTMATTER_SCAN = freeze({
  ok: false,
  reason: "missing_frontmatter",
} as const);
const UNCLOSED_FRONTMATTER_SCAN = freeze({
  ok: false,
  reason: "unclosed_frontmatter",
} as const);
const FRONTMATTER_TOO_LARGE_SCAN = freeze({
  ok: false,
  reason: "frontmatter_too_large",
} as const);

function scanSkillDocumentEnvelope(text: string): ScanResult {
  if (charCodeAt(text, 0) === 0xfeff) return BYTE_ORDER_MARK_SCAN;
  const controls = controlLocations(text);
  if (controls.length > 0) {
    return freeze({ ok: false, reason: "control_character", controls } as const);
  }
  const opening = lineAt(text, 0);
  if (!isDelimiter(text, opening)) return MISSING_FRONTMATTER_SCAN;
  let closing: TextLine | undefined;
  let closingLine = 2;
  for (let cursor = opening.next; cursor < text.length; ) {
    const line = lineAt(text, cursor);
    if (isDelimiter(text, line)) {
      closing = line;
      break;
    }
    if (line.next === cursor) break;
    cursor = line.next;
    closingLine += 1;
  }
  if (closing === undefined) return UNCLOSED_FRONTMATTER_SCAN;
  const yaml = slice(text, opening.next, closing.start);
  if (byteLength(yaml) > MAX_SKILL_FRONTMATTER_BYTES) return FRONTMATTER_TOO_LARGE_SCAN;
  const envelope = freeze({
    yaml,
    body: slice(text, closing.next),
    bodyStartLine: closingLine + 1,
    bodyStartOffset: closing.next,
  });
  return freeze({ ok: true, envelope } as const);
}

const INVALID_INPUT = freeze({ ok: false, reason: "invalid_input" } as const);
const PROJECTION_FAILURES = freeze({
  byte_order_mark: freeze({ ok: false, reason: "byte_order_mark" } as const),
  control_character: freeze({ ok: false, reason: "control_character" } as const),
  missing_frontmatter: freeze({ ok: false, reason: "missing_frontmatter" } as const),
  unclosed_frontmatter: freeze({ ok: false, reason: "unclosed_frontmatter" } as const),
  frontmatter_too_large: freeze({ ok: false, reason: "frontmatter_too_large" } as const),
});

/** Project one inert document into its lexical envelope; this grants no authority. */
export function projectSkillDocumentEnvelope(
  value: unknown,
): SkillDocumentEnvelopeProjectionResult {
  if (typeof value !== "string") return INVALID_INPUT;
  const scanned = scanSkillDocumentEnvelope(value);
  return scanned.ok
    ? freeze({ ok: true, envelope: scanned.envelope } as const)
    : PROJECTION_FAILURES[scanned.reason];
}

export function parseSkillDocumentEnvelope(
  text: string,
  diagnostics: DiagnosticCollector,
): SkillDocumentEnvelope | undefined {
  const scanned = scanSkillDocumentEnvelope(text);
  if (scanned.ok) return scanned.envelope;
  switch (scanned.reason) {
    case "byte_order_mark":
      diagnostics.add(
        "skill.document.encoding",
        "error",
        "skillpress",
        "SKILL.md must not begin with a Unicode byte-order mark",
        { line: 1, column: 1 },
      );
      break;
    case "control_character":
      for (let index = 0; index < (scanned.controls?.length ?? 0); index += 1) {
        diagnostics.add(
          "skill.document.control_character",
          "error",
          "skillpress",
          "SKILL.md contains a forbidden control character",
          scanned.controls?.[index],
        );
      }
      break;
    case "missing_frontmatter":
      diagnostics.add(
        "skill.frontmatter.missing",
        "error",
        "agent-skills",
        "SKILL.md must begin with a YAML frontmatter delimiter",
        { line: 1, column: 1 },
      );
      break;
    case "unclosed_frontmatter":
      diagnostics.add(
        "skill.frontmatter.unclosed",
        "error",
        "agent-skills",
        "YAML frontmatter must end with an exact --- delimiter",
        { line: 1, column: 1 },
      );
      break;
    case "frontmatter_too_large":
      diagnostics.add(
        "skill.frontmatter.too_large",
        "error",
        "skillpress",
        `YAML frontmatter exceeds ${MAX_SKILL_FRONTMATTER_BYTES} bytes`,
        { line: 2, column: 1 },
      );
  }
  return undefined;
}
