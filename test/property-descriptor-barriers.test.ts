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
  expect(child.status, child.stderr).toBe(0);
  expect(child.stdout).toContain("PASS");
}

const poisonHarness = `
const prototypeSnapshot = Object.prototype;
const definePropertySnapshot = Object.defineProperty;
const getOwnPropertyDescriptorSnapshot = Object.getOwnPropertyDescriptor;
const deletePropertySnapshot = Reflect.deleteProperty;
const pollutionKeys = ["get", "set", "value"];
const originalDescriptors = pollutionKeys.map((key) =>
  getOwnPropertyDescriptorSnapshot(prototypeSnapshot, key),
);
let poisonCalls = 0;
function installPollution() {
  for (let index = 0; index < pollutionKeys.length; index += 1) {
    definePropertySnapshot(prototypeSnapshot, pollutionKeys[index], {
      __proto__: null,
      configurable: true,
      get() {
        poisonCalls += 1;
        return undefined;
      },
      set() {
        poisonCalls += 1;
      },
    });
  }
}
function restorePollution() {
  for (let index = pollutionKeys.length - 1; index >= 0; index -= 1) {
    const descriptor = originalDescriptors[index];
    if (descriptor === undefined) deletePropertySnapshot(prototypeSnapshot, pollutionKeys[index]);
    else definePropertySnapshot(prototypeSnapshot, pollutionKeys[index], descriptor);
  }
}
`;

describe("system property-descriptor barriers", () => {
  it("keeps lexical, destination, and directory-index projections independent of pollution", () => {
    runChild(`
import assert from "node:assert/strict";
const skillSource = await import(${JSON.stringify(moduleUrl("skill-source"))});
const destinationModule = await import(${JSON.stringify(moduleUrl("markdown-destination"))});
const nameModule = await import(${JSON.stringify(moduleUrl("resource-name-profile"))});
const indexModule = await import(${JSON.stringify(moduleUrl("directory-name-index"))});
${poisonHarness}
const profile = nameModule.profileObservedResourceName("alpha.txt");
assert.equal(profile.ok, true);
const emptyAccessor = [];
definePropertySnapshot(emptyAccessor, 0, {
  __proto__: null,
  configurable: true,
  enumerable: true,
  get: undefined,
  set: undefined,
});
let envelope;
let destination;
let index;
let invalidAccessor;
try {
  installPollution();
  envelope = skillSource.projectSkillDocumentEnvelope("---\\n---\\nbody\\u0001");
  destination = destinationModule.classifyMarkdownDestination("docs/guide.md");
  index = indexModule.indexDirectoryNames([profile]);
  invalidAccessor = indexModule.indexDirectoryNames(emptyAccessor);
} finally {
  restorePollution();
}
assert.equal(poisonCalls, 0);
assert.deepEqual(envelope, { ok: false, reason: "control_character" });
assert.deepEqual(destination, {
  kind: "local",
  path: "docs/guide.md",
  components: ["docs", "guide.md"],
});
assert.equal(index.ok, true);
assert.equal(index.entries[0].exact, "alpha.txt");
assert.deepEqual(invalidAccessor, { ok: false, reason: "invalid_input" });
process.stdout.write("projection barriers PASS\\n");
`);
  });

  it("keeps the complete resource-session chain independent of pollution", () => {
    runChild(`
import assert from "node:assert/strict";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
const diagnosticsModule = await import(${JSON.stringify(moduleUrl("diagnostics"))});
const rootModule = await import(${JSON.stringify(moduleUrl("skill-root"))});
const documentModule = await import(${JSON.stringify(moduleUrl("skill-document"))});
${poisonHarness}
const sessionModule = await import(${JSON.stringify(moduleUrl("resource-tree-session"))});
const captureModule = await import(${JSON.stringify(moduleUrl("resource-tree-capture"))});
const comparisonModule = await import(${JSON.stringify(moduleUrl("resource-tree-comparison"))});
const pathIndexModule = await import(${JSON.stringify(moduleUrl("resource-tree-path-index"))});
const directory = await mkdtemp(join(await realpath(tmpdir()), "skillpress-q0c-"));
try {
  await writeFile(join(directory, "SKILL.md"), "---\\nname: descriptor\\n---\\n# Descriptor\\n");
  await writeFile(join(directory, "resource.txt"), "resource body");
  const beforeDiagnostics = new diagnosticsModule.DiagnosticCollector();
  const beforeRoot = await rootModule.inspectAgentSkillRoot(directory, beforeDiagnostics);
  assert.notEqual(beforeRoot, undefined);
  const document = await documentModule.inspectAgentSkillDocument(beforeRoot, beforeDiagnostics);
  assert.notEqual(document, undefined);
  const duringDiagnostics = new diagnosticsModule.DiagnosticCollector();
  let rootDuring;
  let fixedCapture;
  let fixedOpen;
  let first;
  let second;
  let comparison;
  let opened;
  let current;
  let resource;
  let read;
  let built;
  let resolved;
  try {
    installPollution();
    fixedCapture = await captureModule.captureInspectedResourceTree({});
    fixedOpen = await sessionModule.openInspectedResourceTreeSession({});
    rootDuring = await rootModule.inspectAgentSkillRoot(directory, duringDiagnostics);
    first = await captureModule.captureInspectedResourceTree(document);
    second = await captureModule.captureInspectedResourceTree(document);
    comparison = comparisonModule.compareResourceTreeCaptureSemantics(first, second);
    opened = await sessionModule.openInspectedResourceTreeSession(document);
    if (opened.ok) {
      current = await sessionModule.resourceTreeSessionIsCurrent(opened.session);
      resource = opened.session.entries.find(
        (entry) => entry.layout.relativePath === "resource.txt",
      );
      if (resource !== undefined) {
        read = await sessionModule.readResourceTreeSessionUtf8Member(opened.session, resource);
      }
      built = pathIndexModule.createResourceTreePathIndex(opened.session);
      if (built.ok) resolved = pathIndexModule.resolveResourceTreePath(built.index, ["resource.txt"]);
    }
  } finally {
    restorePollution();
  }
  assert.equal(poisonCalls, 0);
  assert.equal(rootModule.isGenuineRootInspection(rootDuring), true);
  assert.deepEqual(fixedCapture, { ok: false, reason: "invalid_input" });
  assert.deepEqual(fixedOpen, { ok: false, reason: "invalid_input" });
  const barrier = { configurable: false, enumerable: false, value: undefined, writable: false };
  assert.deepEqual(getOwnPropertyDescriptorSnapshot(fixedCapture, "then"), barrier);
  assert.deepEqual(getOwnPropertyDescriptorSnapshot(fixedOpen, "then"), barrier);
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(comparison, "equal");
  assert.equal(opened.ok, true);
  assert.deepEqual(current, { ok: true, current: true });
  assert.equal(resource.role, "resource-file");
  assert.deepEqual(read, { ok: true, text: "resource body", byteLength: 13 });
  assert.equal(built.ok, true);
  assert.deepEqual(resolved, { ok: true, entryIndex: resource.layout.entryIndex });
  process.stdout.write("resource chain PASS\\n");
} finally {
  await rm(directory, { recursive: true, force: true });
}
`);
  });
});
