# Review 009o: opaque resource-tree path indexes

- Slice: `feat: resolve root-relative paths in captured resource-tree sessions`
- Review: independent API, filesystem, bounds, and adversarial runtime reviews
- Date: 2026-08-20
- Frozen base: `e7502e1d1652e1c973836d483abc569748b3949e`
- Final result: PASS

## Scope and API

The new internal `resource-tree-path-index` module exports an opaque nominal
`ResourceTreePathIndex`, its build and resolution result types, and two synchronous operations:

- `createResourceTreePathIndex(session)` builds a private root-relative lookup projection from one
  genuine resource-tree session baseline.
- `resolveResourceTreePath(index, components)` resolves a fully validated component array without
  opening, resolving, or reading a filesystem path.

The build result is either `{ok: true, index}` or a fixed `invalid_input`/`inconsistent` failure.
Resolution returns an entry index on exact success; fixed `invalid_input` or `inconsistent`;
component-indexed `missing` or `not_directory`; or a frozen `noncanonical`/`ambiguous` alias result
whose exact candidates come from the retained trusted directory inventory.

The runtime index object is frozen and has no own public fields. A private module-owned `WeakMap`
binds only identities created by this module to their hidden projections. No brand predicate is
exported. Clones, lookalikes, proxies, revoked proxies, foreign module instances, and arbitrary
objects cannot acquire the brand through structure.

Neither the runtime operations nor their types are exported from the package root or through an
importable package subpath. The module adds no filesystem, process, network, signal, session-open,
or currentness operation.

## Genuine-session topology replay

Creation checks the genuine session brand before inspecting a session property. Once branded, it
reads only required own data through captured descriptor operations. It replays the root and every
directory inventory in exact UTF-16 sibling order using genuine `DirectoryNameIndex` identities
and ordinal reprofiling. Every name is reserved through one linear resource-tree layout budget,
and the replay must match the flattened session entries exactly in DFS preorder.

The replay verifies every layout field: zero-based entry ordinal, parent ordinal, depth, exact
name and bytes, and root-relative path and bytes. A child can own descendants only when its role is
`directory`; the exact root `SKILL.md` must be the sole `document`; nested `SKILL.md` entries and
other files must be `resource-file`. Every retained directory inventory must correspond one-to-one
with its flattened direct children, and the final cursor must consume the dense entry array with no
hole or remainder.

Reusing the one-shot layout producer also retains its global topology limits: the root is not an
entry, the tree has at most 8,192 entries, relative depth is at most 64, aggregate relative-path
bytes are at most 8 MiB, and duplicate logical paths are inconsistent. Each genuine directory
index is independently bounded to 1,024 names. The hidden child arrays and directory contexts are
frozen before the empty public index identity is registered; registration is the final build step.

## Request validation and unassigned names

Resolution checks the opaque index identity before touching the component value. A request must be
a current-realm, non-proxy, dense Array with an own data length from 1 through 64 and an own data
primitive string at every slot. Sparse arrays, accessors, inherited slots, foreign arrays, and
proxies are rejected without invoking their getters or traps.

Every component is first passed through the initialization-captured
`isCanonicalDecodedMarkdownLocalComponent` predicate from review 009o0. A lexical rejection is
`invalid_input`. An accepted component is then reprofiled by the captured resource-name producer.
A genuine successful profile must reproduce the exact spelling and UTF-8 byte length and report
NFC form. Malformed output, exceptions, `unsupported_runtime`, any contradictory failure, or a
successful profile with inconsistent fields becomes `inconsistent`.

One deliberate bridge handles safe Unicode scalars that the pinned profile table reports as
`unassigned`. A classifier-compatible example such as U+0378 becomes a private `IMPOSSIBLE`
sentinel, and its UTF-8 bytes are still counted through the captured Buffer operation. It is not
misclassified as bad caller input: traversal reports `missing` only if and when that sentinel is
the earliest unresolved component. Unsafe Unicode such as U+2065 is rejected earlier by
the canonical component predicate and therefore remains `invalid_input`.

The complete request is validated and copied before the first directory lookup. Thus a later NBSP,
unsafe scalar, separator, non-NFC spelling, or byte overflow wins over an earlier missing lookup or
`IMPOSSIBLE` sentinel. After full validation, traversal order wins normally: an earlier missing
name, noncanonical alias, or intermediate file can precede a later sentinel. Component spellings
are limited to 255 UTF-8 bytes, and the complete root-relative path is limited to 4,096 UTF-8 bytes
including literal slash separators; the exact bounds pass and a one-byte overflow fails.

## Exact and alias lookup

Each directory is resolved in exact, NFC, then fixed-fold order by the module-initialization-
captured genuine directory lookup producer. The wrapper accepts only strict own-data `ok`,
`reason`, `match`, and dense `exacts` fields. An accessor, proxy, invalid request, unknown match,
empty candidate array, or non-string candidate becomes `inconsistent` without invoking a getter or
exposing a producer value.

Before any exact, NFC, or fold result is returned, its nonempty `exacts` must be a strict ordered
subsequence of the current directory's trusted children. A single monotonic child cursor proves
membership and ordering in linear work, rejecting injected, repeated, reversed, or other-directory
names without a Set or pairwise comparison. Exact lookup additionally requires one candidate equal
to the request and a corresponding child. A singleton NFC/fold alias returns `noncanonical`; a
multi-candidate alias returns `ambiguous` with a copied frozen exact list. The implementation does
not independently rebuild NFC or fold groups during resolution; that semantic mapping remains a
trust boundary of the initialization-captured genuine lookup producer, while the local wrapper
binds every returned spelling to the current trusted directory.

An exact intermediate file returns `not_directory`. A directory is a valid final target and
returns its entry ordinal; role-specific rejection belongs to the later authorized reader or graph
layer. Every result and nested returned array is frozen, and failures contain no raw exception,
absolute path, session, callback, or hidden context.

## Non-authority boundary

The opaque brand proves only that this module successfully replayed one genuine session's retained
baseline. It does not prove that the filesystem is still current, turn an entry ordinal into an
open handle, authorize reading, establish openat-style containment, prevent swapback, or make a
path replacement atomic. A caller needing freshness must use the session/currentness and future
authorized-read protocols. Injected IO is absent from this slice.

Module initialization captures proxy detection, reflection, array and number predicates, Buffer
byte length, object freezing and own-slot definition, `WeakMap` operations, the genuine session
brand predicate, canonical component predicate, resource-name producer and brand predicate,
directory reprofile/lookup producers, and resource-tree layout producers. Post-import replacement
of their live properties does not redirect this module; the captured producers retain their own
reviewed transitive snapshots. This remains a module-initialization trust boundary and is not a
claim of pre-import pollution resistance.

## Authored verification

The authored focused selection is one file and seven tests. It covers real-session exact file and
final-directory resolution, exact/NFC/fold and ambiguous outcomes, full component validation and
byte/depth boundaries, safe and unsafe unassigned scalars, invalid-over-lookup priority, earlier
lookup-over-later-sentinel priority, opaque brand rejection, topology inconsistencies, malformed
and throwing producer normalization, alias candidate binding, intrinsic pollution, frozen output,
and the internal export boundary. All seven tests pass.

The tracked candidate's fresh complete gate passes 42 files and 457 tests. The path-index module
reaches 92.46% statements, 90.58% branches, 100% functions, and 96.92% lines. Formatting, lint,
generated-file freshness, type checking, build, coverage thresholds, and `git diff --check` pass in
the independent complete gates.

## API and real-filesystem review

The API reviewer reconstructed the frozen candidate in a fresh private snapshot and returned PASS
with zero blockers. It replayed the authored one-file, seven-test selection independently on
Node.js 22.23.2, 24.19.0, and 26.7.0; all seven tests passed on every version. Its tracked complete
gate passed 42 files and 457 tests.

That reviewer also ran one built-distribution real-filesystem scenario with 14 distinct
assertions. A fixture containing `SKILL.md` and `docs/guide.md` produced a genuine inspected root,
document, session, and opaque path index with no own keys. The scenario then verified final exact
directory success; U+0378 missing at root and below `docs`; an earlier ordinary missing and an
earlier `SKILL.md` file winning over a later sentinel; late U+2065 winning as `invalid_input` over
an earlier missing; late NBSP winning over an earlier U+0378 sentinel; and fake-index rejection
before a hostile components proxy with zero `get` or descriptor traps. These 14 assertions are a
separate real-filesystem scenario, not additions to the authored seven-test count or tracked
42-file, 457-test gate.

The API review reported zero production dependency vulnerabilities. Its bare `npm pack --json`
ran prepack and build successfully and produced 175 files, a 127,494-byte tarball, and 655,850
unpacked bytes. Its seven consumer checks confirmed the package version, absence of both runtime
functions from root own exports, absence of `ResourceTreePathIndex`, `createResourceTreePathIndex`,
and `resolveResourceTreePath` from the root declaration output, and
`ERR_PACKAGE_PATH_NOT_EXPORTED` for
`@mushanyoung/skillpress/dist/validate/resource-tree-path-index.js`.

## Adversarial review

The adversarial reviewer independently added one private file with four tests, SHA-256
`2b31625e025470d31a3412add691f886a45581d7a6f29d9779e2a3db48a52963`:

1. It established a genuine singleton-fold golden, then injected unknown, repeated, reversed,
   other-directory, and mixed alias candidates. Every malformed candidate set returned
   `inconsistent`. Accessors on each lookup field and a proxied candidate array had zero getter or
   trap calls, and failures disclosed no injected raw string.
2. It verified whole-request validation and the exact U+0378 `IMPOSSIBLE` ordering against missing,
   `not_directory`, and noncanonical outcomes; late NBSP, U+2065, and `#`; exact 255/256-byte,
   4,096/+1-byte, and 64/65-component boundaries; and malformed/nonboolean and throwing
   component-producer outcomes, plus throwing and unsupported profile outcomes.
3. It constructed a producer-reachable maximum tree with 1,024 root names, seven child directories
   of 1,024 names each, and exactly 8,192 entries, then built it and resolved child-1023 in the
   seventh full child directory. An
   8,193-slot genuine-mocked entry array failed before reading a slot, while a valid depth-64 empty
   directory built successfully and resolved as a final directory.
4. It checked the empty frozen opaque identity, fake/foreign/proxy boundaries, a genuine name index
   transplanted between directories, and one-at-a-time post-import pollution of the captured
   Reflect, Object, Array/iterator, Buffer, Number, RegExp/symbol, Set, String/iterator, WeakMap,
   proxy-detection, and URI-decoding capabilities. Build and exact resolution remained stable with
   zero poison calls.

The authored and private files together are two files and 11 tests. The adversarial reviewer ran
that combined selection independently on Node.js 22.23.2, 24.19.0, and 26.7.0; all 11 tests passed
on every version. Its tracked-only complete gate passed 42 files and 457 tests. With the private
file installed, the complete gate passed 43 files and 461 tests, and the path-index module reached
93.30% statements, 91.76% branches, 100% functions, and 96.92% lines.

The private four-test oracle is included only in the adversarial 43-file, 461-test gate and
two-file, 11-test Node matrix. It is not folded into the authored or API-reviewer counts.

The adversarial review independently reported zero dependency vulnerabilities and the same bare
pack result: prepack build success, 175 files, 127,494 packed bytes, and 655,850 unpacked bytes. Its
fresh consumer confirmed that `createResourceTreePathIndex`, `resolveResourceTreePath`,
`ResourceTreePathIndex`, `ResourceTreePathIndexBuildResult`, and
`ResourceTreePathResolutionResult` were absent from the package-root runtime and declaration
surfaces, and that the exact internal subpath import above failed with
`ERR_PACKAGE_PATH_NOT_EXPORTED`.

## Frozen files

The candidate is based on `e7502e1d1652e1c973836d483abc569748b3949e`. Its implementation
SHA-256 is `ad657e21a0aa8657c97ec227a7b1c046928c25e68bf392ebc64d0142850464a3`, and its targeted-test
SHA-256 is `9f253721b7d34b6c39be4b284ace501e6c50d8a04015c0af647c1c9b12312a80`.

The frozen implementation is 477 lines and its focused test is 730 lines. Both remain within the
reviewed slice limits. No package-root export, export-map entry, schema, documentation API, or
filesystem integration was added by the production slice.
