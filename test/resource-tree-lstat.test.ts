import { constants, type BigIntStats } from "node:fs";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  lstatResourceTreePath,
  type ResourceTreeLstatIo,
  type ResourceTreeLstatResult,
} from "../src/validate/resource-tree-lstat.js";

const repositoryRoot = new URL("../", import.meta.url);

function stats(kind: "directory" | "file" | "other" | "symbolic-link" = "file"): BigIntStats {
  const mode = {
    directory: BigInt(constants.S_IFDIR),
    file: BigInt(constants.S_IFREG),
    other: 0n,
    "symbolic-link": BigInt(constants.S_IFLNK),
  }[kind];
  return {
    dev: 1n,
    ino: 2n,
    mode,
    size: 3n,
    mtimeNs: 4n,
    ctimeNs: 5n,
  } as BigIntStats;
}

function expectFailure(result: ResourceTreeLstatResult, reason: string): void {
  expect(result).toEqual({ ok: false, reason });
  expect(Object.keys(result).sort()).toEqual(["ok", "reason"]);
  expect(Object.isFrozen(result)).toBe(true);
}

describe("resource-tree lstat", () => {
  it("passes each primitive string once with undefined receiver and snapshots every file kind", async () => {
    for (const [path, kind] of [
      ["", "file"],
      ["a\0b", "directory"],
      ["A\u030a", "symbolic-link"],
      ["plain", "other"],
    ] as const) {
      let calls = 0;
      let receiver: unknown = "unset";
      let argumentsList: unknown[] = [];
      const io: ResourceTreeLstatIo = {
        lstatPath: async function (this: unknown, ...args: [string]) {
          calls += 1;
          receiver = this;
          argumentsList = args;
          return stats(kind);
        },
      };

      const result = await lstatResourceTreePath(path, undefined, io);
      expect(result.ok).toBe(true);
      if (!result.ok) continue;
      expect(result.metadata.kind).toBe(kind);
      expect(Object.isFrozen(result)).toBe(true);
      expect(Object.isFrozen(result.metadata)).toBe(true);
      expect(calls).toBe(1);
      expect(receiver).toBeUndefined();
      expect(argumentsList).toEqual([path]);
    }
  });

  it("uses the captured native lstat with bigint options by default", async () => {
    const result = await lstatResourceTreePath(fileURLToPath(import.meta.url));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.metadata.kind).toBe("file");
    expect(typeof result.metadata.dev).toBe("bigint");
  });

  it("enforces path, signal, IO, and pre-abort priority without invoking accessors", async () => {
    let getterCalls = 0;
    const accessorIo = {
      get lstatPath(): ResourceTreeLstatIo["lstatPath"] {
        getterCalls += 1;
        throw new Error("live getter used");
      },
    };
    const validIo: ResourceTreeLstatIo = { lstatPath: async () => stats() };

    for (const path of [undefined, null, 0, new String("path"), Symbol("path"), () => "path"]) {
      expectFailure(await lstatResourceTreePath(path, {}, accessorIo), "invalid_input");
    }
    expect(getterCalls).toBe(0);

    expectFailure(await lstatResourceTreePath("path", {}, accessorIo), "invalid_input");
    expect(getterCalls).toBe(0);

    const controller = new AbortController();
    controller.abort();
    expectFailure(await lstatResourceTreePath("path", controller.signal, accessorIo), "io");
    expect(getterCalls).toBe(0);

    let calls = 0;
    expectFailure(
      await lstatResourceTreePath("path", controller.signal, {
        lstatPath: async () => {
          calls += 1;
          return stats();
        },
      }),
      "aborted",
    );
    expect(calls).toBe(0);

    expect((await lstatResourceTreePath("path", undefined, validIo)).ok).toBe(true);
  });

  it("requires one own data callback and normalizes hostile IO adapters", async () => {
    const inherited = Object.create({ lstatPath: async () => stats() });
    const malformed = [
      undefined,
      null,
      {},
      inherited,
      { lstatPath: 1 },
      new Proxy(
        {},
        {
          getOwnPropertyDescriptor() {
            throw new Error("descriptor trap");
          },
        },
      ),
    ];
    for (const io of malformed) {
      expectFailure(
        await lstatResourceTreePath("path", undefined, io as ResourceTreeLstatIo),
        "io",
      );
    }

    const transparent = new Proxy<ResourceTreeLstatIo>({ lstatPath: async () => stats() }, {});
    expect((await lstatResourceTreePath("path", undefined, transparent)).ok).toBe(true);
  });

  it("samples after both fulfillment and rejection before inspecting their values", async () => {
    const fulfilledController = new AbortController();
    let metadataTraps = 0;
    const hostileMetadata = new Proxy(
      {},
      {
        getOwnPropertyDescriptor() {
          metadataTraps += 1;
          throw new Error("metadata trap");
        },
      },
    ) as BigIntStats;
    expectFailure(
      await lstatResourceTreePath("path", fulfilledController.signal, {
        lstatPath: async () => {
          fulfilledController.abort();
          return hostileMetadata;
        },
      }),
      "aborted",
    );
    expect(metadataTraps).toBe(0);

    const rejectedController = new AbortController();
    expectFailure(
      await lstatResourceTreePath("path", rejectedController.signal, {
        lstatPath: async () => {
          rejectedController.abort();
          throw new Error("rejected after abort");
        },
      }),
      "aborted",
    );

    const invalidatedController = new AbortController();
    expectFailure(
      await lstatResourceTreePath("path", invalidatedController.signal, {
        lstatPath: async () => {
          Object.setPrototypeOf(invalidatedController.signal, null);
          throw new Error("rejected after invalidation");
        },
      }),
      "invalid_input",
    );
  });

  it("waits for in-flight work, then lets cancellation override its settlement", async () => {
    const controller = new AbortController();
    let settle: ((value: BigIntStats) => void) | undefined;
    const pending = lstatResourceTreePath("path", controller.signal, {
      lstatPath: () =>
        new Promise<BigIntStats>((resolve) => {
          settle = resolve;
        }),
    });
    expect(settle).toBeTypeOf("function");
    controller.abort("unobserved reason");
    settle?.(stats());
    expectFailure(await pending, "aborted");
  });

  it("normalizes callback failures before malformed metadata and returns no raw value", async () => {
    const secret = new Error("secret callback failure");
    for (const lstatPath of [
      () => {
        throw secret;
      },
      async () => {
        throw secret;
      },
    ]) {
      const result = await lstatResourceTreePath("path", undefined, {
        lstatPath: lstatPath as ResourceTreeLstatIo["lstatPath"],
      });
      expectFailure(result, "io");
      expect(JSON.stringify(result)).not.toContain("secret");
    }

    for (const metadata of [undefined, {}, { ...stats(), dev: 1 }]) {
      const result = await lstatResourceTreePath("path", undefined, {
        lstatPath: async () => metadata as BigIntStats,
      });
      expectFailure(result, "invalid_metadata");
    }
  });

  it("uses captured invocation, descriptor, freezing, sampling, and metadata producers", async () => {
    const descriptors = [
      [Reflect, "apply", Object.getOwnPropertyDescriptor(Reflect, "apply")],
      [Object, "freeze", Object.getOwnPropertyDescriptor(Object, "freeze")],
      [
        Object,
        "getOwnPropertyDescriptor",
        Object.getOwnPropertyDescriptor(Object, "getOwnPropertyDescriptor"),
      ],
    ] as const;
    let poisonCalls = 0;
    const poison = (): never => {
      poisonCalls += 1;
      throw new Error("live intrinsic used");
    };
    let result: ResourceTreeLstatResult | undefined;
    try {
      for (const [target, property, descriptor] of descriptors) {
        if (descriptor === undefined) throw new Error(`missing ${property}`);
        Reflect.defineProperty(target, property, { ...descriptor, value: poison });
      }
      result = await lstatResourceTreePath("path", undefined, {
        lstatPath: async () => stats(),
      });
    } finally {
      for (const [target, property, descriptor] of descriptors) {
        if (descriptor !== undefined) Reflect.defineProperty(target, property, descriptor);
      }
    }
    expect(result?.ok).toBe(true);
    expect(poisonCalls).toBe(0);
  });

  it("remains internal and contains no traversal or active-cancellation shortcut", async () => {
    const source = await readFile(
      new URL("src/validate/resource-tree-lstat.ts", repositoryRoot),
      "utf8",
    );
    for (const forbidden of [
      "Promise.race",
      "addEventListener",
      "throwIfAborted",
      ".reason",
      "node:path",
      "setTimeout",
    ]) {
      expect(source).not.toContain(forbidden);
    }

    const rootSource = await readFile(new URL("src/index.ts", repositoryRoot), "utf8");
    expect(rootSource).not.toContain("lstatResourceTreePath");
    expect(rootSource).not.toContain("ResourceTreeLstatResult");
    expect(rootSource).not.toContain("ResourceTreeLstatIo");
  });
});
