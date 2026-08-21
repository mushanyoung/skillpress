# Review 010b: portable-name RegExp retention

- Slice: `fix: remove portable-name RegExp retention`
- Base: `2b36282eeee9f3cf92480d9e3eb8225eb1f28b53`
- Candidate: `6e30607c110d2d331fc62634d8d0da3cf9b65c4b`
- Result: **010b delta: PASS**

## Finding and scope

`agent-skill.ts` previously used one module-initialized
`/^[a-z0-9]+(?:-[a-z0-9]+)*$/u` expression at two call sites: the strict parsed frontmatter
`name` field and the optional public `expectedName`. Keeping the expression at module scope did not
prevent successful execution from updating V8's process-global legacy RegExp statics.

The externally observable reproduction needs no parsed document. A valid `expectedName` is checked
before root inspection, after which validation awaits a missing-root result. On the base, that path
changes exactly 17 of the 19 legacy aliases and stores the name in `RegExp.input`; the two left-
context aliases remain equal to the benign seed. The candidate preserves all 19 aliases across the
same awaited call and its fixed diagnostic contains no name text.

This slice changes only `src/validate/agent-skill.ts` and its paired validator test. It does not
change the public API, options shape, metadata, diagnostics, limits, graph/session behavior,
filesystem behavior, package exports, or validator admission order.

## Exact grammar and authority

The replacement is a monotonic UTF-16 code-unit scan using captured
`String.prototype.charCodeAt` through captured `Reflect.apply`. It accepts one or more nonempty
segments of lowercase ASCII letters or ASCII digits, separated by exactly one U+002D hyphen. It
rejects an empty value, leading/trailing/repeated hyphens, every other ASCII code unit, non-ASCII
text, astral characters, and lone surrogates.

For `expectedName`, the retained order is options/value shape, primitive-string type, UTF-16 length
greater than 64, then grammar, all before root inspection. Invalid type, length, or grammar invokes
the root producer zero times; exactly 64 ASCII code units is accepted and 65 is rejected.

For frontmatter, only a strict parsed decoded string reaches the same matcher. Existing Unicode-
code-point length diagnostics, directory/project comparisons, warnings, metadata admission, and
diagnostic order remain unchanged. Parser-authorized decoded dot, slash, spaces, LF, NBSP,
combining text, fullwidth text, and astral text reach portable-format rejection. NUL and lone
surrogates remain owned by the earlier parser/API boundaries rather than being forced through an
unreachable frontmatter matcher.

The production module now contains no RegExp literal or RegExp-executing method entry point. This
claim is deliberately module-local: the full parsed validation pipeline still has independent
frontmatter-parser behavior, so the missing-root alias oracle is not evidence about that later
pipeline.

## Authored evidence and frozen artifacts

The paired test covers the complete segment grammar at both reachable call sites, exact 64/65
boundaries, invalid pre-root zero calls, parser-versus-API ownership, and both accepted and rejected
Unicode/code-unit cases. A nine-group benign seed is snapshotted through all 19 aliases, followed
by the public missing-root call and `await`, then an immediate second snapshot with no intervening
RegExp execution or test assertion.

Post-import poisoning of `Reflect.apply`, RegExp `exec`/`test`, and `String.prototype.charCodeAt`
uses only the expected-name missing-root preflight and records zero calls. The frontmatter call site
is instead locked by the grammar table and production-source gate, avoiding a false requirement on
the transitive parser's legitimate expressions. Existing validator, graph, placeholder, cap,
failure, raw-free, and path-boundary tests remain intact.

Frozen artifacts:

- `src/validate/agent-skill.ts`: 400 lines, SHA-256
  `9d243471f680f2e39144d25d9d86176cf56e174af6b2b314e849d65405092cfb`;
- `test/agent-skill-validator.test.ts`: 1,267 lines, SHA-256
  `1d7f155129e129914420280fd0bbe765bd508529b14a744e30cc618bc9e48db0`.

Production grows by 15 lines and the test by 116, for a two-path net increase of 131 lines.
Targeted format, lint, TypeScript, 21 focused tests, and focused coverage pass. The root lane's
complete shared check passes 52 files and 699 tests.

Global coverage is 95.84% statements (5,009/5,226), 94.79% branches (3,695/3,898), 99.82%
functions (580/581), and 97.42% lines (4,497/4,616). `agent-skill.ts` is 98.28% statements,
98.48% branches, 100% functions, and 98.73% lines.

## Detached release and package

Canonical evidence is retained at `/private/tmp/skillpress-010b-release.5zJxXN`. Base and candidate
are fresh, with no local dependency or alternate archive. The candidate cold install adds 122
packages; the independent dist evidence below cold-installs both endpoints with the same count. Node
22.23.2, 24.19.0, and 26.7.0 each pass the 21 focused tests; Node 22 and 24 also pass the
52-file/699-test full suite. Homebrew Node 26.7.0 with npm 11.19.0 and zlib 1.2.12 passes the
complete check. Full and omit-development audits report zero vulnerabilities.

Canonical dry and actual packs agree:

- 195 entries; 171,524 packed bytes; 914,291 unpacked bytes;
- SHA-1 `de9da1d20ca0cce0adcd18956cfc19465b9d2cc4`;
- archive SHA-256 `5ad06ed5b4c531f6ec8a40fa3bc7fc3837d4a5bc39afb98762c77d2bb1f55d64`;
- integrity
  `sha512-oCBpIKhpyF7MM0Cm9maGx/l38sebxJ0/VwVY9go/ImZMUuouD4UvNvuAfSsKvJbqE0sI9HjcN4K/hW4dcMrauw==`;
- decompressed tar SHA-256
  `9fb8e0802d81d8a9d04f6bc94e94fd55c1e13434e3283fc0e0e1d3269d98f429`;
- payload-manifest SHA-256
  `52cc4123897ab032d44916cd056871d8930b6c9751d21e5da94fd863c0ac462d`.

## Consumer and dist

The self-contained consumer at `/private/tmp/skillpress-010b-release.5zJxXN/consumer` adds 41
packages and audits with zero vulnerabilities. Node 18.20.8, 22.23.2, 24.19.0, and 26.7.0 expose
the same 18 root runtime names; six internal imports remain blocked with
`ERR_PACKAGE_PATH_NOT_EXPORTED`. CLI version `0.1.0` and its 17-line help pass. Strict NodeNext
TypeScript passes for the root and fails the internal import with `TS2307`. The verified official
Node 18.20.8 darwin-arm64 archive SHA-256 is
`bae4965d29d29bd32f96364eefbe3bca576a03e917ddbb70b9330d75f2cacd76`.

Independent dist evidence at `/private/tmp/skillpress-010b-release.7GKcAq` finds 188 regular files
and three descendant directories in each build, with no added or removed path. Of the files, 185
are byte-identical; only `agent-skill.d.ts.map`, `.js`, and `.js.map` change. Root `index.js`
remains `6cd258eebb405a6c42aff6c204febf3f5dccc75cd5ef926946d0686ea10f6b63`, and root `index.d.ts`
remains `204bf9749b3534803239bc2a9d542451c7b5cb8dad5755be263ba0846710a56e`.

## Adversarial and property holdouts

The private oracle at `/private/tmp/skillpress-010b-adversarial.1B9fUq/oracle.mjs` is 338 lines
with SHA-256 `d9d699afb7551bef1d12d6df484cfe391822cd422fd3012fa29d2aba2367fbfe`.
Its private dist copies differ only by a root-counter import and test export; neither ships.

On Node 22.23.2, 24.19.0, and 26.7.0, the real candidate matcher agrees with the frozen old grammar
for 1,762,163 inputs per Node, or 5,286,489 total. Each run includes every UTF-16 code unit in four
contexts, 1.5 million deterministic strings, and explicit boundaries. Twenty-five API cases per
Node preserve exact base/candidate outcomes and prove invalid type, length, and grammar use zero
root calls. The base changes 17/19 aliases, the candidate preserves 19/19, and post-import
pollution records zero calls.

The read-only property holdout remains clean at
`90965164c80fdc9e6209deccba85e2b64a1e0a60`. Base and candidate retain public-report SHA-256
`b78fa593ecf98ccc2b51aec95f683cc6cd112a4ce1f20608a3d161660a7c76a1`, with only the existing
license warning, and graph-summary SHA-256
`4a2438e2fc699e12dff38c6b3f8758dc596a20d86a1b2f05b5ba059d679f84c8`. Graph totals, three
line-12 root edges, and empty graph/resource/placeholder findings remain exact on all three Nodes.

The adversarial lane used mise Node 26 with npm 12.0.2 to install, build, and audit its isolated
base and candidate; audit was clean, no pack was produced, and no harness accident occurred.

## Harness record and boundary

The main release lane had no failure. In the independent dist/consumer evidence lane, the first
comparison incorrectly requested nonexistent `dist/package.json` and received `ENOENT`; it was
rerun against the repository-root package file. The same lane's first consumer command supplied a
workdir before creating it, so execution was rejected before process startup; creating the
directory first and rerunning produced the passing result. Neither incident changed candidate
evidence.

Private lanes performed no npm operation or write in the shared checkout, and candidate, base,
property, and shared trees finished clean. This document is authored after the verified candidate
and is not present in the verified package. It changes neither frozen implementation path nor
package contents. The 010b delta passes; metadata-module retention work tracked as 010c remains
deferred.
