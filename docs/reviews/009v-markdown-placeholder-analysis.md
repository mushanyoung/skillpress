# Review 009v: project Markdown placeholder findings

- Slice: `feat: project Markdown placeholder findings`
- Review: independent contract, adversarial, compatibility, and release reviews
- Date: 2026-08-20
- Frozen base: `26cc2188330203665906a5d49f151b97cc6f16b2`
- Candidate implementation: `4b0d754353291ae3359e9a9689fbb2332f57c507`
- Final result: PASS

This record will be added by amending the candidate, so the final commit identifier is intentionally
left to the root release owner. The three implementation/test artifacts and their hashes below are
already frozen.

## Scope and non-integration boundary

This A-slice extends the internal Markdown analyzer with one required enumerable field:

```ts
placeholderFindings: readonly MarkdownPlaceholderFinding[];
export interface MarkdownPlaceholderFinding {
  readonly location: MarkdownLocation;
}
```

It adds no package-root runtime or declaration export, export-map entry, schema, configuration,
CLI behavior, filesystem operation, or public diagnostic. The Markdown resource graph does not
consume `placeholderFindings`, and the validator does not yet report placeholders. A successful
internal analysis may contain findings, but this slice alone changes no user-facing validation
result. Public surface change is zero.

Success and failure analyses both own the field. Every failure publishes a fresh frozen empty
array. On success, the outer analysis, findings array, each location-only item, and its existing
frozen location are deeply frozen. Findings add no brand or property metadata; only the existing
analysis parent is registered in the module-private `WeakSet` provenance set.

## Semantic authority and reachability

The main iterative DFS carries a separate `semanticReachable` bit. Root starts `true`; a child is
reachable exactly when its parent bit is true and the parent type is one of `root`, `blockquote`,
`list`, `listItem`, `footnoteDefinition`, `table`, or `tableRow`. Only reachable `paragraph`,
`heading`, and `tableCell` nodes establish semantic blocks.

Children scheduled beneath a semantic block receive `false` in the main DFS. Consequently a
hostile nested paragraph, heading, or table cell cannot create a second block. Descendants smuggled
under `code`, HTML, or YAML likewise remain unreachable. Findings are appended once per classified
block in main DFS source order and use the block-start location.

This is syntax-aware authority inside the bounded, accepted parser-output projection, not
permission to classify raw Markdown or whole files. Code, `inlineCode`, HTML, YAML, URLs,
destinations, definitions, machine identifiers, and other non-visible fields remain outside
semantic input; the AST itself has no genuine-result brand.

## Visible semantic projector

Each authorized block is projected once:

- `text.value` is visible payload;
- nonempty `image.alt` and `imageReference.alt` are visible payload;
- absent, `undefined`, `null`, or empty alt contributes one U+0020 nonpayload boundary;
- `delete`, `emphasis`, `strong`, `link`, and `linkReference` are the only transparent containers;
- `break` contributes LF so placeholder grammar retains logical-line boundaries; and
- `inlineCode`, HTML, `footnoteReference`, and every other node kind contribute one U+0020 boundary
  without semantic inspection of their value, URL, identifier, or children.

The empty-alt boundary prevents `TO` plus an empty image plus `DO` from becoming `TODO`. Transparent
formatting still permits `TO` plus formatted `DO` to form the intended visible token. A block made
only from boundaries, LF, empty text, or empty alt has no nonempty authorized payload and invokes
the classifier zero times.

Heading extraction performs display and semantic projection in one bounded traversal. Each
projected type, value, or alt is read once and its shared scalar occurrence is debited once for that
dual traversal. Existing heading display text, leaf short-circuits, the independent heading
occurrence budget, and the exact 8 Mi-code-unit shared scalar boundary remain unchanged. An
unreachable heading still receives its legacy display projection but no semantic classification.

## Bounds, classifier trust, and failure behavior

Semantic projected occurrences have a global inclusive limit of 20,000. Complete children lengths
are reserved before any slot is inspected; shared and cyclic objects are charged per occurrence.
The main-node and heading counters remain independent. Each block is also capped at 524,288 UTF-16
code units. Plus one, including aggregate or astral input, produces complexity at block start with
the exact message `Markdown semantic text exceeds 524288 UTF-16 code units`.

The analyzer captures the 009u classifier, its genuine-result predicate, and `Reflect.apply` at
module initialization. The predicate must return literal `true`. A genuine safe result adds
nothing; a genuine placeholder adds only `{ location }`; and genuine `too_large` maps to the same
semantic complexity failure. Producer throws, genuine `invalid_input`, foreign results, clones,
proxies, forged or accessor-bearing records, and false, nonboolean, or throwing predicates map to
the fixed parse failure without exposing producer detail.

Findings are staged until the whole analysis succeeds. Any later parse, node, scalar, semantic,
definition, or target failure discards them by publishing the normal failure analysis with an empty
array. Existing nonfatal duplicate-definition issues can coexist with a successful finding.

The semantic projection and classification are transient. Findings retain no source text, alt,
heading, match, reason, offset, URL, identifier, error, or cause. A secret-bearing paragraph
serializes only its location finding. The paired test also seeds and immediately snapshots all 19
legacy RegExp canonical/alias slots around custom-AST analysis; none changes.

## Authored verification

The authored four-file selection passes 72 tests: the 009u primitive, existing Markdown analysis,
analysis hardening, and the new eight-test paired suite. It covers real-parser formatting, links,
images, hard breaks, exact source order, every transparent type, outer reachability, table cells,
empty-alt barriers, hostile ancestry, nested-segment suppression, the property holdout, exact and
plus-one UTF-16 limits, 20,000-occurrence reservation, shared/cyclic objects, captured classifier
exports, hostile producers and predicates, late failure clearing, deep freeze, exact item shape,
raw absence, and RegExp-state preservation.

Targeted format, lint, TypeScript `--noEmit`, build, focused execution, coverage, and
`git diff --check` pass. Markdown-analysis coverage is 93.46% statements (429/459), 91.58%
branches (359/392), 100% functions (38/38), and 97.43% lines (380/390).

## Independent release verification

Release reconstruction used the detached candidate at
`/private/tmp/skillpress-009v-release.uQ0E0d/repo`. Node.js 22.23.2/npm 10.9.8,
24.19.0/npm 11.17.0, and 26.7.0/npm 11.19.0 each pass the focused two-file / 17-test selection and
the full 52-file / 677-test suite. Node 26 also passes the private detached candidate's complete
`npm run check`: format and lint cover 114 files, and generated-file and type checks pass. The full
and production-only audits separately report zero vulnerabilities.

Cold Node 26 installation added 122 packages and audited 123 with zero vulnerabilities; its only
warning was that the optional `fsevents` install script was not yet covered by `allowScripts`; it
remained blocked and unapproved. Global coverage is 95.77% statements (4,823/5,036), 94.49%
branches (3,450/3,651), 99.81% functions (550/551), and 97.37% lines (4,339/4,456). The
analysis-module percentages match the authored focused values above.

Dry and actual bare packing agree: 195 entries, 167,497 packed bytes, and 885,074 unpacked bytes.
The npm SHA-1 is `1645d2db2988cf8c28cab920e627940ed8e1b62e`, tarball SHA-256 is
`d26078137464c2bb490a6b883b7c3a45250c45dc1a0caace54ef3dbfe53bf128`, and integrity is
`sha512-SFtOnFXVlGaSltHywjIWX71ad7HnEzNNJ+cjoQnPleN2QP5a35mBes7JsbhI/Myt5lUMr/o6T6qWRPbQrFHZDg==`.

The fresh consumer at `/private/tmp/skillpress-009v-consumer.CJA8PN` retains 18 root runtime
exports. Node 18.20.8 root checks pass; the official Node 18.20.8 darwin-arm64 archive SHA-256 is
`bae4965d29d29bd32f96364eefbe3bca576a03e917ddbb70b9330d75f2cacd76`. Strict NodeNext with
TypeScript 7.0.2 passes, Node 26 CLI help and Node 18 version checks pass, both relevant internal
subpaths return `ERR_PACKAGE_PATH_NOT_EXPORTED`, and root JavaScript/declarations contain no
placeholder symbol.

The clean dist comparison at `/private/tmp/skillpress-release-diff.3Q4g4K` gives base and candidate
188 regular files, three directories, and zero special files. There are no added or removed files;
184 files are byte-identical and only `markdown-analysis.{js,js.map,d.ts,d.ts.map}` changes.
`dist/index.js` remains SHA-256
`6cd258eebb405a6c42aff6c204febf3f5dccc75cd5ef926946d0686ea10f6b63`, and `dist/index.d.ts`
remains `204bf9749b3534803239bc2a9d542451c7b5cb8dad5755be263ba0846710a56e`, both identical to base.

## External property holdout and private oracle

The external property repository is clean at `90965164c80fdc9e6209deccba85e2b64a1e0a60`.
Its four reviewed file SHA-256 values are:

| File | SHA-256 |
| --- | --- |
| `SKILL.md` | `9659ee938b816ce1447709615189e8a22c1f3404846062ea2c4eec2538a5aa27` |
| methodology | `106b4f3c58a0715723d6eeb1b4636fef2686ad12673413a846a1d00d5e554d87` |
| appeal routes | `ae29ba79b0f12d5c4a363b2199fbaf2d6d8d33ff5b9f4966a9c5eeb27af14e02` |
| case schema | `ce703c5e75f72f9cef34546c25b0f9137e0e64a0b6d0a9f899165b4b3d161fa9` |

Its graph has four documents, empty graph/resource findings, three root edges at line 12 columns 6,
108, and 201, and totals of four files, 59,712 bytes, 1,872 nodes, three targets, 20 work units,
six components, and zero alias candidates. Direct full-source analysis of the four files has empty
`placeholderFindings` and issues, with node counts 355, 483, 166, and 871; the graph's root-body
analysis has 352 nodes. A stable public report has SHA-256
`b78fa593ecf98ccc2b51aec95f683cc6cd112a4ce1f20608a3d161660a7c76a1` on all three Node versions;
only the known license warning appears, and the description is 934 characters.

This repository is a read-only release holdout, not a source import, fixture, submodule, runtime
dependency, or CI dependency. Empty holdout findings are compatibility evidence, not validator
integration.

The private 149-line oracle at `/private/tmp/skillpress-009v-oracle.igixQN/oracle.mjs` has SHA-256
`5341ce2a29c75ebd26d944df96516b31a8e1cdb06fc5952c1655e93f44e61055`. Its five suites pass on
all three Node versions with `pollutionCalls: 0`. It is not shipped or counted among the authored
72 or tracked 677 tests.

## Harness corrections and shared-workspace status

Release harness corrections were transparent: one unmatched `~/.nvm` glob; an initial Node 26 PATH
that selected npm 12.0.2, whose tests passed before the complete explicit npm 11.19.0 rerun; a
TypeScript consumer that first omitted `@types/node` and then `types: ["node"]`; and a first
property invocation that returned the expected `skill.document.missing` because the harness
mistakenly supplied the repository root instead of the skill path. Each affected check was
corrected and rerun exactly.

The candidate, shared checkout, and property repository finished clean. The release lane performed
zero writes and zero npm operations in the shared checkout.

## Frozen artifacts

- `src/validate/markdown-analysis.ts` — 1,052 lines —
  `e8638ae029f6d478d712b3387b66bdb7dcb35535a46508217e9d7d824c33c781`
- `test/markdown-analysis-hardening.test.ts` — 528 lines —
  `12585eb9f5e0972e6c110ee57023568e81a88d0e76104af53e77a9b38eddf067`
- `test/markdown-placeholder-analysis.test.ts` — 380 lines —
  `dcb17850be709a1f2f83b3e81cfe17a2a9597c15d061394983792740051f2cc6`

This review record changes none of the three frozen artifacts and does not add graph consumption,
validator diagnostics, or a public export.
