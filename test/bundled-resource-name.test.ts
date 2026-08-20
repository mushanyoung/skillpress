import { describe, expect, it, vi } from "vitest";

import {
  classifyBundledResourceFileName,
  isGenuineBundledResourceFileNameClassification,
} from "../src/validate/bundled-resource-name.js";

const ENVIRONMENT_NAMES = [".env", ".env.production", ".ENV.Local", ".env..local"] as const;
const CREDENTIAL_NAMES = [
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
  "private.key",
  "certificate.p12",
  "certificate.pem",
  "certificate.pfx",
  ".pem",
  "PRIVATE.PEM",
  ".NPMRC",
  "Credentials.JSON",
  "ID_RSA",
  "Service-Account.JSON",
] as const;
const SAFE_NAMES = [
  ".env-example",
  "id_rsa.pub",
  "credentials-guide.md",
  "tokenization.json",
  "certificate.pem.md",
  "foo.pem.bak",
  "SKILL.md",
  "résumé.md",
  "ſecrets.json",
] as const;

describe("bundled resource filename classification", () => {
  it.each(ENVIRONMENT_NAMES)("classifies environment file %s", (name) => {
    expect(classifyBundledResourceFileName(name)).toEqual({
      ok: false,
      reason: "environment_file",
    });
  });

  it.each(CREDENTIAL_NAMES)("classifies credential-like file %s", (name) => {
    expect(classifyBundledResourceFileName(name)).toEqual({
      ok: false,
      reason: "credential_file",
    });
  });

  it.each(SAFE_NAMES)("allows near-miss or ordinary file %s", (name) => {
    expect(classifyBundledResourceFileName(name)).toEqual({ ok: true });
  });

  it("gives environment names priority over credential suffixes", () => {
    expect(classifyBundledResourceFileName(".ENV.PEM")).toEqual({
      ok: false,
      reason: "environment_file",
    });
  });

  it.each([
    undefined,
    null,
    1,
    "",
    ".",
    "..",
    ".env.",
    "nested/.env",
    "nested\\token.json",
    "\u0000.env",
    "\ud800",
    "a".repeat(256),
    new String(".env"),
  ])("rejects invalid basename %#", (value) => {
    expect(classifyBundledResourceFileName(value)).toEqual({
      ok: false,
      reason: "invalid_input",
    });
  });

  it("accepts the exact UTF-8 name limit and rejects plus one", () => {
    const exact = `${"é".repeat(127)}a`;
    const over = `${exact}a`;
    expect(Buffer.byteLength(exact)).toBe(255);
    expect(Buffer.byteLength(over)).toBe(256);
    expect(classifyBundledResourceFileName(exact)).toEqual({ ok: true });
    expect(classifyBundledResourceFileName(over)).toEqual({
      ok: false,
      reason: "invalid_input",
    });
  });

  it("rejects proxies and revoked proxies without observing traps", () => {
    let observations = 0;
    const active = new Proxy(
      {},
      {
        get() {
          observations += 1;
          throw new Error("proxy getter was called");
        },
        getOwnPropertyDescriptor() {
          observations += 1;
          throw new Error("proxy descriptor trap was called");
        },
        getPrototypeOf() {
          observations += 1;
          throw new Error("proxy prototype trap was called");
        },
      },
    );
    const revoked = Proxy.revocable({}, {});
    revoked.revoke();
    expect(classifyBundledResourceFileName(active)).toEqual({
      ok: false,
      reason: "invalid_input",
    });
    expect(classifyBundledResourceFileName(revoked.proxy)).toEqual({
      ok: false,
      reason: "invalid_input",
    });
    expect(isGenuineBundledResourceFileNameClassification(active)).toBe(false);
    expect(isGenuineBundledResourceFileNameClassification(revoked.proxy)).toBe(false);
    expect(observations).toBe(0);
  });

  it("normalizes dependency throws and unauthenticated results", async () => {
    const actual = await vi.importActual<typeof import("../src/validate/resource-name-profile.js")>(
      "../src/validate/resource-name-profile.js",
    );
    let mode:
      | "throw_profile"
      | "throw_predicate"
      | "fake"
      | "truthy_predicate"
      | "throwing_shape"
      | "wrong_shape"
      | "substitution"
      | "stateful_environment"
      | "stateful_safe" = "throw_profile";
    let shapeReads = 0;
    let exactReads = 0;
    vi.doMock("../src/validate/resource-name-profile.js", () => ({
      ...actual,
      profileObservedResourceName(value: unknown): unknown {
        if (mode === "throw_profile") throw new Error("producer failure");
        if (mode === "fake" || mode === "truthy_predicate") return { ok: true, exact: value };
        if (mode === "throwing_shape") {
          return new Proxy(
            {},
            {
              get() {
                shapeReads += 1;
                throw new Error("shape getter was called");
              },
            },
          );
        }
        if (mode === "wrong_shape") return { ok: true, exact: 1 };
        if (mode === "substitution") return { ok: true, exact: "other.md" };
        if (mode === "stateful_environment" || mode === "stateful_safe") {
          return {
            ok: true,
            get exact() {
              exactReads += 1;
              if (exactReads === 1) return value;
              return mode === "stateful_environment" ? "guide.md" : "private.pem";
            },
          };
        }
        return actual.profileObservedResourceName(value);
      },
      isResourceNameProfileResult(value: unknown): unknown {
        if (mode === "throw_predicate") throw new Error("predicate failure");
        if (mode === "truthy_predicate") return 1;
        if (
          mode === "throwing_shape" ||
          mode === "wrong_shape" ||
          mode === "substitution" ||
          mode === "stateful_environment" ||
          mode === "stateful_safe"
        ) {
          return true;
        }
        return actual.isResourceNameProfileResult(value);
      },
    }));
    vi.resetModules();
    try {
      const isolated = await import("../src/validate/bundled-resource-name.js");
      for (const next of [
        "throw_profile",
        "throw_predicate",
        "fake",
        "truthy_predicate",
        "throwing_shape",
        "wrong_shape",
        "substitution",
      ] as const) {
        mode = next;
        expect(isolated.classifyBundledResourceFileName(".env")).toEqual({
          ok: false,
          reason: "invalid_input",
        });
      }
      expect(shapeReads).toBe(1);
      mode = "stateful_environment";
      exactReads = 0;
      expect(isolated.classifyBundledResourceFileName(".env")).toEqual({
        ok: false,
        reason: "environment_file",
      });
      expect(exactReads).toBe(1);
      mode = "stateful_safe";
      exactReads = 0;
      expect(isolated.classifyBundledResourceFileName("guide.md")).toEqual({ ok: true });
      expect(exactReads).toBe(1);
    } finally {
      vi.doUnmock("../src/validate/resource-name-profile.js");
      vi.resetModules();
    }
  });

  it("does not accept results from a second physical module instance", async () => {
    vi.resetModules();
    const foreign = await import("../src/validate/bundled-resource-name.js");
    const foreignResult = foreign.classifyBundledResourceFileName("guide.md");
    expect(foreign.isGenuineBundledResourceFileNameClassification(foreignResult)).toBe(true);
    expect(isGenuineBundledResourceFileNameClassification(foreignResult)).toBe(false);
  });

  it("returns frozen, singleton, property-free branded results without retaining input", () => {
    const secret = "sentinel-secret.pem";
    const safe = classifyBundledResourceFileName("guide.md");
    const sameSafe = classifyBundledResourceFileName("another.md");
    const credential = classifyBundledResourceFileName(secret);
    const sameCredential = classifyBundledResourceFileName("id_rsa");
    const environment = classifyBundledResourceFileName(".env");
    const sameEnvironment = classifyBundledResourceFileName(".ENV.local");
    const invalid = classifyBundledResourceFileName(Symbol("sentinel"));
    const sameInvalid = classifyBundledResourceFileName({});
    expect(safe).toBe(sameSafe);
    expect(credential).toBe(sameCredential);
    expect(environment).toBe(sameEnvironment);
    expect(invalid).toBe(sameInvalid);
    expect(Object.isFrozen(safe)).toBe(true);
    expect(Object.isFrozen(credential)).toBe(true);
    expect(Object.keys(safe)).toEqual(["ok"]);
    expect(Object.keys(credential)).toEqual(["ok", "reason"]);
    expect(isGenuineBundledResourceFileNameClassification(safe)).toBe(true);
    expect(isGenuineBundledResourceFileNameClassification(credential)).toBe(true);
    expect(isGenuineBundledResourceFileNameClassification(invalid)).toBe(true);
    expect(isGenuineBundledResourceFileNameClassification({ ok: true })).toBe(false);
    expect(isGenuineBundledResourceFileNameClassification({ ...credential })).toBe(false);
    expect(isGenuineBundledResourceFileNameClassification(structuredClone(credential))).toBe(false);
    expect(isGenuineBundledResourceFileNameClassification(() => undefined)).toBe(false);
    expect(isGenuineBundledResourceFileNameClassification(null)).toBe(false);
    expect(JSON.stringify([safe, credential, invalid])).not.toContain(secret);
  });

  it("uses module-initialization snapshots under post-import pollution", () => {
    const reflectDescriptor = Object.getOwnPropertyDescriptor(globalThis, "Reflect");
    const objectDescriptor = Object.getOwnPropertyDescriptor(globalThis, "Object");
    const stringDescriptor = Object.getOwnPropertyDescriptor(globalThis, "String");
    const defineProperties = Object.defineProperties;
    const defineProperty = Object.defineProperty;
    const deleteProperty = Reflect.deleteProperty;
    let observations = 0;
    let credential: ReturnType<typeof classifyBundledResourceFileName> | undefined;
    let safe: ReturnType<typeof classifyBundledResourceFileName> | undefined;
    const poison = () => {
      observations += 1;
      throw new Error("post-import intrinsic was read");
    };
    try {
      defineProperties(globalThis, {
        Reflect: { configurable: true, get: poison },
        Object: { configurable: true, get: poison },
        String: { configurable: true, get: poison },
      });
      credential = classifyBundledResourceFileName("PRIVATE.PEM");
      safe = classifyBundledResourceFileName("guide.md");
    } finally {
      if (reflectDescriptor === undefined) deleteProperty(globalThis, "Reflect");
      else defineProperty(globalThis, "Reflect", reflectDescriptor);
      if (objectDescriptor === undefined) deleteProperty(globalThis, "Object");
      else defineProperty(globalThis, "Object", objectDescriptor);
      if (stringDescriptor === undefined) deleteProperty(globalThis, "String");
      else defineProperty(globalThis, "String", stringDescriptor);
    }
    expect(observations).toBe(0);
    expect(credential).toEqual({ ok: false, reason: "credential_file" });
    expect(safe).toEqual({ ok: true });
  });
});
