export const MAX_SEMANTIC_TEXT_CODE_UNITS = 512 * 1024;

export type SemanticTextPlaceholderFailureReason = "invalid_input" | "too_large" | "placeholder";
export type SemanticTextPlaceholderClassification =
  | Readonly<{ ok: true }>
  | Readonly<{ ok: false; reason: SemanticTextPlaceholderFailureReason }>;

// Module initialization is the trust boundary for intrinsics and tables below.
const applySnapshot = Reflect.apply;
const freezeSnapshot = Object.freeze;
const charCodeAtSnapshot = String.prototype.charCodeAt;
const sliceSnapshot = String.prototype.slice;
const trimSnapshot = String.prototype.trim;
const weakSetAddSnapshot = WeakSet.prototype.add;
const weakSetHasSnapshot = WeakSet.prototype.has;
const resultProvenance = new WeakSet<object>();

function register<T extends SemanticTextPlaceholderClassification>(value: T): T {
  const frozen = freezeSnapshot(value);
  applySnapshot(weakSetAddSnapshot, resultProvenance, [frozen]);
  return frozen;
}
const SAFE = register({ ok: true } as const);
const INVALID_INPUT = register({ ok: false, reason: "invalid_input" } as const);
const TOO_LARGE = register({ ok: false, reason: "too_large" } as const);
const PLACEHOLDER = register({ ok: false, reason: "placeholder" } as const);

const directives = freezeSnapshot([
  "todo",
  "tbd",
  "fixme",
  "changeme",
  "placeholder",
  "replace me",
  "fill me",
] as const);
const markerWords = freezeSnapshot(["todo", "tbd", "fixme", "changeme", "placeholder"] as const);
const uppercaseWords = freezeSnapshot(["TODO", "TBD", "FIXME", "CHANGEME"] as const);
const commands = freezeSnapshot(["insert", "describe", "enter"] as const);
const targets = freezeSnapshot(["me", "this"] as const);
const fields = freezeSnapshot([
  "name",
  "title",
  "description",
  "summary",
  "text",
  "value",
  "details",
  "content",
  "email",
  "url",
  "path",
  "command",
] as const);

function codeUnitAt(value: string, index: number): number {
  return applySnapshot(charCodeAtSnapshot, value, [index]) as number;
}
function isWhitespace(codeUnit: number): boolean {
  return (
    (codeUnit >= 0x09 && codeUnit <= 0x0d) ||
    codeUnit === 0x20 ||
    codeUnit === 0xa0 ||
    codeUnit === 0x1680 ||
    (codeUnit >= 0x2000 && codeUnit <= 0x200a) ||
    codeUnit === 0x2028 ||
    codeUnit === 0x2029 ||
    codeUnit === 0x202f ||
    codeUnit === 0x205f ||
    codeUnit === 0x3000 ||
    codeUnit === 0xfeff
  );
}
function simpleFold(codeUnit: number): number {
  if (codeUnit >= 0x41 && codeUnit <= 0x5a) return codeUnit + 0x20;
  if (codeUnit === 0x17f) return 0x73;
  return codeUnit;
}
function wordEnd(value: string, start: number, word: string, folded = true): number {
  if (start < 0 || start + word.length > value.length) return -1;
  for (let index = 0; index < word.length; index += 1) {
    const observed = codeUnitAt(value, start + index);
    const expected = codeUnitAt(word, index);
    if ((folded ? simpleFold(observed) : observed) !== expected) return -1;
  }
  return start + word.length;
}
function firstWordEnd(
  value: string,
  start: number,
  words: readonly string[],
  folded = true,
): number {
  for (let index = 0; index < words.length; index += 1) {
    const end = wordEnd(value, start, words[index] as string, folded);
    if (end >= 0) return end;
  }
  return -1;
}
function skipWhitespace(value: string, start: number, end: number): number {
  let index = start;
  while (index >= 0 && index < end && isWhitespace(codeUnitAt(value, index))) index += 1;
  return index;
}
function dotRemainder(value: string, start: number): boolean {
  for (let index = start; index < value.length; index += 1) {
    const codeUnit = codeUnitAt(value, index);
    // The outer scanner has already removed CR and LF from this logical line.
    if (codeUnit === 0x2028 || codeUnit === 0x2029) return false;
  }
  return true;
}
function bracketSuffixMatches(value: string, start: number): boolean {
  return (
    start === value.length ||
    (isWhitespace(codeUnitAt(value, start)) && dotRemainder(value, start + 1))
  );
}
function optionalDetailMatches(value: string, start: number, close: number): boolean {
  return (
    start === close || (start >= 0 && isWhitespace(codeUnitAt(value, start)) && close - start >= 2)
  );
}

function directiveMatches(value: string): boolean {
  const end = firstWordEnd(value, 0, directives);
  if (end < 0) return false;
  if (end === value.length) return true;
  const afterWhitespace = skipWhitespace(value, end, value.length);
  if (codeUnitAt(value, afterWhitespace) === 0x3a) return dotRemainder(value, afterWhitespace + 1);
  if (afterWhitespace > end) {
    const separator = codeUnitAt(value, afterWhitespace);
    if (separator === 0x2d || separator === 0x2014) {
      const tail = afterWhitespace + 1;
      if (tail === value.length) return true;
      const content = skipWhitespace(value, tail, value.length);
      if (content > tail && dotRemainder(value, content)) return true;
    }
  }
  const uppercaseEnd = firstWordEnd(value, 0, uppercaseWords, false);
  const suffix = skipWhitespace(value, uppercaseEnd, value.length);
  return uppercaseEnd >= 0 && suffix > uppercaseEnd && dotRemainder(value, suffix);
}

function editableInnerMatches(value: string, close: number): boolean {
  let end = wordEnd(value, 1, "fill");
  let next = skipWhitespace(value, end, close);
  if (end >= 0 && next > end) {
    const thisEnd = wordEnd(value, next, "this");
    const beforeIn = skipWhitespace(value, thisEnd, close);
    const inEnd = wordEnd(value, beforeIn, "in");
    if (thisEnd >= 0 && beforeIn > thisEnd && optionalDetailMatches(value, inEnd, close)) {
      return true;
    }
    if (optionalDetailMatches(value, wordEnd(value, next, "me"), close)) return true;
  }
  end = wordEnd(value, 1, "replace");
  next = skipWhitespace(value, end, close);
  if (
    end >= 0 &&
    next > end &&
    optionalDetailMatches(value, firstWordEnd(value, next, targets), close)
  ) {
    return true;
  }
  end = firstWordEnd(value, 1, commands);
  const hereStart = close - 4;
  if (
    end >= 0 &&
    hereStart > end &&
    isWhitespace(codeUnitAt(value, end)) &&
    isWhitespace(codeUnitAt(value, hereStart - 1)) &&
    wordEnd(value, hereStart, "here") === close
  ) {
    return true;
  }
  end = wordEnd(value, 1, "your");
  next = skipWhitespace(value, end, close);
  const fieldEnd = firstWordEnd(value, next, fields);
  if (end < 0 || next === end || fieldEnd < 0) return false;
  if (fieldEnd === close) return true;
  const here = skipWhitespace(value, fieldEnd, close);
  return here > fieldEnd && wordEnd(value, here, "here") === close;
}

function bracketMatches(value: string): boolean {
  if (codeUnitAt(value, 0) !== 0x5b) return false;
  let close = 1;
  while (close < value.length && codeUnitAt(value, close) !== 0x5d) close += 1;
  if (close === value.length || !bracketSuffixMatches(value, close + 1)) return false;
  const markerEnd = firstWordEnd(value, 1, markerWords);
  if (markerEnd >= 0 && markerEnd <= close) {
    const next = codeUnitAt(value, markerEnd);
    if (markerEnd === close || isWhitespace(next) || (next === 0x3a && markerEnd < close))
      return true;
  }
  return editableInnerMatches(value, close);
}

function lineIsPlaceholder(value: string, start: number, end: number): boolean {
  const sliced = applySnapshot(sliceSnapshot, value, [start, end]);
  const line = applySnapshot(trimSnapshot, sliced, []) as string;
  return line.length > 0 && (directiveMatches(line) || bracketMatches(line));
}

/**
 * Classify one complete, caller-authorized visible semantic-text segment without retaining it.
 * The caller must exclude raw markup, code, HTML, YAML, destinations, and machine identifiers;
 * this primitive accepts no syntax tree and grants no whole-document budget or location authority.
 */
export function classifySemanticTextPlaceholder(
  value: unknown,
): SemanticTextPlaceholderClassification {
  if (typeof value !== "string") return INVALID_INPUT;
  if (value.length > MAX_SEMANTIC_TEXT_CODE_UNITS) return TOO_LARGE;
  try {
    if ((applySnapshot(trimSnapshot, value, []) as string).length === 0) return PLACEHOLDER;
    let lineStart = 0;
    for (let index = 0; index < value.length; index += 1) {
      const codeUnit = codeUnitAt(value, index);
      if (codeUnit !== 0x0a && codeUnit !== 0x0d) continue;
      if (lineIsPlaceholder(value, lineStart, index)) return PLACEHOLDER;
      if (codeUnit === 0x0d && codeUnitAt(value, index + 1) === 0x0a) index += 1;
      lineStart = index + 1;
    }
    return lineIsPlaceholder(value, lineStart, value.length) ? PLACEHOLDER : SAFE;
  } catch {
    return INVALID_INPUT;
  }
}

/** Accept only fixed result identities created by this module; no properties are inspected. */
export function isGenuineSemanticTextPlaceholderClassification(
  value: unknown,
): value is SemanticTextPlaceholderClassification {
  if ((typeof value !== "object" && typeof value !== "function") || value === null) return false;
  return applySnapshot(weakSetHasSnapshot, resultProvenance, [value]) as boolean;
}
