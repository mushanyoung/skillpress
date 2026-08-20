export type FrontmatterTextIssue = "control_character" | "invalid_unicode";

function hasUnpairedSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (index + 1 >= value.length || next < 0xdc00 || next > 0xdfff) return true;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) return true;
  }
  return false;
}

function hasForbiddenCodePoint(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0) as number;
    if (
      codePoint <= 0x08 ||
      codePoint === 0x0b ||
      codePoint === 0x0c ||
      (codePoint >= 0x0e && codePoint <= 0x1f) ||
      (codePoint >= 0x7f && codePoint <= 0x9f) ||
      (codePoint >= 0xfdd0 && codePoint <= 0xfdef) ||
      codePoint % 0x10000 >= 0xfffe
    ) {
      return true;
    }
  }
  return false;
}

export function frontmatterTextIssue(value: string): FrontmatterTextIssue | undefined {
  if (hasUnpairedSurrogate(value)) return "invalid_unicode";
  return hasForbiddenCodePoint(value) ? "control_character" : undefined;
}
