import { spawnSync } from "node:child_process";

import { describe, expect, it } from "vitest";

function moduleUrl(name: string): string {
  return new URL(`../dist/validate/${name}.js`, import.meta.url).href;
}

function runChild(script: string): void {
  const child = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
    timeout: 120_000,
  });
  if (child.error !== undefined) throw child.error;
  expect(child.status, child.stderr).toBe(0);
  expect(child.stdout).toContain("PASS");
}

const poisonHarness = `
const globalSnapshot = globalThis;
const definePropertySnapshot = Object.defineProperty;
const getOwnPropertyDescriptorSnapshot = Object.getOwnPropertyDescriptor;
const names = ["Object", "Array", "Number", "Reflect", "String"];
const originals = names.map((name) =>
  getOwnPropertyDescriptorSnapshot(globalSnapshot, name),
);
const getterCalls = [0, 0, 0, 0, 0];
const setterCalls = [0, 0, 0, 0, 0];
function installGlobals() {
  for (let index = 0; index < names.length; index += 1) {
    definePropertySnapshot(globalSnapshot, names[index], {
      __proto__: null,
      configurable: true,
      get() {
        getterCalls[index] += 1;
        throw new Error("poisoned global getter");
      },
      set() {
        setterCalls[index] += 1;
        throw new Error("poisoned global setter");
      },
    });
  }
}
function restoreGlobals() {
  for (let index = names.length - 1; index >= 0; index -= 1) {
    definePropertySnapshot(globalSnapshot, names[index], originals[index]);
  }
}
`;

describe("captured apply receivers", () => {
  it("keeps signal, destination, and directory-index operations off live constructors", () => {
    runChild(`
import assert from "node:assert/strict";
const abortModule = await import(${JSON.stringify(moduleUrl("abort-signal"))});
const destinationModule = await import(${JSON.stringify(moduleUrl("markdown-destination"))});
const nameModule = await import(${JSON.stringify(moduleUrl("resource-name-profile"))});
const indexModule = await import(${JSON.stringify(moduleUrl("directory-name-index"))});
${poisonHarness}
const signal = new AbortController().signal;
const profile = nameModule.profileObservedResourceName("guide.md");
assert.equal(profile.ok, true);
const profiles = [profile];
const invalidIndexValue = {};
let sampled;
let destination;
let indexed;
let reprofiled;
let negativeZero;
let invalid;
try {
  installGlobals();
  sampled = abortModule.sampleAbortSignal(signal);
  destination = destinationModule.classifyMarkdownDestination("docs/guide.md");
  indexed = indexModule.indexDirectoryNames(profiles);
  if (indexed.ok) {
    reprofiled = indexModule.reprofileDirectoryNameIndexEntry(indexed, 0);
    negativeZero = indexModule.reprofileDirectoryNameIndexEntry(indexed, -0);
  }
  invalid = indexModule.indexDirectoryNames(invalidIndexValue);
} finally {
  restoreGlobals();
}
assert.deepEqual(getterCalls, [0, 0, 0, 0, 0]);
assert.deepEqual(setterCalls, [0, 0, 0, 0, 0]);
assert.equal(sampled, "active");
assert.deepEqual(destination, {
  kind: "local",
  path: "docs/guide.md",
  components: ["docs", "guide.md"],
});
assert.equal(indexed.ok, true);
assert.equal(reprofiled.ok, true);
assert.equal(reprofiled.profile.exact, "guide.md");
assert.deepEqual(negativeZero, { ok: false, reason: "invalid_input" });
assert.deepEqual(invalid, { ok: false, reason: "invalid_input" });
process.stdout.write("sync receivers PASS\\n");
`);
  });

  it("keeps the inspected resource-session chain off live constructors", () => {
    runChild(`
import assert from "node:assert/strict";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
const rootModule = await import(${JSON.stringify(moduleUrl("skill-root"))});
const documentModule = await import(${JSON.stringify(moduleUrl("skill-document"))});
const captureModule = await import(${JSON.stringify(moduleUrl("resource-tree-capture"))});
const comparisonModule = await import(${JSON.stringify(moduleUrl("resource-tree-comparison"))});
const sessionModule = await import(${JSON.stringify(moduleUrl("resource-tree-session"))});
const pathIndexModule = await import(${JSON.stringify(moduleUrl("resource-tree-path-index"))});
${poisonHarness}
const directory = await mkdtemp(join(await realpath(tmpdir()), "skillpress-q0d-"));
const missingPath = join(directory, "missing");
const beforeCodes = [];
const beforeSink = { add(code) { beforeCodes.push(code); } };
const duringCodes = [];
const duringSink = { add(code) { duringCodes.push(code); } };
const missingCodes = [];
const missingSink = { add(code) { missingCodes.push(code); } };
try {
  await writeFile(join(directory, "SKILL.md"), "---\\nname: receivers\\n---\\n# Receivers\\n");
  await writeFile(join(directory, "resource.txt"), "resource body");
  const beforeRoot = await rootModule.inspectAgentSkillRoot(directory, beforeSink);
  assert.notEqual(beforeRoot, undefined);
  const document = await documentModule.inspectAgentSkillDocument(beforeRoot, beforeSink);
  assert.notEqual(document, undefined);
  const signal = new AbortController().signal;
  const resolveComponents = ["resource.txt"];
  let rootDuring;
  let missingRoot;
  let first;
  let second;
  let comparison;
  let opened;
  let current;
  let built;
  let resolved;
  try {
    installGlobals();
    rootDuring = await rootModule.inspectAgentSkillRoot(directory, duringSink);
    missingRoot = await rootModule.inspectAgentSkillRoot(missingPath, missingSink);
    first = await captureModule.captureInspectedResourceTree(document, signal);
    second = await captureModule.captureInspectedResourceTree(document, signal);
    comparison = comparisonModule.compareResourceTreeCaptureSemantics(first, second);
    opened = await sessionModule.openInspectedResourceTreeSession(document, signal);
    if (opened.ok) {
      current = await sessionModule.resourceTreeSessionIsCurrent(opened.session, signal);
      built = pathIndexModule.createResourceTreePathIndex(opened.session);
      if (built.ok) {
        resolved = pathIndexModule.resolveResourceTreePath(built.index, resolveComponents);
      }
    }
  } finally {
    restoreGlobals();
  }
  assert.deepEqual(getterCalls, [0, 0, 0, 0, 0]);
  assert.deepEqual(setterCalls, [0, 0, 0, 0, 0]);
  assert.equal(rootModule.isGenuineRootInspection(rootDuring), true);
  assert.equal(missingRoot, undefined);
  assert.deepEqual(duringCodes, []);
  assert.deepEqual(missingCodes, ["skill.root.missing"]);
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(comparison, "equal");
  assert.equal(opened.ok, true);
  assert.deepEqual(current, { ok: true, current: true });
  assert.equal(built.ok, true);
  const resource = opened.session.entries.find(
    (entry) => entry.layout.relativePath === "resource.txt",
  );
  assert.notEqual(resource, undefined);
  assert.deepEqual(resolved, { ok: true, entryIndex: resource.layout.entryIndex });
  process.stdout.write("resource receivers PASS\\n");
} finally {
  await rm(directory, { recursive: true, force: true });
}
`);
  });
});
