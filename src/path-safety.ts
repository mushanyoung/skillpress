import { Buffer } from "node:buffer";

const DEFAULT_IGNORABLE = /\p{Default_Ignorable_Code_Point}/u;
const WINDOWS_RESERVED_NAME =
  /^(?:aux|clock\$|com(?:[1-9]|[¹²³])|con|conin\$|conout\$|lpt(?:[1-9]|[¹²³])|nul|prn)(?:\.|$)/iu;
const WINDOWS_DEVICE_PREFIX = /^(?:\\\\|\/\/)[?.](?:\\|\/)/u;
const WINDOWS_DRIVE_RELATIVE = /^[A-Za-z]:(?:$|[^\\/])/u;
const WINDOWS_DRIVE_COMPONENT = /^[A-Za-z]:$/u;
const WINDOWS_FORBIDDEN_COMPONENT = /[<>"|?*]/u;

export const MAX_PATH_INPUT_BYTES = 64 * 1024;
export const MAX_PATH_COMPONENTS = 256;

// Module initialization is the trust boundary for the intrinsics below.
const applySnapshot = Reflect.apply;
const bufferByteLengthSnapshot = Buffer.byteLength;
const bufferConstructorSnapshot = Buffer;
const bufferFromSnapshot = Buffer.from;
const bufferToStringSnapshot = Buffer.prototype.toString;
const charCodeAtSnapshot = String.prototype.charCodeAt;
const codePointAtSnapshot = String.prototype.codePointAt;
const endsWithSnapshot = String.prototype.endsWith;
const includesSnapshot = String.prototype.includes;
const platformSnapshot = process.platform;
const regexpExecSnapshot = RegExp.prototype.exec;
const sliceSnapshot = String.prototype.slice;
const trimSnapshot = String.prototype.trim;

type Intrinsic = (...args: never[]) => unknown;
function applyIntrinsic<T>(intrinsic: Intrinsic, receiver: unknown, args: unknown[]): T {
  return applySnapshot(intrinsic, receiver, args) as T;
}

function matches(pattern: RegExp, value: string): boolean {
  return applyIntrinsic<RegExpExecArray | null>(regexpExecSnapshot, pattern, [value]) !== null;
}

function includes(value: string, search: string): boolean {
  return applyIntrinsic<boolean>(includesSnapshot, value, [search]);
}

function endsWith(value: string, search: string): boolean {
  return applyIntrinsic<boolean>(endsWithSnapshot, value, [search]);
}

function byteLength(value: string): number {
  return applyIntrinsic<number>(bufferByteLengthSnapshot, bufferConstructorSnapshot, [
    value,
    "utf8",
  ]);
}

export function isUnambiguousUnicode(value: string): boolean {
  const encoded = applyIntrinsic<Buffer>(bufferFromSnapshot, bufferConstructorSnapshot, [
    value,
    "utf8",
  ]);
  if (applyIntrinsic<string>(bufferToStringSnapshot, encoded, ["utf8"]) !== value) return false;
  if (matches(DEFAULT_IGNORABLE, value)) return false;
  for (let index = 0; index < value.length; index += 1) {
    const codePoint = applyIntrinsic<number>(codePointAtSnapshot, value, [index]);
    if (
      codePoint < 0x20 ||
      (codePoint >= 0x7f && codePoint <= 0x9f) ||
      codePoint === 0x2028 ||
      codePoint === 0x2029 ||
      (codePoint >= 0xfdd0 && codePoint <= 0xfdef) ||
      codePoint % 0x10000 >= 0xfffe
    ) {
      return false;
    }
    if (codePoint > 0xffff) index += 1;
  }
  return true;
}

function hasUnsafeWindowsSyntax(value: string): boolean {
  if (matches(WINDOWS_DEVICE_PREFIX, value) || matches(WINDOWS_DRIVE_RELATIVE, value)) return true;
  let start = 0;
  for (let index = 0; index <= value.length; index += 1) {
    const codeUnit =
      index === value.length ? -1 : applyIntrinsic<number>(charCodeAtSnapshot, value, [index]);
    if (codeUnit !== -1 && codeUnit !== 0x2f && codeUnit !== 0x5c) continue;
    const component = applyIntrinsic<string>(sliceSnapshot, value, [start, index]);
    const first = start === 0;
    start = index + 1;
    if (component === "" || component === "." || component === "..") continue;
    const drive = first && matches(WINDOWS_DRIVE_COMPONENT, component);
    if (
      (!drive && includes(component, ":")) ||
      matches(WINDOWS_FORBIDDEN_COMPONENT, component) ||
      endsWith(component, ".") ||
      endsWith(component, " ") ||
      matches(WINDOWS_RESERVED_NAME, component)
    ) {
      return true;
    }
  }
  return false;
}

export function isSafePathInput(
  value: unknown,
  platform: NodeJS.Platform = platformSnapshot,
): value is string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_PATH_INPUT_BYTES ||
    applyIntrinsic<string>(trimSnapshot, value, []).length === 0
  ) {
    return false;
  }
  if (byteLength(value) > MAX_PATH_INPUT_BYTES || !isUnambiguousUnicode(value)) return false;
  return platform !== "win32" || !hasUnsafeWindowsSyntax(value);
}
