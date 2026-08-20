const DEFAULT_IGNORABLE = /\p{Default_Ignorable_Code_Point}/u;
const WINDOWS_RESERVED_NAME =
  /^(?:aux|clock\$|com(?:[1-9]|[¹²³])|con|conin\$|conout\$|lpt(?:[1-9]|[¹²³])|nul|prn)(?:\.|$)/iu;
const WINDOWS_DEVICE_PREFIX = /^(?:\\\\|\/\/)[?.](?:\\|\/)/u;
const WINDOWS_DRIVE_RELATIVE = /^[A-Za-z]:(?:$|[^\\/])/u;
const WINDOWS_FORBIDDEN_COMPONENT = /[<>"|?*]/u;

export const MAX_PATH_INPUT_BYTES = 64 * 1024;
export const MAX_PATH_COMPONENTS = 256;

export function isUnambiguousUnicode(value: string): boolean {
  if (Buffer.from(value, "utf8").toString("utf8") !== value) return false;
  for (const character of value) {
    const codePoint = character.codePointAt(0) as number;
    if (
      codePoint < 0x20 ||
      (codePoint >= 0x7f && codePoint <= 0x9f) ||
      codePoint === 0x2028 ||
      codePoint === 0x2029 ||
      (codePoint >= 0xfdd0 && codePoint <= 0xfdef) ||
      codePoint % 0x10000 >= 0xfffe ||
      DEFAULT_IGNORABLE.test(character)
    ) {
      return false;
    }
  }
  return true;
}

function hasUnsafeWindowsSyntax(value: string): boolean {
  if (WINDOWS_DEVICE_PREFIX.test(value) || WINDOWS_DRIVE_RELATIVE.test(value)) return true;
  const components = value.split(/[\\/]+/u);
  for (let index = 0; index < components.length; index += 1) {
    const component = components[index] as string;
    if (component === "") continue;
    if (component === "." || component === "..") continue;
    const drive = index === 0 && /^[A-Za-z]:$/u.test(component);
    if (
      (!drive && component.includes(":")) ||
      WINDOWS_FORBIDDEN_COMPONENT.test(component) ||
      component.endsWith(".") ||
      component.endsWith(" ") ||
      WINDOWS_RESERVED_NAME.test(component)
    ) {
      return true;
    }
  }
  return false;
}

export function isSafePathInput(
  value: unknown,
  platform: NodeJS.Platform = process.platform,
): value is string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_PATH_INPUT_BYTES ||
    value.trim() === ""
  ) {
    return false;
  }
  if (Buffer.byteLength(value, "utf8") > MAX_PATH_INPUT_BYTES || !isUnambiguousUnicode(value)) {
    return false;
  }
  return platform !== "win32" || !hasUnsafeWindowsSyntax(value);
}
