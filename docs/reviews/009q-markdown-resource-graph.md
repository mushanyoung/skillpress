# Review 009q: bounded Markdown resource graph

- Slice: `feat: traverse bounded Markdown resource graphs`
- Review: independent contract, release, and adversarial runtime reviews
- Date: 2026-08-20
- Frozen base: `f63f48866024f8bd27fbcd847375568fe69a5f7e`
- Final result: PASS

## Scope and API boundary

This slice adds one internal graph producer and its paired test. It does not change the validator,
root package exports, package export map, schemas, diagnostics, loader, or CLI. The internal module
exports seven limits, graph record types, the result/failure types, and one entry point:

```ts
buildInspectedMarkdownResourceGraph(
  documentValue: unknown,
  signalValue: unknown = undefined,
  ioValue: unknown = undefined,
): Promise<MarkdownResourceGraphResult>
```

The producer accepts only a genuine inspected document. It opens and retains its own genuine
two-pass resource-tree session; callers cannot supply a session, path index, entry, ordinal, old
document text, analyzer result, or IO context for later stages. Success is one of:

- `{ ok: true, documentText, graph }` when the current root envelope can be projected;
- `{ ok: true, documentText }` when the freshly read root has a lexical envelope failure that the
  existing parser must diagnose exactly once.

Failures use the fixed union `invalid_input | aborted | changed | invalid_inventory |
invalid_metadata | unsupported_kind | too_many_entries | too_deep | paths_too_large | too_large |
invalid_read | invalid_utf8 | inconsistent | io`. The API remains internal: none of its runtime
values or declaration types is re-exported from the package root, and the compiled internal
subpath is not exported.

## Transaction and authority model

The operation has one fixed transaction:

1. call the captured session opener and authenticate its native Promise;
2. replay every own dense B entry, retaining its exact entry, layout, and metadata identities plus
   role, ordinal, canonical relative path, size, and kind;
3. synchronously create the path index from that same session;
4. read the exact B document member, project only its body, and analyze it;
5. traverse local CommonMark link/image occurrences in source-order DFS;
6. fully freeze a private candidate result;
7. call session currentness exactly once, then revalidate the complete B replay before publishing.

Every actual Markdown member read rechecks the retained source array, exact slot and entry
identity, layout and metadata identities, entry index, path, role, size, and kind. Resolver success
must map back to that same B slot and exact canonical path. Final replay catches mutations in
unread files and content-only branches as well as files that were read. `current:false` and legal
current failures retain priority over the final replay check; `current:true` publishes only when
the whole replay is still intact.

This is deliberately not a new authority or snapshot brand. Session callbacks remain behavioral
capabilities, and final equality cannot provide `openat` containment, a filesystem transaction, or
protection against a same-metadata swap-away/read/swap-back sequence. The returned graph is a
bounded observation that was current at its final comparison, not reusable read authority.

## Graph semantics

The recursively frozen graph has the fixed surface `commonmark-links-images-v1` and enumerable
keys `surface`, `complete`, `documents`, `edges`, `reachableFiles`, `findings`, and `totals`.
Direct async results and the graph itself also carry a non-enumerable, non-writable,
non-configurable own `then: undefined` barrier.

Traversal is occurrence-preserving source-order DFS. Issues and targets are stably merged by usage
line/column, with an issue winning an exact tie. A local Markdown child is traversed immediately,
then traversal resumes at the parent's next event. Exact B ordinals use `unseen`, `gray`, and
`black` state: cycle, shared, and repeated edges are retained, but their member is never read or
analyzed twice. Documents are emitted in DFS preorder.

All local paths remain skill-root-relative, including destinations in nested Markdown files.
Regular files produce edges and first-discovery `reachableFiles` entries. Only `link` occurrences
whose resolved exact filename ends in ASCII case-insensitive `.md` recurse; images, including
images whose target ends in `.md`, and non-Markdown links are existence-checked but never read.
Directories produce `not_file` findings and no edge. Missing, noncanonical, ambiguous,
not-directory, invalid-destination, cycle, and shared outcomes are complete content observations;
they do not by themselves set `complete:false`.

The root analyzer receives only the freshly read envelope body. Root locations add
`bodyStartLine - 1`; nested Markdown starts at line one. Reference-style read/resolution findings
use the trusted definition destination location, while event order continues to use the usage
location. Findings never copy analyzer messages, raw URLs, source fragments, absolute paths,
metadata, entries, sessions, IO objects, or errors. `documentText` is the sole intentional raw
text field and always comes from the session member read used by this transaction.

## Limits and accounting

All limits are inclusive. The first plus-one operation leaves its counter unchanged, appends one
terminal budget finding, sets `complete:false`, stops the remaining DFS, and still performs final
currentness.

| Counter | Limit | Charge |
| --- | ---: | --- |
| Markdown files | 256 | first unseen recursive Markdown discovery, including root |
| Read bytes | 8,388,608 | trusted B size before each authorized Markdown read |
| Analysis nodes | 100,000 | accepted genuine analysis `nodeCount` |
| Source targets | 4,096 | every target occurrence before classification |
| Work | 131,072 | read/analyze calls, issues, classifiers, and `1 + components` per resolve |
| Local components | 8,192 | every local destination component before resolution |
| Alias candidates | 8,192 | complete trusted noncanonical/ambiguous candidate payloads |

Each Markdown file is independently capped at 512 KiB. Large non-Markdown resources and
directories retain their nonnegative bigint metadata without number conversion, byte charging,
or reads. Markdown read success must have bounded primitive text, exact UTF-8 byte length, and a
byte length identical to the retained B metadata size. Alias payloads are reserved before any
candidate slot is read and are bounded to 255 UTF-16 code units and 255 UTF-8 bytes each.

## Producer and cancellation barriers

Open, member-read, and currentness calls use captured functions with `undefined` receivers. Direct
returns must be non-proxy, current-realm native Promises with the exact captured Promise prototype
and safe own/prototype constructor data. Thenables, Promise subclasses, foreign Promises,
constructor accessors, proxies, raw records, throws, rejections, and malformed settlements are
fail-closed without reading or calling a public `then`.

The exported async driver has one `await`, used only after authenticating the just-returned
external Promise. All internal DFS and orchestration are synchronous generator routines advanced
with a captured generator `next`; there is no internal Promise adoption, `yield*`, or public
iterator lookup. Signal checkpoints sample before touching settled read/current values and after
every synchronous producer. Open is the sole exception: a strictly normalized legal open failure
is returned immediately so that the opener's own final priority is preserved.

The final refreeze also distinguishes the graph's fixed post-read checkpoint `invalid_input` from
a member producer's separate `invalid_input` record. The former remains outer `invalid_input`; the
latter is an impossible result for a bound genuine session/member and normalizes to
`inconsistent`. A stateful sampler regression fixes the exact sequence at three active samples,
then an invalid post-read sample, with one member read and zero currentness calls.

## Authored verification

The 1,556-line paired suite contains 14 high-density cases. It covers:

- a genuine real-filesystem session, exact root body projection, DFS preorder, root-relative
  nested links, a root cycle, shared Markdown, reference locations, images, non-Markdown files,
  missing content, raw-data absence, and recursive freezing;
- graphless lexical results, root limits, open failure priority, rejected Promise assimilation,
  hostile constructor/then accessors, and the stateful post-read signal classification;
- complete B replay before indexing, unrelated negative metadata priority, all nine retained
  identity/value bindings, unread final replay, and current-result priority;
- stable issue/target merging and ties, fatal versus duplicate Markdown issues, nested read
  findings, failure blackening, sibling continuation, cycle/share deduplication, and zero reads for
  image/non-Markdown targets;
- all seven budgets at exact and plus-one boundaries, their file/location anchors, single terminal
  finding, unchanged over-limit total, and mandatory final-current call;
- cancellation immediately after the session predicate, index, projector, analyzer, analysis
  predicate, classifier, component predicate, and resolver;
- hostile scalar/container bounds, alias slot-before-reservation traps, inherited numeric and
  optional-location accessors, captured generator stepping, and inherited `then` barriers.

Formatting, lint with warnings as errors, generated-file checks, type checking, build, focused
execution, coverage, and `git diff --check` pass. Focused execution passes one file and 14 tests.
The final module coverage is 91.94% statements, 90.57% branches, 100% functions, and 95.60% lines.
The production module is 1,247 lines and the paired test is 1,556 lines, both within their frozen
hard stops.

The shared final `npm run check` passes 48 files and 501 tests. Global coverage is 95.54%
statements, 94.14% branches, 99.80% functions, and 97.22% lines.

## Independent release review

A fresh private release reconstruction matched the original candidate hashes and found no other
contract or packaging blocker. After the one-line signal refreeze, independent static review
matched both final hashes and confirmed that only the graph-owned fixed failure changes route;
member-producer `invalid_input` still normalizes to `inconsistent`.

The final adversarial reconstruction passes tracked 48/501 and combined 49/502. The authored plus
private two-file selection passes 15 tests on Node.js 22.23.2, 24.19.0, and 26.7.0; the private
real-dist eight-scenario oracle passes on all three versions. Format, lint, generated-file checks,
type checking, build, and production dependency audit all pass; audit reports zero vulnerabilities.

Bare pack runs prepack/build and produces 183 entries, 154,081 packed bytes, and 811,799 unpacked
bytes. Its npm SHA-1 `shasum` is `b9808845b15e43bef49b46380b6bb31e246620f4`; the tarball SHA-256
is `35811903647b9eea166b54a80d31f740964dcf74404ec6bbb732e25e84cb7b0d`.

The fresh installed consumer retains exactly 18 root runtime exports. The seven graph limits plus
`buildInspectedMarkdownResourceGraph` are absent from the root runtime and declarations. The eight
graph declaration types are also absent. The package export map remains exactly `"."`, and exact
import of `@mushanyoung/skillpress/dist/validate/markdown-resource-graph.js` returns
`ERR_PACKAGE_PATH_NOT_EXPORTED`.

The root `dist/index.js` and `dist/index.d.ts` remain byte-identical to base, with SHA-256
`6cd258eebb405a6c42aff6c204febf3f5dccc75cd5ef926946d0686ea10f6b63` and
`204bf9749b3534803239bc2a9d542451c7b5cb8dad5755be263ba0846710a56e`. Relative to the base build,
the only new emitted files are `markdown-resource-graph.js`, `.js.map`, `.d.ts`, and `.d.ts.map`.

## Adversarial producer review

The final private Vitest oracle has SHA-256
`252cd8841b81dbf995c31b8129048c93d284f97b12a3c168250b5e721c5d9b04`. It verifies graph-owned
generator stepping, inherited Object/Promise `then` barriers, full graph success, zero hostile
getter observations, and deep freeze. Authored plus this oracle passes two files and 15 tests.

The real-dist oracle has SHA-256
`3f0551baca95f29e1dcae6e733577bc27b18de046a1034faeec24506059e0446`. Its eight scenarios cover
baseline behavior, captured driver stability, and post-initialization Object, Array, Number,
Reflect, String, and RegExp dependency pollution. Intrinsics not consumed by the retained parser
leave semantics unchanged. When the retained default `fromMarkdown` dependency graph does consume
a poisoned live intrinsic, the captured analyzer totalizes it to a genuine fixed parse issue; the
graph remains frozen, performs final currentness, sets `complete:false`, and exposes no raw error.

That fail-closed behavior preserves q0b's explicit producer trust boundary. This slice does not
claim that capturing `analyzeMarkdown` transitively hardens micromark/fromMarkdown or guarantees
baseline analysis under dependency pollution. Module initialization, retained session/index/
analyzer callbacks, and native producer Promises remain behavioral trust boundaries.

The graph covers CommonMark link and image targets only. Bare paths, inline/fenced code, raw HTML
`href`/`src`, script imports, and fragment anchor correctness remain outside this slice. Validator
integration and user-facing diagnostics are intentionally deferred to the next atomic slice.

## Frozen files

- `src/validate/markdown-resource-graph.ts`:
  `40a84a988e7b80f465a75cbc0ef5266a92910110212d99c850ca82896b8dfe8d`
- `test/markdown-resource-graph.test.ts`:
  `bf67281f5b4f74ef079caab28ed16a9d9ea23cbf9abe869efd4c22a4486bfaa6`

Only these implementation/test paths differ from the base. This later review record changes
neither frozen file and adds no root export, package subpath, schema, configuration, IO, diagnostic,
or authority.
