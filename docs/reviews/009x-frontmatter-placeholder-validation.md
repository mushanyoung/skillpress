# Review 009x: validate frontmatter semantic placeholders

- Slice: `validate frontmatter placeholders`
- Review: independent contract, adversarial, compatibility, and release reviews
- Date: 2026-08-20
- Frozen base: `6892602738226dbafa11c6ffb464aa34b01e1134`
- Released candidate: `c1ad9906b707faa074bb4ea1efa440dbf8fee43a`
- Final result: PASS

This record is a later docs-only addition. It changes none of the three frozen candidate paths and
was not present in the verified 195-entry tarball.

## Scope and semantic authority

This B2 slice adds frontmatter placeholder diagnostics to the existing validator. It adds no
package-root JavaScript or declaration export, export-map entry, schema, configuration, CLI option,
graph field, session behavior, parser authority, filesystem read, network access, or execution.
The public API surface is unchanged; only validation results for placeholder-bearing fields change.

The authority is deliberately narrow. After strict YAML parsing, the validator classifies only the
complete decoded string scalar of `description`, then `compatibility`. It does not classify raw
YAML spelling, comments, keys, field names, `name`, `license`, `allowed-tools`, `metadata`, maps,
non-string values, or missing values. Markdown body text remains the separate B1 path. Quoted,
escaped, literal, and folded YAML are therefore judged by their decoded value, not source syntax.
An empty or whitespace-only decoded string remains a placeholder and can coexist with existing
required or length diagnostics.

Each finding uses the already-parsed key-start location. Before the first classifier callback, the
validator snapshots both eligible entries, decoded values, and locations. A callback cannot make a
later live `Map.prototype.get` part of semantic authority. The scan uses explicit fixed fields and
fixed result slots rather than live array iteration.

Both graph inventories must first pass their independent genuine predicates with literal
`=== true`; resource-inventory failure prevents even the placeholder-inventory predicate, and
either failure prevents all B2 classifier and predicate calls. Once both brands pass, the complete
B2 scan is staged before any nested mapper runs. Diagnostic admission remains:

1. root and ordinary frontmatter diagnostics;
2. resource-name diagnostics;
3. staged B2 frontmatter diagnostics;
4. B1 Markdown-body placeholder diagnostics; and
5. graph/reference diagnostics.

Final presentation still uses the collector's canonical location sort. At the 256-entry cap, the
golden admits one missing-name error, one resource finding, two B2 findings, 251 body findings, and
one truncation diagnostic; reference findings are not admitted.

## Classification trust and failure behavior

The module captures the 009u classifier, genuine-result predicate, `Reflect.apply`,
`types.isProxy`, and `Object.getOwnPropertyDescriptor` at initialization. The producer is called at
most twice. Its predicate is called once per returned classification and must produce literal
`true` before shape inspection. Active and revoked proxies are rejected property-free. Own data
`ok` and `reason` are each snapshotted once; accessors are never invoked.

Only `ok: true` with absent `reason` is safe. Only `ok: false` with reason `placeholder` creates a
finding. Producer or predicate throws, false or truthy-nonboolean predicates, foreign results,
clones, proxies, accessor-bearing or malformed shapes, and genuine `invalid_input` or `too_large`
are analysis failures.

If a later field fails after an earlier placeholder, both staged B2 findings are discarded. The
validator emits exactly one fixed error at the failing key and then continues B1 body and reference
mapping:

```text
code:     skill.frontmatter.placeholder_analysis
severity: error
scope:    skillpress
message:  frontmatter semantic text could not be analyzed safely
```

A successful placeholder classification maps exactly:

```text
code:     skill.frontmatter.placeholder
severity: error
scope:    skillpress
message:  frontmatter semantic text must not contain placeholders
```

Neither diagnostic retains the decoded scalar, raw YAML, classifier result, marker, match, error,
or cause. The README now describes the two decoded fields and keeps all other frontmatter material
outside this authority.

## Authored and independent verification

The focused validator selection passes one file and 19 tests on Node.js 22.23.2, 24.19.0, and
26.7.0. The full suite passes 52 files and 685 tests on all three versions. The matrix covers plain,
single-quoted, double-quoted escape, literal, folded, LF, and CRLF values; exact key locations;
blank-field coexistence; missing, non-string, malformed, and excluded-field zero-call cases;
description-before-compatibility order; graph-brand gating; atomic late failure; continued body and
reference diagnostics; raw absence; genuine, foreign, cloned, malformed, active/revoked proxy, and
accessor results; captured callbacks and intrinsics; exact cap priority; and post-callback poisoning
of `Map.prototype.get` and `Array.prototype[Symbol.iterator]`.

The shared authored gates passed targeted format, lint, strict TypeScript, focused execution, and
module coverage. The detached release at
`/private/tmp/skillpress-009x-release.Yd7Ydd/repo` independently passed the three-Node focused and
full matrices. Node 26 passed complete `npm run check`: format and lint covered 114 files, and
generated-file and type checks passed. Global coverage is 95.77% statements (4,922/5,139), 94.54%
branches (3,518/3,721), 99.82% functions (560/561), and 97.38% lines (4,424/4,543).
`agent-skill.ts` is 98.18% statements, 98.36% branches, 100% functions, and 98.65% lines.

Cold Node 26 installation added 122 packages. The only warning was the preexisting blocked,
unapproved optional `fsevents` install script not covered by `allowScripts`. Full and
production-only audits each reported zero vulnerabilities.

## Pack, consumer, and dist verification

Dry and actual packing agree: 195 entries, 169,949 packed bytes, and 900,622 unpacked bytes. The npm
SHA-1 is `cd9f354389d94fa7961b0656a4b621ab870a7edf`, tarball SHA-256 is
`4f024cc8c7cfb65515478c98cfdc42b002758bab5ed49cbdb2010b4e2fdf0e30`, and integrity is
`sha512-GgFpB/aX74XBla9GTPHbsO0PFpywwPJVrZsn0A02lt51mMvinO2DmvkomI20T/IAli57d9okZ/Q95P2Vv90oNw==`.

The fresh consumer at `/private/tmp/skillpress-009x-consumer.WQ49mz` added 41 packages and audited
with zero vulnerabilities. Node 18.20.8, 22.23.2, 24.19.0, and 26.7.0 each expose the same 18 root
runtime names and produce the exact two B2 diagnostics. Six tested internal subpaths fail with
`ERR_PACKAGE_PATH_NOT_EXPORTED`. CLI version remains `0.1.0`; help remains 17 lines with SHA-256
`9f7ed8f6bcb5174a067f9f94794347a3116a93c75d66d8117b6ec78c3fa1e016`. Strict NodeNext with
TypeScript 7.0.2 passes at the root, while the internal import fails exactly with `TS2307`. The
76-line runtime oracle SHA-256 is
`113f265f7e49da28965022ca47bd0f992f5f8601aa2ae686a681a73eeae39384`.

Fresh base and candidate builds each contain 188 regular dist files, three directories, and zero
special files. No paths are added or removed; 185 files are byte-identical. Only
`validate/agent-skill.js`, its source map, and its declaration map change. Package-root artifacts
remain byte-identical: `dist/index.js` is
`6cd258eebb405a6c42aff6c204febf3f5dccc75cd5ef926946d0686ea10f6b63`, and `dist/index.d.ts` is
`204bf9749b3534803239bc2a9d542451c7b5cb8dad5755be263ba0846710a56e`.

## Property holdout and private hostile oracle

The external property repository remains clean at
`90965164c80fdc9e6209deccba85e2b64a1e0a60`. Across Node 18, 22, 24, and 26, its public report has
SHA-256 `b78fa593ecf98ccc2b51aec95f683cc6cd112a4ce1f20608a3d161660a7c76a1` and only the existing
license warning. The decoded 934-code-unit description is genuine safe; compatibility is absent.
Its four-document graph remains complete with empty graph, resource, and placeholder findings;
three root edges occur at line 12 columns 6, 108, and 201, and totals remain four files, 59,712
bytes, 1,872 nodes, three targets, 20 work units, six components, and zero aliases.

The 90-line property oracle at `/private/tmp/skillpress-009x-holdout.gqQqAB/property-holdout.mjs`
has SHA-256 `5160a50f5902577d56b57807213b58bc9f60b0156c15ceb88b93ef44c8d1ebe6` and passes on Node 22,
24, and 26. The property repository is a read-only release holdout, not a source fixture, runtime
dependency, or CI dependency.

The 188-line hostile oracle in the same directory has SHA-256
`34c32d58c7ca67f8fbedf4d7fa8dc1defa55bbb7de53a0a8dc8744960afdae2d`. On all three supported
Node versions it verifies decoded forms, inventory-failure semantic zero-calls, two callback calls
under captured-intrinsic pollution, exactly one legitimate collector iterator call, atomic late
failure, continued B1 body/reference mapping, and raw-free output. Its harness-only compiled agent
copy differs from the candidate solely by two import specifiers that select private semantic and
graph wrappers; none of these artifacts ships.

## Harness incidents and frozen artifacts

All harness corrections were recorded and rerun:

- one read-only `npm --version` audit command ran from the shared cwd but performed no install,
  lifecycle, or write;
- an initial consumer skill under macOS `/var` correctly failed the symlink-root policy before the
  harness switched to canonical `/private/tmp`;
- the TypeScript consumer initially lacked consumer-local `@types/node` and passed after correction;
- a review consumer without its own `package.json` let npm walk upward and install under an
  unrelated `/private/tmp` root; a fresh isolated package/cache was created, dependency resolution
  was verified, and every affected check was rerun;
- a review zsh harness reused the reserved `path` variable, then switched to a task-specific name;
  and
- the separate hostile holdout initially used `os.tmpdir()` and reproduced the `/var` symlink
  rejection; it switched to explicit `/private/tmp` and reran all three Node versions.

None changed the candidate, shared checkout, or property repository. Frozen candidate artifacts:

- `src/validate/agent-skill.ts` — 385 lines —
  `2455e62d2ded04b944b30d2c3d4a8cbb5ae765f836674854c768b6410245c014`;
- `test/agent-skill-validator.test.ts` — 1,151 lines —
  `fa17cd18e790535507dbd0b581aadb3ee31e8f07ec3a35d616abfe625474496d`; and
- `README.md` — 69 lines —
  `5757649db3625ef81c6043922f99d0d3e64f6f3e8216b4717fb5b5268549a358`.

Relative to the base, production plus README grows by 113 lines, tests by 250, and the total by 363.
The candidate, release reconstructions, shared checkout before this docs-only addition, and
property repository all finished clean.
