# Review 009o0: canonical decoded Markdown components

- Slice: `refactor: share and harden canonical Markdown component checks`
- Review: independent API, compatibility, and adversarial runtime reviews
- Date: 2026-08-20
- Frozen base: `f440f9367ba2df6c9c51764e261ccfc108f1f194`
- Final result: PASS

## Scope and API

The internal `markdown-destination` module now exports
`isCanonicalDecodedMarkdownLocalComponent(value)`. It is a total primitive-string type predicate
for one already-decoded component. Its accepted domain is exactly the set for which
`classifyMarkdownDestination(value)` returns a local destination whose `path` is the original
value and whose `components` array contains that value as its sole element.

The predicate rejects empty and dot components, `/`, `\`, `%`, `#`, whitespace-only values such
as NBSP, non-NFC text, unsafe Unicode, values over 255 UTF-8 bytes, and Windows-nonportable names.
That includes `?`, colons and alternate-data-stream syntax, reserved device names, and trailing
dots or spaces. A safe unassigned scalar such as U+0378 remains accepted. The result is only a
lexical classification. It proves no directory-index membership, capture provenance, filesystem
identity, currentness, containment, or authority.

The helper is used as the final per-component invariant inside decoded local-path classification.
The classifier still performs its existing whole-destination checks in their original order, so
all existing diagnostic reasons and their priorities remain unchanged. It still decodes exactly
once, rejects encoded separators and delimiters before decoding, rejects residual percent signs,
checks whole-path Unicode and NFC form, applies the component-count limit before component
diagnostics, and then preserves the existing empty, dot, byte-limit, and nonportable-component
priority.

No package-root export, package export-map entry, schema, filesystem operation, or authority API
was added. The helper and the existing classifier/path-safety functions remain internal package
implementation details.

## Captured-intrinsic hardening

`path-safety` now treats module initialization as the trust boundary for the capabilities it uses.
It captures `Reflect.apply`, the Buffer constructor and its UTF-8 byte/encode/decode operations,
the required String operations, `RegExp.prototype.exec`, and the default platform value. Unicode
scanning and Windows-component scanning use numeric indices. The latter no longer delegates to a
regular-expression split or a string iterator, avoiding live `RegExp.prototype[Symbol.split]`,
species, and iterator behavior after import.

`markdown-destination` similarly captures `Reflect.apply`, Buffer byte length,
`decodeURIComponent`, `Object.defineProperty`, `Object.freeze`, the required String operations,
`RegExp.prototype.exec`, `Set.prototype.has`, and the two path-safety producer identities. It
builds result component arrays through captured own-slot definition and numeric loops. Manual
component splitting and the protocol-relative authority check avoid live regular-expression
`Symbol.search`/`Symbol.split`, string splitting, and array or string iteration. Returned document,
external, invalid, local, and component-array records retain their previous frozen shapes.

Post-import replacement of the reviewed live bindings cannot redirect these operations. This is
explicitly a module-initialization trust boundary: the slice does not claim protection from
pollution already present before the modules initialize, nor does the lexical helper become an
unforgeable brand or an authority check.

## Compatibility evidence

The authored focused selection is two files and 18 tests. It covers every prior diagnostic class,
exact destination/component/depth byte boundaries, Unicode and Windows portability, deeply frozen
results, deterministic fuzz, the new single-component equivalence, U+0378 and NBSP, and combined
post-import poisoning of direct and transitive intrinsics. All 18 tests pass. Both modified
production modules independently reach 100% statements, 100% branches, 100% functions, and 100%
lines.

The API reviewer reconstructed the four frozen files from the stated base in a fresh private
snapshot and returned PASS with zero blockers. Its tracked complete gate passed 41 files and 450
tests. It replayed the authored two-file, 18-test selection independently on Node.js 22.23.2,
24.19.0, and 26.7.0; all 18 tests passed on each version.

That reviewer also ran two non-Vitest differential campaigns. Comparing the old and hardened
classifier/path-safety behavior across 1,114,112 Unicode inputs plus 100,000 deterministic random
strings produced zero differences. Comparing the helper with the exact one-component classifier
domain across 1,214,112 samples likewise produced zero differences. These large differential
counts are separate compatibility evidence, not additions to the 18 authored tests or the
41-file, 450-test complete gate.

## Adversarial review

The adversarial reviewer independently added one private file with three tests, SHA-256
`3594ab79ef48965027e914bbdbeb8af9a9e21f7015167cc4822cf9575cadf63f`:

1. It passed ordinary and revoked proxies, boxed strings, and other non-primitives through the
   helper, classifier, and path-safety boundaries, confirming property-free rejection and zero
   proxy traps.
2. It poisoned the live Reflect, Buffer, URI decoder, Object definition/freezing, RegExp execution
   and symbol protocols, Set lookup, String methods and iterator, and Array iterator one at a time
   after import. Local, unsafe-scheme, protocol-relative, unsafe-Unicode, Windows-reserved, U+0378,
   and NBSP outcomes and reasons remained unchanged with zero poison invocations.
3. It verified the captured default platform and exact helper boundaries: U+0378 is accepted;
   NBSP, ideographic whitespace, non-NFC text, separators, `%`, `#`, `?`, `:`, Windows-reserved
   names, 256 ASCII bytes, and 128 `é` characters are rejected; the corresponding 255-byte and
   127-`é` boundaries are accepted.

The adversarial reviewer separately compared 120,049 old/new cases with zero mismatches and
checked 6,296 accepted local-component round trips. Its tracked-only complete gate passed the same
41 files and 450 tests. With the private file installed, the complete gate passed 42 files and 453
tests, including format, lint, generated-file freshness, type checking, and coverage. The combined
authored-plus-private selection was three files and 21 tests; all 21 passed independently on
Node.js 22.23.2, 24.19.0, and 26.7.0.

The API review's large differential campaigns and the adversarial review's private three-test
suite are distinct evidence. The private tests are included only in the adversarial 42-file,
453-test gate and three-file, 21-test Node matrix, not in the API reviewer's 41-file, 450-test gate
or authored Node matrix.

## Release boundary

Both reviewers independently reported zero production dependency vulnerabilities. Their bare
`npm pack --json` runs executed prepack and build successfully and produced the same result: 171
files, a 121,950-byte tarball, and 623,462 unpacked bytes.

The adversarial review's fresh installed-consumer probe confirmed that
`isCanonicalDecodedMarkdownLocalComponent`, `classifyMarkdownDestination`, and `isSafePathInput`
were absent from both package-root runtime keys and root declarations. Imports of
`@mushanyoung/skillpress/dist/validate/markdown-destination.js` and
`@mushanyoung/skillpress/dist/path-safety.js` both failed with
`ERR_PACKAGE_PATH_NOT_EXPORTED`. The API reviewer independently confirmed the helper's absence from
the root runtime and declaration surfaces and the internal-subpath export boundary.

## Frozen files

The candidate is based on `f440f9367ba2df6c9c51764e261ccfc108f1f194`. Its four frozen
SHA-256 values are:

- `src/path-safety.ts`:
  `8dedf4f3d0f3eaf665457023b46446ea5e14742faec8f4f2dca1415e9af786cc`
- `src/validate/markdown-destination.ts`:
  `8f925c8d1cc7c42525f9b1978c802bcb16cd2122007dfe62ef77709b691a2f33`
- `test/path-safety.test.ts`:
  `e6875358defc8e8408f96fa4c2f7c7dca8c50be84c2a71cb2a8fcfb3844e6bf5`
- `test/markdown-destination.test.ts`:
  `5ceea71b3b902fcb09d106e8a3cf3c988fa3efeb5fd8735c857a5a7158f72aee`

Formatting, lint, generated-file checks, type checking, build, coverage thresholds, and
`git diff --check` pass in the independent fresh complete gates. The production change is exactly
140 net lines and the targeted-test change is 184 net lines.
