import {
  isResourceNameProfileResult,
  MAX_RESOURCE_NAME_BYTES,
  profileObservedResourceName,
} from "./resource-name-profile.js";

export type BundledResourceFileNameFailureReason =
  | "invalid_input"
  | "environment_file"
  | "credential_file";

export type BundledResourceFileNameClassification =
  | Readonly<{ ok: true }>
  | Readonly<{ ok: false; reason: BundledResourceFileNameFailureReason }>;

// Module initialization is the trust boundary for intrinsics and producers below.
const applySnapshot = Reflect.apply;
const charCodeAtSnapshot = String.prototype.charCodeAt;
const freezeSnapshot = Object.freeze;
const weakSetAddSnapshot = WeakSet.prototype.add;
const weakSetHasSnapshot = WeakSet.prototype.has;
const profileObservedResourceNameSnapshot = profileObservedResourceName;
const isResourceNameProfileResultSnapshot = isResourceNameProfileResult;

const resultProvenance = new WeakSet<object>();

function register<T extends BundledResourceFileNameClassification>(value: T): T {
  const frozen = freezeSnapshot(value);
  applySnapshot(weakSetAddSnapshot, resultProvenance, [frozen]);
  return frozen;
}

const SAFE = register({ ok: true } as const);
const INVALID_INPUT = register({ ok: false, reason: "invalid_input" } as const);
const ENVIRONMENT_FILE = register({ ok: false, reason: "environment_file" } as const);
const CREDENTIAL_FILE = register({ ok: false, reason: "credential_file" } as const);

const credentialExactNames = freezeSnapshot([
  ".netrc",
  ".npmrc",
  ".pypirc",
  ".envrc",
  ".git-credentials",
  "credentials",
  "credentials.json",
  "id_dsa",
  "id_ed25519",
  "id_rsa",
  "service-account.json",
  "secrets.json",
  "token.json",
] as const);
const credentialSuffixes = freezeSnapshot([".key", ".p12", ".pem", ".pfx"] as const);

function codeUnitAt(value: string, index: number): number {
  return applySnapshot(charCodeAtSnapshot, value, [index]) as number;
}

function asciiFold(codeUnit: number): number {
  return codeUnit >= 0x41 && codeUnit <= 0x5a ? codeUnit + 0x20 : codeUnit;
}

function asciiEqualAt(value: string, offset: number, expected: string): boolean {
  for (let index = 0; index < expected.length; index += 1) {
    if (asciiFold(codeUnitAt(value, offset + index)) !== codeUnitAt(expected, index)) return false;
  }
  return true;
}

function asciiEqual(value: string, expected: string): boolean {
  return value.length === expected.length && asciiEqualAt(value, 0, expected);
}

function asciiStartsWith(value: string, expected: string): boolean {
  return value.length >= expected.length && asciiEqualAt(value, 0, expected);
}

function asciiEndsWith(value: string, expected: string): boolean {
  return (
    value.length >= expected.length && asciiEqualAt(value, value.length - expected.length, expected)
  );
}

function isEnvironmentFile(value: string): boolean {
  return asciiEqual(value, ".env") || asciiStartsWith(value, ".env.");
}

function isCredentialFile(value: string): boolean {
  for (let index = 0; index < credentialExactNames.length; index += 1) {
    if (asciiEqual(value, credentialExactNames[index] as string)) return true;
  }
  for (let index = 0; index < credentialSuffixes.length; index += 1) {
    if (asciiEndsWith(value, credentialSuffixes[index] as string)) return true;
  }
  return false;
}

/** Classify one inert, observed basename without retaining it or granting filesystem authority. */
export function classifyBundledResourceFileName(
  value: unknown,
): BundledResourceFileNameClassification {
  try {
    const profile = applySnapshot(profileObservedResourceNameSnapshot, undefined, [value]);
    const genuine = applySnapshot(isResourceNameProfileResultSnapshot, undefined, [profile]);
    if (genuine !== true) return INVALID_INPUT;
    // That captured brand is the semantic boundary; local copies only prevent repeat observation.
    const candidate = profile as { readonly ok?: unknown; readonly exact?: unknown };
    const ok = candidate.ok;
    const exact = candidate.exact;
    if (
      ok !== true ||
      typeof exact !== "string" ||
      exact !== value ||
      exact.length > MAX_RESOURCE_NAME_BYTES
    ) {
      return INVALID_INPUT;
    }
    if (isEnvironmentFile(exact)) return ENVIRONMENT_FILE;
    return isCredentialFile(exact) ? CREDENTIAL_FILE : SAFE;
  } catch {
    return INVALID_INPUT;
  }
}

/** Accept only fixed result identities created by this module; no properties are inspected. */
export function isGenuineBundledResourceFileNameClassification(
  value: unknown,
): value is BundledResourceFileNameClassification {
  if ((typeof value !== "object" && typeof value !== "function") || value === null) return false;
  return applySnapshot(weakSetHasSnapshot, resultProvenance, [value]) as boolean;
}
