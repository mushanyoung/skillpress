# Review 009q0b: Markdown-analysis hardening

- Slice: `refactor: harden Markdown AST analysis`
- Review: independent design, compatibility, and adversarial runtime reviews
- Date: 2026-08-20
- Frozen base: `5b5071e1af2698da8b05334f1f43786cb4fb11cc`
- Final result: PASS

## Scope and internal API

This slice hardens the existing synchronous Markdown analyzer in
`src/validate/markdown-analysis.ts`. The existing entry point and its result shape remain
unchanged:

```ts
analyzeMarkdown(source: string, parseMarkdown?: (source: string) => Root): MarkdownAnalysis;
```

It adds one scalar-work limit and one internally exported module-instance identity predicate:

```ts
export const MAX_SKILL_MARKDOWN_AST_SCALAR_CODE_UNITS = 8 * 1024 * 1024;

export function isGenuineMarkdownAnalysis(value: unknown): value is MarkdownAnalysis;
```

Every early and normal result is deeply frozen and registered in a private captured WeakSet.
`isGenuineMarkdownAnalysis` is a property-free module-instance identity check: ordinary clones,
spread copies, structured clones, foreign module-instance results, functions, proxies, and
revoked proxies do not pass. It does not inspect or invoke the candidate and does not add a
runtime brand property.

The brand proves only that this module instance produced the inert analysis. It does not prove
filesystem provenance, document identity, session membership, currentness, containment,
freshness, destination safety, or authority to open a referenced resource. Neither the predicate,
the new constant, nor the existing analyzer was added to the package root or export map. The
operation is synchronous and does not add an async `then` barrier.

## Hardened AST projection

The analyzer retains the parser function once at module initialization and calls the selected
parser at most once, after the existing source-byte and syntax-marker gates. Its returned AST is
treated as a hostile producer value. Root and node records must be current-realm, non-proxy plain
objects. Children must be current-realm, non-proxy arrays with safe dense own data slots; node,
position, start, and semantic fields used by the analyzer must be own data. Missing required
fields, accessors, inherited values, holes, foreign objects, proxies, revoked proxies, malformed
coordinates, and producer exceptions fail closed as the fixed parse analysis without exposing raw
AST values or exception details.

The accepted node-type vocabulary is the installed mdast union: `root` plus the 25 entries in
`RootContentMap`. Extension-only fields that the analyzer does not consume remain ignored. Fields
are projected only when needed for existing output: definition and target identifiers and URLs,
reference type, heading depth, and heading-visible text or image alt text. Optional image alt
retains the prior `null`/`undefined`/absent-as-empty behavior. Position defaults to line 1, column 1
when absent; a supplied position must contain bounded positive safe-integer coordinates.

Each children array reserves its whole occurrence count before any slot is inspected. If the
reservation exceeds the node budget, complexity wins without reading slot zero. Otherwise every
slot is copied only after an own-data check and a current-realm plain-record check; all slots pass
that container-integrity phase before the caller schedules or projects any child. That prevents a
valid-looking early node from producing partial semantic output before a hostile late container
slot is discovered. Semantic fields are deliberately not pre-read during this phase, preserving
the established DFS priority between earlier scalar failures and later plain-record semantic
failures.

Internal dense-slot descriptors have null prototypes and explicit data fields. Projected nodes
pre-own `children`, `url`, `identifier`, `referenceType`, and `depth`, and fixed projection
failures pre-own `location: undefined`. These details prevent inherited Object-prototype getters
or setters from redirecting projection, assignment, failure dispatch, or array-slot definition.

## Bounds and preserved semantics

The analyzer enforces these independent limits:

- source length: at most 512 × 1,024 UTF-16 code units and at most 512 KiB when UTF-8 encoded;
- syntax markers: 8,192;
- main scheduled AST occurrences: root one plus complete children lengths, at most 20,000;
- heading-text descendant occurrences: a separate global counter, at most 20,000;
- one actually accessed semantic scalar: at most 512 KiB UTF-16 code units;
- all actually accessed semantic scalar occurrences: at most 8 MiB UTF-16 code units;
- reference definitions: 1,024; and
- link and image targets: 1,024.

Shared and cyclic objects are charged on every occurrence rather than by identity. Heading
projection has its own occurrence counter, so nested or cyclic heading content cannot consume an
unbounded second traversal while remaining under the main schedule. During heading-text
projection, text, inline code, image, image-reference, raw-HTML, and break leaves preserve the prior
behavior and do not descend through hostile extra children. Scalar accounting occurs on every
actual access before values are joined, copied into maps, or exposed.

Target source order, first-definition selection, duplicate-definition diagnostics, unused
definitions, heading text, CR/LF/CRLF line counts, source coordinates, and the existing JSON shape
remain unchanged. Reference targets retain the identity invariants that
`target.definition === definitions[index]` and
`target.destinationLocation === target.definition.location`; inline targets retain location and
destination-location identity. Public arrays, records, locations, targets, definitions, headings,
issues, and the outer analysis are frozen.

Module initialization captures the analyzer's own Reflect, Buffer, Object, Array, Number, Map,
Set, WeakSet, String, and proxy-detection capabilities. Traversals use numeric loops and captured
own-slot definition rather than live iterators or array stack helpers. This boundary covers the
analyzer's projection and result construction, but it does not transitively harden the retained
`mdast-util-from-markdown` implementation. That dependency may still consult its own live
intrinsics. If it throws, the analyzer catches the exception and returns a genuine, frozen,
raw-free parse failure; the slice does not claim that arbitrary post-import pollution leaves the
default parser's successful semantics unchanged.

## Authored verification

The authored focused selection is two files and 24 tests: the 15 existing Markdown-analysis tests
and nine new hardening tests. It covers genuine identity and deep freezing; hostile records,
arrays, positions, fields, proxies, revoked proxies, foreign objects, holes, and accessors; exact
and plus-one main, scalar, source, syntax, definition, and target limits; bounded cyclic heading
projection; shared and cyclic occurrences; children-reservation and late-slot priority; inherited
optional-field, failure-field, and descriptor pollution; captured-intrinsic stability; retained
default-parser failure normalization; and the property-tax fixture's three CommonMark links while
six inline-code resource mentions remain inert.

Formatting, lint, type checking, focused execution, coverage, and `git diff --check` pass. The
focused module reaches 93.44% statements (328/351), 91.76% branches (245/267), 100% functions
(34/34), and 96.98% lines (290/299). The production file is 807 lines and the new focused test is
483 lines.

## Design, compatibility, and release review

The design reviewer reconstructed the two frozen files over the exact base in a fresh private
snapshot, verified both SHA-256 values, and returned PASS with zero blockers. Its tracked complete
`npm run check` passed 45 files and 483 tests.

An old/new compatibility differential compared 14 crafted inputs, 50,000 deterministic seeded
inputs, and the JSON analysis of 57 repository Markdown files. Candidate and base produced zero
JSON differences. These differential cases are separate from the authored 24 tests and the
tracked 45-file complete gate.

The exact authored two-file, 24-test selection passed on Node.js 22.23.2, 24.19.0, and 26.7.0. The
production dependency audit (`npm audit --omit=dev`) reported zero vulnerabilities. A bare
`npm pack --json` executed prepack and build successfully and produced 179 entries, a 138,803-byte
tarball, and 724,440 unpacked bytes.

The candidate and base package-root distribution files remained unchanged, and the installed
consumer retained version `0.1.0` and the existing root surface. The internal analyzer names were
absent from root runtime and declaration surfaces, and importing the exact
`@mushanyoung/skillpress/dist/validate/markdown-analysis.js` subpath returned
`ERR_PACKAGE_PATH_NOT_EXPORTED`.

## Adversarial review

The adversarial reviewer independently reconstructed the frozen candidate and returned PASS with
zero blockers. Its private Vitest file has SHA-256
`61a5cc8923e2f92a15d09685b3c0a94cc7ac5e1f0aae51a7bcaf930b04c7dbf3` and expands to ten tests:

1. inherited Object-prototype `get` and `set` descriptor pollution was ignored in two parameterized
   cases;
2. the independent heading-occurrence budget accepted its exact boundary and rejected plus one;
3. an overflowing children reservation returned complexity without reading slot zero;
4. inherited setters for `children`, `url`, `identifier`, `referenceType`, and `depth` were ignored
   across five parameterized cases while normal heading and target semantics remained exact; and
5. an inherited failure `location` getter was not read during scalar overflow and leaked no raw
   value.

The authored and private selections together passed three files and 34 tests. That exact combined
selection passed on Node.js 22.23.2, 24.19.0, and 26.7.0. The tracked-only complete gate passed 45
files and 483 tests; the separate complete gate including the private file passed 46 files and 493
tests. The private ten tests are not part of the authored 24 or the tracked-only complete count.

Tracked-only global coverage was 96.06% statements, 94.72% branches, 99.78% functions, and 97.44%
lines; the Markdown-analysis module retained 93.44%/91.76%/100%/96.98%. With the private oracle,
global coverage was 96.09%/94.80%/99.78%/97.47%, and the module reached
93.73%/92.50%/100%/97.32%.

A separate deterministic old/new script compared 10,000 generated Markdown sources with zero
JSON differences. A second private script loaded two module instances and confirmed that each
accepted only its own analyses; cross-instance reports and a hostile proxy were rejected, with
zero proxy traps. These scripts are separate from the private ten Vitest tests and both complete
gate counts.

The adversarial review's `npm audit --omit=dev` found zero production dependency vulnerabilities
and reproduced the same bare pack result: prepack/build success, 179 entries, 138,803 packed bytes,
and 724,440 unpacked bytes. Its installed consumer confirmed that these four runtime names were
absent from the package root: `analyzeMarkdown`, `isGenuineMarkdownAnalysis`,
`MAX_SKILL_MARKDOWN_AST_NODES`, and `MAX_SKILL_MARKDOWN_AST_SCALAR_CODE_UNITS`. These six names
were absent from root declarations: the same four plus `MarkdownAnalysis` and `MarkdownTarget`.
The exact internal analyzer subpath returned `ERR_PACKAGE_PATH_NOT_EXPORTED`.

## Shared-workspace note

During the adversarial review, the reviewer accidentally ran one `npm run build` command in the
shared workspace. It rebuilt only ignored distribution output. The root agent immediately
verified that HEAD, tracked status, both frozen candidate SHA-256 values, and `git diff --check`
were unchanged. All other adversarial installation, build, test, differential, package, and
consumer work was performed in private temporary space. The accidental build is recorded
transparently and is not counted as a shared complete gate or as a source change.

## Follow-up boundary

The planned 009q0c system property-descriptor backfill is a separate follow-up slice. Its schema
or descriptor work is not implemented, tested, or claimed by 009q0b and is not mixed into the
009q0b hashes or evidence.

## Frozen files

The candidate is based on `5b5071e1af2698da8b05334f1f43786cb4fb11cc`. Its frozen SHA-256
values are:

- `src/validate/markdown-analysis.ts`:
  `33d241775c3ca24079ab1ac71b0d6b6b562fbc679a43fe57c9defb4cd7af3ee4`
- `test/markdown-analysis-hardening.test.ts`:
  `ec34ee859b43efe4ed023a9d5a8ce5b3ad2bddef959ff3f00a6cd91a8fcd677b`

Only those two frozen candidate paths differ from the base. The later review record does not alter
their contents. No package-root export, package export-map entry, schema, configuration option,
filesystem operation, session operation, destination classification, or authority surface was
added.
