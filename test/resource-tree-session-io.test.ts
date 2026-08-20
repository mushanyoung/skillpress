import { constants } from "node:fs";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  type ResourceTreeSessionIo,
  snapshotResourceTreeSessionIo,
} from "../src/validate/resource-tree-session-io.js";

const captureModulePath = "../src/validate/resource-tree-capture.js";
const outerKeys = [
  "lstatPath",
  "openDirectory",
  "rootIsCurrent",
  "openFile",
  "capabilities",
] as const;
const callbackKeys = outerKeys.slice(0, 4);
const captureKeys = outerKeys.slice(0, 3);
const capabilityKeys = ["noFollow", "nonBlock"] as const;

afterEach(() => {
  vi.doUnmock(captureModulePath);
  vi.resetModules();
});

function callbacks(onCall: () => void = () => undefined): ResourceTreeSessionIo {
  return {
    lstatPath: async () => {
      onCall();
      return {} as never;
    },
    openDirectory: async () => {
      onCall();
      return {} as never;
    },
    rootIsCurrent: async () => {
      onCall();
      return true;
    },
    openFile: async () => {
      onCall();
      return {} as never;
    },
    capabilities: { noFollow: true, nonBlock: false },
  };
}

function expectFrozenRecord(value: object, keys: readonly PropertyKey[]): void {
  expect(Reflect.ownKeys(value)).toEqual(keys);
  expect(Object.keys(value)).toEqual(keys);
  expect(Object.getPrototypeOf(value)).toBe(Object.prototype);
  expect(Object.isFrozen(value)).toBe(true);
  for (const key of keys) {
    expect(Object.getOwnPropertyDescriptor(value, key)).toEqual({
      configurable: false,
      enumerable: true,
      value: (value as Record<PropertyKey, unknown>)[key],
      writable: false,
    });
  }
}

function tracedProxy(
  target: object,
  trace: PropertyKey[],
  onGet: () => void,
  throwing?: PropertyKey,
): object {
  return new Proxy(target, {
    get() {
      onGet();
      throw new Error("ordinary getter must not run");
    },
    getOwnPropertyDescriptor(value, property) {
      trace.push(property);
      if (property === throwing) throw new Error("secret descriptor failure");
      return Reflect.getOwnPropertyDescriptor(value, property);
    },
  });
}

function expectPropertyFailures(
  keys: readonly PropertyKey[],
  createTarget: () => Record<PropertyKey, unknown>,
  submit: (value: object) => unknown,
): void {
  for (const [index, key] of keys.entries()) {
    for (const shape of ["missing", "inherited", "accessor", "invalid", "throw"] as const) {
      let target = createTarget();
      let getterCalls = 0;
      if (shape === "missing") Reflect.deleteProperty(target, key);
      if (shape === "inherited") {
        const inherited = target;
        target = Object.create(inherited) as Record<PropertyKey, unknown>;
        for (const prior of keys.slice(0, index)) {
          const descriptor = Object.getOwnPropertyDescriptor(inherited, prior);
          if (descriptor === undefined) throw new Error("missing inherited fixture field");
          Object.defineProperty(target, prior, descriptor);
        }
      }
      if (shape === "accessor") {
        Object.defineProperty(target, key, {
          configurable: true,
          get() {
            getterCalls += 1;
            throw new Error("secret getter");
          },
        });
      }
      if (shape === "invalid") target[key] = 1;
      const trace: PropertyKey[] = [];
      const wrapped = tracedProxy(
        target,
        trace,
        () => (getterCalls += 1),
        shape === "throw" ? key : undefined,
      );
      expect(submit(wrapped)).toBeUndefined();
      expect(trace).toEqual(keys.slice(0, index + 1));
      expect(getterCalls).toBe(0);
    }
  }
}

describe("resource-tree session IO snapshots", () => {
  it("returns fresh exact default snapshots with module-initialized native capabilities", () => {
    const first = snapshotResourceTreeSessionIo();
    const second = snapshotResourceTreeSessionIo(undefined);
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    if (first === undefined || second === undefined) return;
    expectFrozenRecord(first, outerKeys);
    expectFrozenRecord(first.capabilities, capabilityKeys);
    expectFrozenRecord(second, outerKeys);
    expectFrozenRecord(second.capabilities, capabilityKeys);
    expect(first).not.toBe(second);
    expect(first.capabilities).not.toBe(second.capabilities);
    expect(callbackKeys.map((key) => first[key])).toEqual(callbackKeys.map((key) => second[key]));
    expect(first.capabilities).toEqual({
      noFollow: typeof constants.O_NOFOLLOW === "number" && constants.O_NOFOLLOW !== 0,
      nonBlock: typeof constants.O_NONBLOCK === "number" && constants.O_NONBLOCK !== 0,
    });

    const repeated = snapshotResourceTreeSessionIo(first);
    expect(repeated).toBeDefined();
    if (repeated === undefined) return;
    expect(repeated).not.toBe(first);
    expect(repeated.capabilities).not.toBe(first.capabilities);
    expect(callbackKeys.map((key) => repeated[key])).toEqual(callbackKeys.map((key) => first[key]));
  });

  it("copies custom own data in fixed order without invoking callbacks or retaining containers", () => {
    let callbackCalls = 0;
    let getterCalls = 0;
    const source = callbacks(() => (callbackCalls += 1)) as unknown as Record<PropertyKey, unknown>;
    const originalCallbacks = callbackKeys.map((key) => source[key]);
    const capabilityTarget = { noFollow: true, nonBlock: false, ignored: "nested" };
    const outerTrace: PropertyKey[] = [];
    const capabilityTrace: PropertyKey[] = [];
    source.capabilities = tracedProxy(capabilityTarget, capabilityTrace, () => (getterCalls += 1));
    source.ignored = "outer";
    const wrapped = tracedProxy(source, outerTrace, () => (getterCalls += 1));
    const snapshot = snapshotResourceTreeSessionIo(wrapped);
    expect(snapshot).toBeDefined();
    if (snapshot === undefined) return;
    expect(outerTrace).toEqual(outerKeys);
    expect(capabilityTrace).toEqual(capabilityKeys);
    expect({ callbackCalls, getterCalls }).toEqual({ callbackCalls: 0, getterCalls: 0 });
    expectFrozenRecord(snapshot, outerKeys);
    expectFrozenRecord(snapshot.capabilities, capabilityKeys);
    expect(callbackKeys.map((key) => snapshot[key])).toEqual(originalCallbacks);

    for (const key of callbackKeys) source[key] = vi.fn();
    capabilityTarget.noFollow = false;
    capabilityTarget.nonBlock = true;
    expect(callbackKeys.map((key) => snapshot[key])).toEqual(originalCallbacks);
    expect(snapshot.capabilities).toEqual({ noFollow: true, nonBlock: false });
    const repeated = snapshotResourceTreeSessionIo(snapshot);
    expect(repeated).toBeDefined();
    if (repeated === undefined) return;
    expect(repeated).not.toBe(snapshot);
    expect(repeated?.capabilities).not.toBe(snapshot.capabilities);
    expect(callbackKeys.map((key) => repeated?.[key])).toEqual(originalCallbacks);

    const callableCapabilities = Object.assign(() => undefined, {
      noFollow: false,
      nonBlock: true,
    });
    expect(
      snapshotResourceTreeSessionIo({ ...callbacks(), capabilities: callableCapabilities }),
    ).toBeDefined();
  });

  it("fails closed in descriptor order for malformed, hostile, and producer outputs", async () => {
    expectPropertyFailures(
      outerKeys,
      () => callbacks() as unknown as Record<PropertyKey, unknown>,
      snapshotResourceTreeSessionIo,
    );
    expectPropertyFailures(
      capabilityKeys,
      () => ({ noFollow: true, nonBlock: false }),
      (capabilities) => snapshotResourceTreeSessionIo({ ...callbacks(), capabilities }),
    );

    const revokedOuter = Proxy.revocable(callbacks(), {});
    revokedOuter.revoke();
    expect(snapshotResourceTreeSessionIo(revokedOuter.proxy)).toBeUndefined();
    const revokedCapabilities = Proxy.revocable({ noFollow: true, nonBlock: false }, {});
    revokedCapabilities.revoke();
    expect(
      snapshotResourceTreeSessionIo({ ...callbacks(), capabilities: revokedCapabilities.proxy }),
    ).toBeUndefined();

    let returned: unknown;
    vi.doMock(captureModulePath, () => ({
      snapshotResourceTreeCaptureIo(value: unknown) {
        if (value === undefined) return callbacks();
        if (value === "throw") throw new Error("secret producer failure");
        return returned;
      },
    }));
    vi.resetModules();
    const isolated = await import("../src/validate/resource-tree-session-io.js");
    expect(isolated.snapshotResourceTreeSessionIo("throw")).toBeUndefined();
    expectPropertyFailures(
      captureKeys,
      () => callbacks() as unknown as Record<PropertyKey, unknown>,
      (value) => {
        returned = value;
        return isolated.snapshotResourceTreeSessionIo({});
      },
    );
    const revokedReturned = Proxy.revocable(callbacks(), {});
    revokedReturned.revoke();
    returned = revokedReturned.proxy;
    expect(isolated.snapshotResourceTreeSessionIo({})).toBeUndefined();
  });
});
