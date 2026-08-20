import { readFile } from "node:fs/promises";
import { types } from "node:util";

import { describe, expect, it, vi } from "vitest";

import { type AbortSignalSample, sampleAbortSignal } from "../src/validate/abort-signal.js";

const repositoryRoot = new URL("../", import.meta.url);

describe("native AbortSignal observations", () => {
  it("distinguishes an absent signal from active and aborted native signals", () => {
    const active = new AbortController();
    const aborted = new AbortController();
    aborted.abort(new Error("private abort detail"));

    const observations: AbortSignalSample[] = [
      sampleAbortSignal(undefined),
      sampleAbortSignal(active.signal),
      sampleAbortSignal(aborted.signal),
      sampleAbortSignal(AbortSignal.abort()),
    ];
    expect(observations).toEqual(["absent", "active", "aborted", "aborted"]);
    active.abort();
    expect(sampleAbortSignal(active.signal)).toBe("aborted");
  });

  it("rejects primitives, shaped objects, inherited brands, and polyfill prototypes", () => {
    let getterCalls = 0;
    const shaped = Object.defineProperty({}, "aborted", {
      get() {
        getterCalls += 1;
        return false;
      },
    });
    const prototypeShaped = Object.defineProperty(Object.create(AbortSignal.prototype), "aborted", {
      get() {
        getterCalls += 1;
        return false;
      },
    });
    class PolyfillAbortSignal extends EventTarget {
      get aborted(): boolean {
        getterCalls += 1;
        return false;
      }
    }
    const native = new AbortController().signal;
    const invalid = [
      null,
      false,
      0,
      "active",
      Symbol("signal"),
      1n,
      {},
      shaped,
      prototypeShaped,
      Object.create(AbortSignal.prototype),
      Object.create(native),
      { ...native },
      new PolyfillAbortSignal(),
    ];

    for (const value of invalid) {
      expect(sampleAbortSignal(value)).toBe("invalid");
    }
    expect(getterCalls).toBe(0);
  });

  it("rejects transparent and revoked proxies without invoking their traps", () => {
    const signal = new AbortController().signal;
    let trapCalls = 0;
    const handler: ProxyHandler<AbortSignal> = {
      get() {
        trapCalls += 1;
        throw new Error("proxy property read");
      },
      getOwnPropertyDescriptor() {
        trapCalls += 1;
        throw new Error("proxy descriptor read");
      },
      getPrototypeOf() {
        trapCalls += 1;
        throw new Error("proxy prototype read");
      },
    };
    const transparent = new Proxy(signal, handler);
    const revocable = Proxy.revocable(signal, handler);
    revocable.revoke();
    const emptyHandler = new Proxy(signal, {});
    const shaped = new Proxy(
      {},
      {
        get() {
          trapCalls += 1;
          return true;
        },
      },
    );

    expect(sampleAbortSignal(transparent)).toBe("invalid");
    expect(sampleAbortSignal(revocable.proxy)).toBe("invalid");
    expect(sampleAbortSignal(emptyHandler)).toBe("invalid");
    expect(sampleAbortSignal(shaped)).toBe("invalid");
    expect(trapCalls).toBe(0);
  });

  it("uses initialization-time snapshots after global and prototype pollution", () => {
    const constructorSnapshot = globalThis.AbortSignal;
    const constructorDescriptor = Object.getOwnPropertyDescriptor(globalThis, "AbortSignal");
    const abortedDescriptor = Object.getOwnPropertyDescriptor(
      constructorSnapshot.prototype,
      "aborted",
    );
    const applyDescriptor = Object.getOwnPropertyDescriptor(Reflect, "apply");
    const getPrototypeOfDescriptor = Object.getOwnPropertyDescriptor(Object, "getPrototypeOf");
    const isProxyDescriptor = Object.getOwnPropertyDescriptor(types, "isProxy");
    if (
      constructorDescriptor === undefined ||
      abortedDescriptor === undefined ||
      applyDescriptor === undefined ||
      getPrototypeOfDescriptor === undefined ||
      isProxyDescriptor === undefined
    ) {
      throw new Error("Expected native AbortSignal descriptors");
    }

    const active = new AbortController().signal;
    const abortedController = new AbortController();
    abortedController.abort();
    let poisonCalls = 0;
    const poison = (): never => {
      poisonCalls += 1;
      throw new Error("live intrinsic was used");
    };
    let observations: readonly AbortSignalSample[] | undefined;
    try {
      Object.defineProperty(constructorSnapshot.prototype, "aborted", {
        ...abortedDescriptor,
        get: poison,
      });
      Object.defineProperty(globalThis, "AbortSignal", {
        ...constructorDescriptor,
        value: poison,
      });
      Object.defineProperty(Object, "getPrototypeOf", {
        ...getPrototypeOfDescriptor,
        value: poison,
      });
      Object.defineProperty(types, "isProxy", { ...isProxyDescriptor, value: poison });
      Object.defineProperty(Reflect, "apply", { ...applyDescriptor, value: poison });
      observations = [sampleAbortSignal(active), sampleAbortSignal(abortedController.signal)];
    } finally {
      Object.defineProperty(Reflect, "apply", applyDescriptor);
      Object.defineProperty(types, "isProxy", isProxyDescriptor);
      Object.defineProperty(Object, "getPrototypeOf", getPrototypeOfDescriptor);
      Object.defineProperty(globalThis, "AbortSignal", constructorDescriptor);
      Object.defineProperty(constructorSnapshot.prototype, "aborted", abortedDescriptor);
    }

    expect(observations).toEqual(["active", "aborted"]);
    expect(poisonCalls).toBe(0);
  });

  it("rejects a non-boolean getter result in an isolated module instance", async () => {
    const descriptor = Object.getOwnPropertyDescriptor(AbortSignal.prototype, "aborted");
    if (descriptor === undefined) throw new Error("Expected the native aborted getter");
    const signal = new AbortController().signal;
    let sample: AbortSignalSample | undefined;
    try {
      Object.defineProperty(AbortSignal.prototype, "aborted", {
        ...descriptor,
        get: () => "not boolean",
      });
      vi.resetModules();
      const isolated = await import("../src/validate/abort-signal.js");
      sample = isolated.sampleAbortSignal(signal);
    } finally {
      Object.defineProperty(AbortSignal.prototype, "aborted", descriptor);
      vi.resetModules();
    }
    expect(sample).toBe("invalid");
  });

  it("has no filesystem, timer, subscription, exception-detail, or live-signal shortcut", async () => {
    const source = await readFile(new URL("src/validate/abort-signal.ts", repositoryRoot), "utf8");
    for (const fragment of [
      "node:fs",
      "node:path",
      "process.",
      "setTimeout",
      "Promise.race",
      "addEventListener",
      "removeEventListener",
      "throwIfAborted",
      ".reason",
    ]) {
      expect(source).not.toContain(fragment);
    }
    expect(source).toContain("AbortSignal.prototype");
    expect(source).toContain("Reflect.apply");

    const rootSource = await readFile(new URL("src/index.ts", repositoryRoot), "utf8");
    expect(rootSource).not.toContain("abort-signal");
    expect(rootSource).not.toContain("sampleAbortSignal");
  });
});
