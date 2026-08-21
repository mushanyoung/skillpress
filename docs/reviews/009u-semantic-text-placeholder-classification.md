# Review 009u: classify semantic-text placeholders

- Slice: `feat: classify semantic-text placeholders`
- Review: independent contract, adversarial, and release reviews
- Date: 2026-08-20
- Frozen base: `7459febd0060c39472c21353652ba96a39ef9033`
- Final result: PASS

## Scope and authority boundary

This slice adds one pure internal primitive that classifies a caller-authorized, complete visible
semantic-text segment. It adds no root export, package export, public type, report field, diagnostic,
schema, configuration, CLI behavior, filesystem read, network operation, or executable behavior.

The primitive is not integrated into the validator or Markdown graph. It does not parse raw
Markdown or accept an mdast node. A future caller must select genuine visible prose or authorized
frontmatter values and must exclude code, `inlineCode`, HTML, comments, raw YAML, URLs,
destinations, definitions, machine identifiers, and whole files. That caller also remains
responsible for node kind, document budget, source location, ordering, and diagnostic admission.

The input is `unknown`. Nonprimitive strings fail as `invalid_input` without coercion or property
observation. Primitive strings above 524,288 UTF-16 code units fail as `too_large` before trimming
or grammar work. All other strings produce either the fixed safe singleton or the fixed
`placeholder` singleton.

The four results are frozen, module-local singleton identities registered in a private `WeakSet`.
The genuine-result predicate reads no candidate properties and rejects clones, forgeries, foreign
module results, active proxies, and revoked proxies. Results carry only `ok` and, on failure,
`reason`; they retain no source text, match, line, offset, path, error, or cause. The API accepts no
options, callbacks, signal, syntax tree, or authority-bearing object.

## Frozen grammar

An entirely blank value after ECMAScript trimming is a placeholder. Otherwise the primitive scans
CR, LF, and CRLF logical lines, trims each line, skips empty lines, and reports a placeholder when
any line matches one of these six frozen forms:

| Form | Accepted shape |
| --- | --- |
| Exact directive | `todo`, `tbd`, `fixme`, `changeme`, `placeholder`, `replace me`, or `fill me` |
| Colon directive | one core directive, optional whitespace, `:`, then any dot-like remainder |
| Dash directive | one core directive, whitespace, `-` or `—`, and an optional whitespace tail |
| Uppercase annotation | exact `TODO`, `TBD`, `FIXME`, or `CHANGEME`, whitespace, then content |
| Marker bracket | bracketed `todo`, `tbd`, `fixme`, `changeme`, or `placeholder`, with detail/colon |
| Editable bracket | the frozen `fill`, `replace`, `insert`/`describe`/`enter ... here`, or `your` forms |

The `your` whitelist is exactly name, title, description, summary, text, value, details, content,
email, URL, path, and command. Bracket suffix prose requires leading whitespace, so
`[TODO](https://example.gov)` remains safe. Generic substrings and near misses remain safe,
including `todo-list`, `placeholder-driven design`, `replace me-not`, `[fill rate]`, `[enter key]`,
`[your rights]`, fullwidth `ＴＯＤＯ`, zero-width-split `TO​DO`, prefix text, and `TODOist`.

This intentionally refines the legacy create-time brief heuristic. In particular, lowercase prose
such as `todo write this` is not an annotation, while exact uppercase annotations remain findings.
The overlap where `TODO -x`, `TODO —x`, or `TODO -\u0085` fails the dash form but satisfies the
uppercase form is preserved by falling through to the uppercase check.

## Manual equivalence and raw-retention correction

The first implementation used the six reviewed regular expressions. Independent review found that
successful V8 regular-expression execution retains the complete semantic line through legacy
`RegExp` statics such as `input`/`$_`, match, capture, and context properties. That violated the
primitive's raw-free result and zero-retention boundary even though the returned singleton itself
contained no text.

The final production module contains no regular-expression literal or execution. It uses captured
`Reflect.apply`, `Object.freeze`, `String.prototype.charCodeAt`, `slice`, and `trim`, plus captured
`WeakSet` add/has methods. A handwritten, monotonic code-unit matcher implements the exact grammar.

Its whitespace predicate is the ECMAScript `\s` set: U+0009–000D, U+0020, U+00A0, U+1680,
U+2000–200A, U+2028, U+2029, U+202F, U+205F, U+3000, and U+FEFF; U+0085 is not whitespace. The
case-insensitive forms use ASCII folding plus U+017F long-s folding, the only non-ASCII simple fold
relevant to this token set. CR and LF are consumed by the outer logical-line scanner. Dot-like
tails reject U+2028 and U+2029, while bracket negated-character spans allow them, matching the
frozen expressions without backtracking.

The paired raw-retention test seeds and snapshots all 19 relevant legacy slots: canonical input,
match, last-paren, left/right context, `$_`, `$1` through `$9`, and the `$&`, `$+`, ``$` ``, and `$'`
aliases. It then classifies secret-bearing placeholder text and immediately snapshots again, with no
test-side regular-expression operation inside that window. Every slot remains byte-identical and
the result serialization contains no secret.

## Bounds and failure priority

The 524,288-code-unit limit is checked before blank or placeholder grammar. Exactly 524,288 ASCII
or astral code units are accepted for scanning; plus one returns `too_large`, including when a
placeholder occurs earlier. An exact-limit value whose final logical line is `TODO` is still a
placeholder. There is no secondary 8,192-line cap: a marker after line 8,193 is found.

The scanner is iterative and linear in the authorized segment size. CRLF is one logical break.
Transient trimmed line slices collectively cover at most the bounded input; no arrays of lines,
recursive walk, locale operation, normalization, default-ignorable rewrite, or async work is used.
Any captured-intrinsic scan exception is normalized to the fixed `invalid_input` singleton.

## Authored and independent verification

The focused authored file passes 40 tests. It covers every directive and bracket branch, all 12
`your` nouns, blank and exact whitespace cases, CR/LF/CRLF positions, dot-like U+2028/U+2029
boundaries, long-s folding, the uppercase/dash overlap, legacy false positives, exact and plus-one
UTF-16 limits, astral input, the post-8,192-line marker, nonprimitive and zero-trap inputs, frozen
singleton identity, clone/forge/foreign rejection, internal exceptions, and post-import intrinsic
pollution. Focused module coverage is 142/142 statements, 142/142 branches, 16/16 functions, and
113/113 lines.

An authored private differential oracle compared the handwritten classifier with the exact six
reference expressions over 250,023 edge and seeded random lines with zero mismatches. Its seed is
`0x9a17c0de` and corpus SHA-256 is
`eba4557872ce313b15142e69b22117b57ea1fde39b0dd3144218c0d94428aa0d`. Independent Node.js 26
differential review checked another 578,030 inputs with zero mismatches. Neither oracle is shipped.

Targeted format and lint checks, TypeScript `--noEmit`, focused tests, and focused coverage pass.
No dependency installation, full shared check, package build, or commit was performed by the author
agent before release review.

## External holdout

The external read-only property-tax repository is clean at
`90965164c80fdc9e6209deccba85e2b64a1e0a60`. Exact safe holdout values include
`REPLACE after parcel-source verification`, the complete fictional-template transformation and
Example deadline/sale-window sentences, and the complete verified-condition sentence. These cases
prove the intended refinement against realistic semantic leaves.

The property repository is a release holdout only, not a source import, fixture, submodule, runtime
dependency, or CI dependency. Its JSON, scripts, code, inline code, URLs, and raw Markdown must not
be fed wholesale to this primitive; future syntax-aware caller selection remains mandatory.

## Release verification

Release work ran under `/private/tmp/skillpress-009u-release.63wcIj` from the frozen base. Node.js
22.23.2 and 24.19.0 each pass the focused one-file / 40-test selection and full 51-file / 669-test
suite. Node.js 26.7.0 passes the same focused selection and complete shared check with 51 files /
669 tests.

Global coverage is 95.81% statements (4,722/4,928), 94.61% branches (3,336/3,526), 99.81%
functions (546/547), and 97.34% lines (4,249/4,365). The new module remains at 100%: 142/142
statements, 142/142 branches, 16/16 functions, and 113/113 lines. Both the full dependency audit
and `npm audit --omit=dev` report zero vulnerabilities.

The private 126-line hostile oracle has SHA-256
`09447f8d646c958bd44bb10d857805e69619021dd56d65843af13f966def092f`. It checks 66,047 inputs
on each Node version with zero proxy observations. Twelve maximum-sized differential checks complete in
25.552 ms on Node 22, 56.185 ms on Node 24, and 54.445 ms on Node 26.

Bare packing produces 195 entries, 164,917 packed bytes, and 870,545 unpacked bytes. The npm SHA-1
is `fbf830edfd2bd844461aaff801b8fa228888e4d3`; tarball SHA-256 is
`62d476a60ed75e9134f68e93e300831538f93c324158216ac758cd04790d0e87`. The installed consumer has
41 production packages and 42 audited packages with zero vulnerabilities. The root export surface
is unchanged, internal runtime imports remain blocked, the internal TypeScript import fails with
`TS2307`, and CLI version output remains `0.1.0`.

The clean base build has 184 regular dist files and the candidate has 188. All 184 base files are
byte-identical; the only additions are the four JavaScript, declaration, and map artifacts for the
new internal module. `dist/index.js` and `dist/index.d.ts` remain byte-identical with SHA-256
`6cd258eebb405a6c42aff6c204febf3f5dccc75cd5ef926946d0686ea10f6b63` and
`204bf9749b3534803239bc2a9d542451c7b5cb8dad5755be263ba0846710a56e`.

The private 56-line property holdout harness has SHA-256
`4ef15b6084b49b92281f21e74508d108b4eb55f0b826126b91e9c5385be8486a`. All 342/342 JSON string
leaves and all 4/4 explicitly authorized Markdown prose segments remain safe. This is evidence for
the primitive only and does not claim validator or mdast integration.

Harness-only corrections covered two private-clone setup commands run from the wrong current
directory, a consumer command run from the wrong directory, missing explicit `@types/node` in the
private TypeScript consumer, and a nonexistent `/parcel/search` holdout expectation. Each affected
check was corrected and rerun. Release review made zero writes and performed zero npm operations in
the shared candidate.

After the first commit, the root post-commit harness created its detached worktree but failed to
change into it. One `npm ci --ignore-scripts`, `npm run check`, `npm audit --omit=dev`, and
`npm pack --dry-run --json` sequence consequently ran in the shared checkout. All four commands
passed, tracked source state and both frozen production/test hashes remained unchanged, and only
ignored build or dependency artifacts may have been rebuilt. The harness was corrected and the
complete detached gate was rerun before push; this shared npm incident is not counted as independent
release evidence.

## Frozen files

- `src/validate/semantic-text-placeholder.ts`:
  `7a2ecb85c3878e60bc97defc07da68aa189fdd5608d1c2bdc6929a7ebc3dd024`
- `test/semantic-text-placeholder.test.ts`:
  `c286704074cb4f0ded925f6cde249a10a6c09d6f0ddff969efaa873455d225b7`

The review record changes neither frozen file and does not integrate or export the primitive.
