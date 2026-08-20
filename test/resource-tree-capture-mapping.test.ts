import { afterEach, describe, expect, it, vi } from "vitest";

const modulePaths = [
  "../src/validate/abort-signal.js",
  "../src/validate/directory-name-index.js",
  "../src/validate/directory-read.js",
  "../src/validate/file-metadata.js",
  "../src/validate/resource-tree-layout.js",
  "../src/validate/resource-tree-lstat.js",
  "../src/validate/skill-document.js",
  "../src/validate/skill-root.js",
] as const;

afterEach(() => {
  for (const path of modulePaths) vi.doUnmock(path);
  vi.resetModules();
});
describe("resource-tree capture failure mapping", () => {
  it("normalizes producer failures and impossible composition states without raw detail", async () => {
    const directoryMetadata = Object.freeze({
      dev: 1n,
      ino: 1n,
      mode: 0o40700n,
      size: 0n,
      mtimeNs: 1n,
      ctimeNs: 1n,
      kind: "directory" as const,
    });
    const fileMetadata = Object.freeze({
      ...directoryMetadata,
      ino: 2n,
      mode: 0o100600n,
      size: 1n,
      kind: "file" as const,
    });
    const root = Object.freeze({ path: "/root", metadata: directoryMetadata });
    const document = Object.freeze({ root, path: "/root/SKILL.md", metadata: fileMetadata });
    const names = Object.freeze({ entries: Object.freeze([{ exact: "SKILL.md" }]) });
    const profile = Object.freeze({
      ok: true as const,
      exact: "SKILL.md",
      exactByteLength: 8,
      nfc: "SKILL.md",
      key: "skill.md",
      isNfc: true,
    });
    const layoutRoot = Object.freeze({
      entryIndex: null,
      parentIndex: null,
      depth: 0,
      exactName: "",
      exactNameByteLength: 0,
      relativePath: "",
      relativePathByteLength: 0,
    });
    const state = {
      documentBrand: true,
      rootBrand: true,
      reader: "success" as string,
      reprofile: "success" as "success" | "failure" | "throw",
      reservation: "success" as string,
      lstat: "success" as string,
      badIndex: false,
      sampleThrows: false,
    };
    const actual = async (path: (typeof modulePaths)[number]) =>
      vi.importActual<Record<string, unknown>>(path);
    vi.doMock(modulePaths[0], async () => ({
      ...(await actual(modulePaths[0])),
      sampleAbortSignal: () => {
        if (state.sampleThrows) throw new Error("secret sample failure");
        return "absent";
      },
    }));
    vi.doMock(modulePaths[1], async () => ({
      ...(await actual(modulePaths[1])),
      reprofileDirectoryNameIndexEntry: () => {
        if (state.reprofile === "throw") throw new Error("secret profile failure");
        return state.reprofile === "success"
          ? { ok: true, profile }
          : { ok: false, reason: "inconsistent" };
      },
    }));
    vi.doMock(modulePaths[2], async () => ({
      ...(await actual(modulePaths[2])),
      readInspectedDirectoryNames: async () => {
        if (state.reader === "throw") throw new Error("secret reader failure");
        if (state.reader === "success") {
          return { ok: true, directory: { metadata: directoryMetadata }, names };
        }
        return state.reader === "name-index"
          ? { ok: false, reason: state.reader, failure: { ok: false, reason: "secret" } }
          : { ok: false, reason: state.reader };
      },
    }));
    vi.doMock(modulePaths[3], async () => ({
      ...(await actual(modulePaths[3])),
      sameFileSnapshot: () => true,
    }));
    vi.doMock(modulePaths[4], async () => ({
      ...(await actual(modulePaths[4])),
      createResourceTreeLayout: () => ({ root: layoutRoot, budget: {} }),
      reserveResourceTreeChild: () => {
        if (state.reservation !== "success") {
          return { ok: false, reason: state.reservation };
        }
        return {
          ok: true,
          budget: {},
          entry: {
            entryIndex: state.badIndex ? 1 : 0,
            parentIndex: null,
            depth: 1,
            exactName: "SKILL.md",
            exactNameByteLength: 8,
            relativePath: "SKILL.md",
            relativePathByteLength: 8,
          },
        };
      },
    }));
    vi.doMock(modulePaths[5], async () => ({
      ...(await actual(modulePaths[5])),
      lstatResourceTreePath: async () =>
        state.lstat === "success"
          ? { ok: true, metadata: fileMetadata }
          : { ok: false, reason: state.lstat },
    }));
    vi.doMock(modulePaths[6], async () => ({
      ...(await actual(modulePaths[6])),
      isGenuineDocumentInspection: () => state.documentBrand,
    }));
    vi.doMock(modulePaths[7], async () => ({
      ...(await actual(modulePaths[7])),
      isGenuineRootInspection: () => state.rootBrand,
      rootInspectionIsCurrent: async () => true,
    }));
    vi.resetModules();
    const capture = await import("../src/validate/resource-tree-capture.js");
    const io = {
      lstatPath: async () => fileMetadata,
      openDirectory: async () => {
        throw new Error("mock reader owns this operation");
      },
      rootIsCurrent: async () => true,
    } as capture.ResourceTreeCaptureIo;
    const run = () => capture.captureInspectedResourceTree(document, undefined, io);
    for (const badIo of [
      null,
      0,
      {},
      { lstatPath: io.lstatPath },
      { lstatPath: io.lstatPath, openDirectory: io.openDirectory },
    ]) {
      expect(
        await capture.captureInspectedResourceTree(
          document,
          undefined,
          badIo as capture.ResourceTreeCaptureIo,
        ),
      ).toEqual({ ok: false, reason: "io" });
    }
    expect(
      await capture.captureInspectedResourceTree(
        { ...document, path: "/root/not-SKILL.md" },
        undefined,
        io,
      ),
    ).toEqual({ ok: false, reason: "inconsistent" });
    state.documentBrand = false;
    expect(await run()).toEqual({ ok: false, reason: "invalid_input" });
    state.documentBrand = true;
    state.rootBrand = false;
    expect(await run()).toEqual({ ok: false, reason: "invalid_input" });
    state.rootBrand = true;
    state.sampleThrows = true;
    expect(await run()).toEqual({ ok: false, reason: "invalid_input" });
    state.sampleThrows = false;
    const readerReasons = {
      changed: "changed",
      "invalid-inspection": "inconsistent",
      "invalid-metadata": "invalid_metadata",
      "too-many-entries": "too_many_entries",
      "invalid-read": "invalid_inventory",
      "name-too-large": "invalid_inventory",
      "invalid-name-encoding": "invalid_inventory",
      "name-index": "invalid_inventory",
      io: "io",
      throw: "io",
    } as const;
    for (const [source, expected] of Object.entries(readerReasons)) {
      state.reader = source;
      expect(await run()).toEqual({ ok: false, reason: expected });
    }
    state.reader = "success";
    state.reprofile = "failure";
    expect(await run()).toEqual({ ok: false, reason: "inconsistent" });
    state.reprofile = "throw";
    expect(await run()).toEqual({ ok: false, reason: "inconsistent" });
    state.reprofile = "success";
    for (const reason of [
      "too_many_entries",
      "too_deep",
      "paths_too_large",
      "invalid_input",
      "invalid_state",
      "duplicate_path",
    ]) {
      state.reservation = reason;
      expect(await run()).toEqual({
        ok: false,
        reason:
          reason === "too_many_entries" || reason === "too_deep" || reason === "paths_too_large"
            ? reason
            : "inconsistent",
      });
    }
    state.reservation = "success";
    for (const reason of ["invalid_input", "aborted", "invalid_metadata", "io"]) {
      state.lstat = reason;
      expect(await run()).toEqual({ ok: false, reason });
    }
    state.lstat = "success";
    state.badIndex = true;
    expect(await run()).toEqual({ ok: false, reason: "inconsistent" });
  });
});
