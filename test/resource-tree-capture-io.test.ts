import { readFile } from "node:fs/promises";

import { describe, expect, it, vi } from "vitest";

import {
  snapshotResourceTreeCaptureIo,
  type ResourceTreeCaptureIo,
} from "../src/validate/resource-tree-capture.js";

const callbackNames = ["lstatPath", "openDirectory", "rootIsCurrent"] as const;

function callbacks(): ResourceTreeCaptureIo {
  return {
    lstatPath: vi.fn(async () => ({ marker: "lstat" }) as never),
    openDirectory: vi.fn(async () => ({ marker: "open" }) as never),
    rootIsCurrent: vi.fn(async () => true),
  };
}

describe("resource-tree capture IO snapshots", () => {
  it("snapshots the default and custom own callbacks in fixed order", () => {
    for (const value of [
      snapshotResourceTreeCaptureIo(),
      snapshotResourceTreeCaptureIo(undefined),
    ]) {
      expect(value).toBeDefined();
      expect(Object.isFrozen(value)).toBe(true);
      expect(Reflect.ownKeys(value ?? {})).toEqual(callbackNames);
    }

    const target = callbacks() as unknown as Record<PropertyKey, unknown>;
    const descriptorCalls: PropertyKey[] = [];
    let getterCalls = 0;
    const proxy = new Proxy(target, {
      get() {
        getterCalls += 1;
        throw new Error("property getter must not run");
      },
      getOwnPropertyDescriptor(current, property) {
        descriptorCalls.push(property);
        return Reflect.getOwnPropertyDescriptor(current, property);
      },
    });
    const snapshot = snapshotResourceTreeCaptureIo(proxy);
    expect(snapshot).toBeDefined();
    if (snapshot === undefined) return;
    expect(descriptorCalls).toEqual(callbackNames);
    expect(getterCalls).toBe(0);
    expect(Object.isFrozen(snapshot)).toBe(true);
    for (const name of callbackNames) expect(snapshot[name]).toBe(target[name]);

    const retained = callbackNames.map((name) => snapshot[name]);
    for (const name of callbackNames) target[name] = vi.fn();
    expect(callbackNames.map((name) => snapshot[name])).toEqual(retained);
  });

  it("rejects accessor, inherited, noncallable, and hostile descriptor shapes without raw failure", () => {
    let getterCalls = 0;
    for (const accessorName of callbackNames) {
      const value = callbacks() as unknown as Record<PropertyKey, unknown>;
      Object.defineProperty(value, accessorName, {
        configurable: true,
        get() {
          getterCalls += 1;
          throw new Error("secret getter");
        },
      });
      expect(snapshotResourceTreeCaptureIo(value)).toBeUndefined();
    }
    expect(getterCalls).toBe(0);

    expect(snapshotResourceTreeCaptureIo(Object.create(callbacks()))).toBeUndefined();
    for (const noncallableName of callbackNames) {
      const value = callbacks() as unknown as Record<PropertyKey, unknown>;
      value[noncallableName] = 1;
      expect(snapshotResourceTreeCaptureIo(value)).toBeUndefined();
    }
    for (const value of [null, false, 0, "io", {}, () => undefined]) {
      expect(snapshotResourceTreeCaptureIo(value)).toBeUndefined();
    }

    for (const throwingName of callbackNames) {
      let propertyGets = 0;
      const proxy = new Proxy(callbacks(), {
        get() {
          propertyGets += 1;
          throw new Error("secret property access");
        },
        getOwnPropertyDescriptor(target, property) {
          if (property === throwingName) throw new Error("secret descriptor failure");
          return Reflect.getOwnPropertyDescriptor(target, property);
        },
      });
      expect(snapshotResourceTreeCaptureIo(proxy)).toBeUndefined();
      expect(propertyGets).toBe(0);
    }

    const revocable = Proxy.revocable(callbacks(), {});
    revocable.revoke();
    expect(snapshotResourceTreeCaptureIo(revocable.proxy)).toBeUndefined();
  });

  it("stays internal and documents that a callback snapshot grants no authority", async () => {
    const rootSource = await readFile(new URL("../src/index.ts", import.meta.url), "utf8");
    expect(rootSource).not.toContain("snapshotResourceTreeCaptureIo");
    const captureSource = await readFile(
      new URL("../src/validate/resource-tree-capture.ts", import.meta.url),
      "utf8",
    );
    expect(captureSource).toContain("without granting filesystem or traversal authority");
  });
});
