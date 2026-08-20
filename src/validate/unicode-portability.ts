import { fullCaseFoldUnicode15_1, isAssignedScalarUnicode15_1 } from "./generated-unicode.js";

export type PortableFilenameKeyFailureReason = "unassigned" | "non_nfc" | "unsupported_runtime";

export type PortableFilenameKeyResult =
  | Readonly<{ ok: true; key: string }>
  | Readonly<{ ok: false; reason: PortableFilenameKeyFailureReason }>;

// Module initialization is the trust boundary for the intrinsics below.
const applySnapshot = Reflect.apply;
const charCodeAtSnapshot = String.prototype.charCodeAt;
const freezeSnapshot = Object.freeze;
const normalizeSnapshot = String.prototype.normalize;

const UNASSIGNED: PortableFilenameKeyResult = freezeSnapshot({
  ok: false,
  reason: "unassigned",
});
const NON_NFC: PortableFilenameKeyResult = freezeSnapshot({
  ok: false,
  reason: "non_nfc",
});
const UNSUPPORTED_RUNTIME: PortableFilenameKeyResult = freezeSnapshot({
  ok: false,
  reason: "unsupported_runtime",
});

const unicodeVersionPattern = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:\.(0|[1-9][0-9]*))?$/;

function codeUnitAt(value: string, index: number): number {
  return applySnapshot(charCodeAtSnapshot, value, [index]) as number;
}

function normalize(value: string, form: "NFC" | "NFD"): string {
  return applySnapshot(normalizeSnapshot, value, [form]) as string;
}

function hasSupportedUnicodeVersion(value: unknown): boolean {
  if (typeof value !== "string") {
    return false;
  }
  const match = unicodeVersionPattern.exec(value);
  if (match === null) {
    return false;
  }

  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3] ?? 0);
  if (![major, minor, patch].every(Number.isSafeInteger)) {
    return false;
  }
  return major > 15 || (major === 15 && minor >= 1);
}

function hasSupportedNormalization(): boolean {
  try {
    return normalize("\u00c5", "NFD") === "A\u030a" && normalize("A\u030a", "NFC") === "\u00c5";
  } catch {
    return false;
  }
}

const runtimeIsSupported =
  hasSupportedUnicodeVersion(process.versions.unicode) && hasSupportedNormalization();

export function portableFilenameKey(value: string): PortableFilenameKeyResult {
  if (!runtimeIsSupported) {
    return UNSUPPORTED_RUNTIME;
  }

  for (let index = 0; index < value.length; index += 1) {
    const first = codeUnitAt(value, index);
    let codePoint = first;
    if (first >= 0xd800 && first <= 0xdbff && index + 1 < value.length) {
      const second = codeUnitAt(value, index + 1);
      if (second >= 0xdc00 && second <= 0xdfff) {
        codePoint = (first - 0xd800) * 0x400 + second - 0xdc00 + 0x10000;
        index += 1;
      }
    }
    if (!isAssignedScalarUnicode15_1(codePoint)) {
      return UNASSIGNED;
    }
  }
  if (normalize(value, "NFC") !== value) {
    return NON_NFC;
  }

  const decomposed = normalize(value, "NFD");
  const key = normalize(fullCaseFoldUnicode15_1(decomposed), "NFD");
  return freezeSnapshot({ ok: true, key });
}
