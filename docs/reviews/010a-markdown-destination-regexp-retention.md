# Review 010a: Markdown destination RegExp retention

- Slice: `fix: remove Markdown destination RegExp retention`
- Base: `e5343e312d8edea7827a3a81bbba5e6ffca14383`
- Candidate: `9e90ac8ad310bb8a0737775d2097be01c003871f`
- Result: **010a delta: PASS**

## Scope and finding

This slice changes only the internal Markdown-destination classifier and its paired test. It does
not change the public export map, result union, 19 invalid reasons, limits, diagnostic mapping,
graph/session behavior, filesystem behavior, or decoded CommonMark-destination semantics.

The former classifier used seven captured regular expressions across destination classification; a
destination could execute one or more depending on its branch. A successful execution updated V8's
process-global legacy RegExp statics, including `RegExp.input`, with attacker-controlled destination
text. Capturing `RegExp.prototype.exec` protected the call target from later mutation but did not
prevent that retention. A private base replay confirms the leak; invalid and singleton results
themselves remained raw-free.

The candidate contains no RegExp literal or execution entry point in the production module. It
uses captured `String.prototype.charCodeAt` through captured `Reflect.apply` and bounded monotonic
code-unit scans. Existing captured decoding, normalization, byte-length, path-safety, set, slice,
and result-construction intrinsics remain the authority for their original operations.

## Exact handwritten languages

The replacement preserves these languages:

| Former language | Handwritten contract |
| --- | --- |
| URI scheme | ASCII letter, then zero or more ASCII letters/digits/`+.-`, then `:`; return the pre-colon slice |
| Windows drive | ASCII letter followed immediately by `:` |
| Windows device path | `//`, then `?` or `.`, then end of input or `/` |
| Encoded separator | `%2f` or `%5c`, with ASCII case-insensitive final letter |
| Encoded delimiter | `%23`, `%3a`, or `%3f`, with ASCII case-insensitive final letter |
| Windows device scheme | Lowercased exact `aux`, `con`, `nul`, `prn`, `com1`–`com9`, or `lpt1`–`lpt9` |
| ECMAScript whitespace | Exact ES2025 code-unit set |

The ES2025 set is U+0009–U+000D, U+0020, U+00A0, U+1680, U+2000–U+200A, U+2028,
U+2029, U+202F, U+205F, U+3000, and U+FEFF. U+0085 remains outside `\s`; the earlier
unsafe-Unicode gate still rejects it as a control.

The encoded scan traverses the complete fragment-truncated raw local path (after fragment removal,
before percent decoding). Any encoded separator wins globally over an encoded delimiter even when
the delimiter appears first. Absolute-path and query gates retain their surrounding priority, and
fragment contents remain excluded from local-path decoding.

Overall priority remains: type; UTF-16/UTF-8 size; empty document target; unsafe Unicode; Windows
drive; `#`/`?` document target; protocol-relative backslash, absolute/device form, whitespace, then
authority; URI unsafe scheme, backslash, then whitespace; fragment cut; local backslash; query;
local absolute path, encoded separator, encoded delimiter, decoding, ambiguity, Unicode, NFC,
component count; then per-component empty, dot, byte-size, and portability.

## Authored evidence and frozen artifacts

The paired test retains all prior integration, Unicode, decoded-path, byte/component/depth,
deep-freeze, captured-intrinsic, and 10,000-input deterministic fuzz checks. New evidence covers:

- deterministic differential checks against all seven former expressions;
- every ES2025 whitespace code unit and its unsafe-Unicode/external priority;
- delimiter-before-separator, malformed-before-separator, fragment, absolute, and query overlap;
- URI, drive, device path, device scheme, safe/unsafe protocol, and local near misses;
- a nine-group benign seed followed by all 19 legacy aliases, classification, and an immediate
  second snapshot with no intervening RegExp execution or assertion;
- 15 safe and unsafe former execution paths, raw-free nonlocal results, post-import RegExp and
  `charCodeAt` poisoning, and a production-source zero-RegExp gate.

Frozen implementation artifacts:

- `src/validate/markdown-destination.ts`: 318 lines, SHA-256
  `67eb0dc72846afe42843879a28460855a90ecf747f2471da021d959928fc7739`;
- `test/markdown-destination.test.ts`: 729 lines, SHA-256
  `672a6383b80884f15b14fb475968a27e6d4fd6279fc50f630be039ed8d559b12`.

Production grows by 92 lines and the paired test by 256, for a two-path net increase of 348 lines.
Targeted format, lint, TypeScript, 18 focused tests, and focused module coverage pass. The root
lane's complete shared `npm run check` passes 52 files and 697 tests.

Global coverage is 95.83% statements, 94.77% branches, 99.82% functions, and 97.41% lines. The
changed module is 100%: 159 statements, 163 branches, 22 functions, and 130 lines.

## Detached release, package, consumer, and dist

Canonical evidence is retained under `/private/tmp/skillpress-010a-release.sTT5Po`. Fresh base and
candidate installs each add 122 packages. Node 22.23.2 and 24.19.0 each pass 18 focused tests and
the 52-file/697-test full suite. Homebrew Node 26.7.0 with npm 11.19.0 and zlib 1.2.12 passes the
complete check, including format/lint over 114 files, generated verification, types, tests, and
coverage. Full and omit-development audits report zero vulnerabilities.

Canonical dry and actual packs agree:

- 195 entries; 171,387 packed bytes; 913,278 unpacked bytes;
- SHA-1 `72b29b7a981e8adf918f1cf6c27794ab91d75ac9`;
- archive SHA-256 `e42a0104636a90ced38aaa234ae33f4e67221c5526d5031bfd72b3609e41b7fc`;
- integrity
  `sha512-sAsegTOpqHzeS5pPeAs0AEba2j2UH1/GutPS50Bip+vQMl0/NViXPPGPC8GwiK5AeG5E4hQgf3B2yGHrXJ1wqw==`;
- decompressed tar SHA-256
  `7ffbce2eb09fb9ce46bec354cb2aae8d994cbdf4e37ca9fea20803a91877d816`;
- payload-manifest SHA-256
  `4ab10cd81989b732e7021923f5e81e764b993752f6994cb195f4120e7453105b`.

The isolated self-contained consumer at
`/private/tmp/skillpress-010a-release.sTT5Po/consumer` adds 41 packages and audits with zero
vulnerabilities. Node 18.20.8, 22.23.2, 24.19.0, and 26.7.0 expose the same 18 root runtime names;
six internal imports remain blocked with `ERR_PACKAGE_PATH_NOT_EXPORTED`. CLI version `0.1.0` and
its 17-line help pass. Strict NodeNext TypeScript passes for the root and fails the internal import
with `TS2307`. The verified official Node 18.20.8 darwin-arm64 archive SHA-256 is
`bae4965d29d29bd32f96364eefbe3bca576a03e917ddbb70b9330d75f2cacd76`.

Fresh base and candidate dist trees each contain 188 regular files and three descendant
directories, with no added or removed path. Of the files, 185 are byte-identical; only
`markdown-destination.d.ts.map`, `.js`, and `.js.map` change. Root `index.js` remains
`6cd258eebb405a6c42aff6c204febf3f5dccc75cd5ef926946d0686ea10f6b63`, and root `index.d.ts`
remains `204bf9749b3534803239bc2a9d542451c7b5cb8dad5755be263ba0846710a56e`.

## Adversarial and property holdouts

The self-contained oracle at
`/private/tmp/skillpress-010a-adversarial.irM0Tj/oracle.mjs` is 462 lines with SHA-256
`6c3714090a99b5cb1367ff87286ec439de5d1165eb8726476c2ec28d8bdc64e1`. On Node 22.23.2,
24.19.0, and 26.7.0 it compares 2,612,861 inputs per Node, or 7,838,583 total, with zero mismatch
in exact results, own data descriptors, recursive freeze, component arrays, and singleton identity.

Per Node, the corpus contains 2,224,128 custom/protocol embeddings of every Unicode scalar,
131,072 percent cases from all 128² trailing ASCII-byte pairs in eight contexts, 7,648 URI/drive/
device/device-scheme edits, 250,000 deterministic UTF-16 fuzz inputs, and 13 boundary values. The
base leak is reproduced; the candidate preserves all 19 aliases across 15 former execution paths.
Post-import RegExp/String-entry poisoning records zero calls.

The read-only property holdout remains clean at
`90965164c80fdc9e6209deccba85e2b64a1e0a60`. Base and candidate retain the exact public report
SHA-256 `b78fa593ecf98ccc2b51aec95f683cc6cd112a4ce1f20608a3d161660a7c76a1`, with only the existing
license warning, and graph-summary SHA-256
`4a2438e2fc699e12dff38c6b3f8758dc596a20d86a1b2f05b5ba059d679f84c8`. The graph remains complete
with four files, 59,712 bytes, 1,872 nodes, three targets, 20 work units, six components, zero alias
candidates, three line-12 root edges, and empty graph/resource/placeholder findings.

## Harness record and boundary

The release TypeScript oracle initially assumed the public `VERSION` declaration was a literal and
failed with `TS2322`; correcting that private expectation produced the passing result. A hash
command initially omitted the consumer path/prefix and received `ENOENT`; it was rerun against the
correct target. Neither was a candidate failure.

The adversarial lane used mise Node 26 with npm 12.0.2 to install, build, and audit its isolated base
and candidate; no pack was produced, and no harness failure occurred. Release and adversarial lanes
performed no npm operation or write in the shared checkout, and all candidate, base, property, and
shared trees finished clean.

This review document is authored after the verified candidate and therefore is not present in the
verified package. It changes neither frozen implementation path nor package contents. The 010a
delta passes; any next retained-expression work tracked as 010b remains explicitly deferred.
