# Review 009t: validate bundled resource filenames

- Slice: `feat: validate bundled resource filenames`
- Review: independent contract, adversarial, release, and real-skill reviews
- Date: 2026-08-20
- Frozen base: `e3482101bc89be9a60c4280e0e80e4495a0e6e98`
- Final result: PASS

## Scope

This slice integrates the reviewed bundled-resource filename classifier into the existing retained
Markdown resource-tree transaction. It checks every observed regular resource-file basename,
including unlinked files, for conventional environment or credential-like names. It changes the
internal graph result and public validator orchestration, extends the existing internal diagnostic
adapter, adds focused tests, and clarifies the README.

It does not open another resource-tree session, walk the filesystem again, derive basenames from
paths, scan only Markdown-reachable files, or read unlinked file contents. It does not change the
public validator signature, report schema, public TypeScript types or declarations, root exports,
package export map, CLI,
configuration, schemas, resource-tree capture, session, path index, or the frozen classifier from
Review 009s.

The dependency direction remains acyclic:

```text
agent-skill -> markdown-resource-graph -> bundled-resource-name -> resource-name-profile
agent-skill -> markdown-resource-diagnostics -> markdown-resource-graph
markdown-resource-graph -> resource-tree-session -> skill-document
```

`skill-document` does not import the graph, and the legacy content reader remains outside the
public validation path.

## Result and authority contract

The internal graph result now requires a frozen `resourceFindings` array on both success shapes:
graphful `{ ok: true, documentText, resourceFindings, graph }` and graphless
`{ ok: true, documentText, resourceFindings }`. Failures remain `{ ok: false, reason }` and never
carry findings. A finding is the explicit union `{ kind: "environment_file", file }` or
`{ kind: "credential_file", file }`.

The array is present even when empty or when the lexical envelope produces graphless success. The
array and each finding are frozen and registered as one complete module-local inventory. The agent
accepts only an own-data inventory carrying that identity. Missing, inherited, accessor-backed,
cloned, proxy, foreign, or otherwise unauthenticated inventories fail closed through the existing
opaque `inconsistent` diagnostic; accessors and proxy traps are not observed.

Findings follow retained B entry order. Each regular resource-file contributes at most one finding;
directories and the root document are not classified. Repeated unsafe basenames are not deduplicated.
Only the bound canonical root-relative `file` is retained. The result does not expose a separate
basename, matched rule, suffix, content, error, absolute root, entry, session, or authority.

`resourceFindings` remains separate from `MarkdownResourceGraph.findings`. It does not modify the
graph surface, totals, budgets, `complete`, DFS semantics, or reference order. A graphless result and
both complete and incomplete graphs therefore carry the same whole-tree filename observation.

## Transaction and replay barriers

The existing B replay now snapshots each entry's own `layout.exactName`. The root document must have
both exact name and relative path `SKILL.md`. Every later bound-entry and final replay check verifies
the exact entry, layout, and metadata identities plus role, exact name, relative path, size, and kind.
The classifier receives only the retained exact name; it never receives a relative path or a derived
basename.

The fixed operation order is:

1. open and authenticate the existing resource-tree session;
2. replay the complete B inventory and create its path index;
3. classify every B entry whose role is `resource-file`;
4. revalidate the complete replay before the first Markdown member read;
5. read and analyze the root and recursively referenced Markdown files;
6. freeze an unpublished candidate result;
7. run the existing final-current check and final complete replay check;
8. publish only if every barrier succeeds.

Both the classifier and its genuine-result predicate are module-initialization snapshots. Each
synchronous call is followed by a signal checkpoint. Throws, non-genuine results, non-boolean
predicate approval, malformed results, and the classifier's `invalid_input` outcome collapse to
outer `inconsistent` before any member read. A full post-scan replay catches a later classifier that
mutates an earlier entry; its adjacent signal checkpoint retains abort/invalid-signal priority.

Valid findings are only staged. Root size/read/encoding failures, nested outer failures, aborts,
currentness failures, or final replay failures publish no document text, graph, or partial filename
finding. The existing final-current failure priority is unchanged.

No new budget is introduced. The scan inherits the existing limits of 8,192 total entries, 1,024
children per directory, depth 64, 255 UTF-8 bytes per name, and 8 MiB of aggregate relative paths.
Because one entry is the root document, at most 8,191 filename findings can be staged. No unlinked
file bytes are charged or read.

## Public diagnostics and admission

The internal adapter adds exactly two fixed `error` diagnostics in `skillpress` scope:

| Finding | Code | Message |
| --- | --- | --- |
| `environment_file` | `skill.resources.environment_file` | `skill resource tree must not contain environment files` |
| `credential_file` | `skill.resources.credential_file` | `skill resource tree must not contain credential-like files` |

The location contains only `{ file }`, without line or column. No match, basename copy, source text,
content, or absolute path is interpolated.

Admission order is root/document diagnostics, frontmatter and field diagnostics, filename findings,
then Markdown-reference findings. Final display order remains the collector's canonical sort. The
collector still admits the first 255 ordinary diagnostics and reserves the 256th slot for
`skill.diagnostics.truncated`; filename safety therefore cannot be displaced by a later flood of
missing references. Graphless Markdown and malformed YAML still receive filename findings.

A filename finding makes the public report invalid and prevents metadata publication regardless of
the graph's `complete` value. No redundant generic incomplete diagnostic is added.

## Authored verification

The focused selection passes three files and 94 tests. The new and extended cases cover:

- unlinked nested environment and credential files, repeated unsafe basenames, and identically named
  directories that remain allowed;
- complete and incomplete graphful successes plus graphless success, genuine/frozen inventory
  identity, cloned and proxy rejection, exact enumerable keys, deep freezing, and non-thenable barriers;
- the exact 8,192-entry inventory with 8,191 resource-file classifier calls, plus the
  255-byte and plus-one name boundaries;
- classifier and predicate throws, foreign or forged results, non-boolean approval, invalid results,
  signal priority, and zero downstream member reads/current calls;
- later callbacks mutating an earlier exact name, role, layout identity, source slot, or entries array,
  all stopped by the post-scan replay barrier before reading;
- classifier inconsistency before root too-large failure; valid staged findings discarded by root
  too-large, read, and final-current failures; and valid findings coexisting with graph budget findings;
- exact diagnostic code/message/scope/location, graphless and malformed-YAML admission, root then
  filename then reference cap priority, legacy-reader zero calls, and unchanged Markdown read counts;
- the hermetic property-tax shape with all six unlinked safe assets and scripts.

The shared final `npm run check` passes format, lint with warnings as errors, generated-file checks,
type checking, build, and 50 files / 629 tests. Global coverage is 95.69% statements, 94.38%
branches, 99.81% functions, and 97.27% lines. Changed-module coverage is:

| Module | Statements | Branches | Functions | Lines |
| --- | ---: | ---: | ---: | ---: |
| `agent-skill.ts` | 99.02% | 98.63% | 100% | 98.93% |
| `markdown-resource-diagnostics.ts` | 96.93% | 98.55% | 100% | 96.84% |
| `markdown-resource-graph.ts` | 92.39% | 90.90% | 100% | 95.91% |

## Independent adversarial and release review

A fresh adversarial reconstruction matched all seven frozen hashes. Its private 302-line oracle has
SHA-256 `2aae6e8ab33bd32ad60f5b8217a9db03dd7208e4879be768107f2717d4fa89f8` and passes four tests;
combined with the authored selection, four files / 98 tests pass. It directly poisons post-import
`WeakSet.prototype.add` and `.has`, Object statics, `Reflect.apply`, generator `next`, and Object and
Promise inherited-then surfaces with zero observations;
checks genuine, cloned, active-proxy, and revoked-proxy inventories; replays signal and producer
priority; mutates a previously scanned entry; and proves that final `changed` and graphless success
respect partial-publication and inventory-brand contracts.

Node.js 22.23.2, 24.19.0, and 26.7.0 each pass the focused 3-file / 94-test selection and full
50-file / 629-test suite; Node.js 26.7.0 runs the complete `npm run check`. Both the full dependency
audit and `npm audit --omit=dev` report zero vulnerabilities.

Bare packing produces 191 entries, 161,428 packed bytes, and 850,934 unpacked bytes. The npm SHA-1
is `b593bb0e8bc21a5a6780f3fa400d466467d65ba9`; the tarball SHA-256 is
`45dded798d3620c442576d8c67048d73c2914177ab88100fceab9b70f9df494c`. The tarball contains no
source or tests and carries the frozen README.

A freshly installed consumer passes runtime, CLI help/version, and root TypeScript checks on all
three Node versions. The root runtime exposes exactly 18 names, the package export map remains only
`.`, six internal runtime imports fail with `ERR_PACKAGE_PATH_NOT_EXPORTED`, and the internal graph
TypeScript import fails with `TS2307`. Consumer installation audits 42 packages with zero
vulnerabilities. The runtime oracle has SHA-256
`7485b510922affe44ac6a4726f44c368d1d3360a60d3e304397cebdd7ba8fd19`.

Clean base and candidate builds each contain 184 regular dist files. There are no added or removed
dist files; 173 are byte-identical and only the expected 11 agent, diagnostic, and graph artifacts
change. `dist/index.js` and `dist/index.d.ts` remain byte-identical to base, with SHA-256
`6cd258eebb405a6c42aff6c204febf3f5dccc75cd5ef926946d0686ea10f6b63` and
`204bf9749b3534803239bc2a9d542451c7b5cb8dad5755be263ba0846710a56e`.

## Real-skill holdout and boundaries

The external read-only property-tax repository remains clean at commit
`90965164c80fdc9e6209deccba85e2b64a1e0a60`. Across all three Node versions,
`resourceFindings` and graph findings are empty. The graph still has four documents, three root
edges at line 12 columns 6, 108, and 201, and totals of 4 files, 59,712 bytes, 1,872 nodes, 3 targets,
20 work units, 6 components, and 0 aliases. Public validation still returns only the existing
`skill.license.missing` warning and preserves exact metadata.

This policy recognizes conventional environment and credential-like filenames, including unlinked
files. It does not claim to detect secret content, renamed secrets, placeholders, executable
behavior, nested archives, caches, or packaging provenance. It does not read arbitrary binary
assets, and executable Python in the property-tax holdout remains allowed. Existing resource-tree
capture remains responsible for symlink and special-file rejection.

Private release-harness corrections were limited to a wrong exported TypeScript type name plus
missing explicit Node-types configuration, and a `pipefail` interpretation of the expected nonzero
`diff` result. Those checks were corrected and rerun on all affected Node versions. The private
adversarial oracle's first run passed three of four tests because its own token construction called
live `Object.freeze` after installing pollution; moving that harness-only construction before
pollution produced the frozen 4/4 result. npm also reported its existing blocked optional
`fsevents@2.3.3` install script; installation, build, and audits passed. None affected the shared
candidate or the property-tax repository.

## Frozen files

- `README.md`: `5215646dcf90a4a378f2d71698e5ac30e730f4a776a8df00213a75f0970add16`
- `src/validate/agent-skill.ts`:
  `b8a86c26f4f922f3bb25dfd732d12cbbc73bcda9e73c8ed42cd8a52ba1e88748`
- `src/validate/markdown-resource-diagnostics.ts`:
  `c7e2ce3574eff1ffafbebf6412927a59f8a6ca1c4eb92d5d4d2643f9ae07b3ba`
- `src/validate/markdown-resource-graph.ts`:
  `af620180229757e6d334d364ae355aef9c90fd8c13a90a3bd555d42ab0741dda`
- `test/agent-skill-validator.test.ts`:
  `24cde6315464c95b24f4b51d34f3e4339ed47931b40ff729d75f6320e7ecf001`
- `test/markdown-resource-diagnostics.test.ts`:
  `6af1551ee6005dbdb4a1133a27d3d92c675a8fc851bc35b4dc9f8f58efdf5742`
- `test/markdown-resource-graph.test.ts`:
  `9aa58ef90d51bff9badb152437bba1e9ae3423b8d2b8cb5a6f616c25d8a0b5f1`

The review record changes none of those files and adds no public export, schema, configuration,
filesystem authority, content read, network operation, or executable behavior.
