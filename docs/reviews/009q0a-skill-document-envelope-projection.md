# Review 009q0a: skill-document envelope projection

- Slice: `refactor: project a hardened skill-document envelope`
- Review: independent design, compatibility, and adversarial runtime reviews
- Date: 2026-08-20
- Frozen base: `7bbd551d2e3516401a7248414180c4f7bafc2dc7`
- Final result: PASS

## Scope and internal API

This slice adds one synchronous internal projection to `src/validate/skill-source.ts`:

```ts
type SkillDocumentEnvelopeProjectionFailureReason =
  | "invalid_input"
  | "byte_order_mark"
  | "control_character"
  | "missing_frontmatter"
  | "unclosed_frontmatter"
  | "frontmatter_too_large";

type SkillDocumentEnvelopeProjectionResult =
  | Readonly<{ ok: true; envelope: SkillDocumentEnvelope }>
  | Readonly<{
      ok: false;
      reason: SkillDocumentEnvelopeProjectionFailureReason;
    }>;

projectSkillDocumentEnvelope(value: unknown): SkillDocumentEnvelopeProjectionResult;
```

Success contains the exact YAML text, body text, one-based body-start line, and UTF-16 body-start
offset already used by the frontmatter parser. The success wrapper and envelope are frozen.
Failures are fixed frozen records containing only `ok` and `reason`; they do not expose input text,
control locations, YAML, body text, offsets, diagnostics, or native errors. The projection has no
brand and proves no provenance, filesystem identity, session membership, currentness, containment,
or authority. It was not added to the package root or export map.

## Lexical priority and bounds

The projection's failure order is fixed:

1. a non-primitive string is `invalid_input` without property access;
2. an initial U+FEFF is `byte_order_mark`;
3. the complete input is scanned for forbidden C0 and C1 controls;
4. the opening line must be exactly `---`;
5. a later closing line must be exactly `---`;
6. the YAML slice must not exceed 64 KiB when encoded as UTF-8.

LF, CRLF, lone CR, an immediately closing delimiter, a closing delimiter at EOF, astral text, and
an empty body retain their exact source slices, line numbers, and UTF-16 offsets. Frontmatter at
exactly 64 KiB succeeds and one additional UTF-8 byte fails.

The standalone lexical projection intentionally has no whole-document byte limit. It performs
bounded-state linear work over the primitive string and may therefore scan a body larger than
512 KiB. Its intended 009q composition calls it only after the reviewed session member reader has
enforced the existing 512 KiB file limit. The projection does not itself upgrade an arbitrary
string into a trusted document.

## Shared scanner and diagnostic compatibility

`parseSkillDocumentEnvelope` and the new projection use the same private lexical scanner. The old
diagnostic adapter retains every prior code, severity, scope, message, line, column, and failure
priority. Successful envelopes are now frozen but retain the same enumerable data fields and
values.

The scanner always completes the control-character scan before deciding that controls win. It
retains at most the first 256 frozen control locations. This is sufficient to reproduce the
existing collector behavior exactly: the collector stores at most 255 ordinary findings, the
256th attempted addition activates its existing truncation state, and `finish()` emits the fixed
256th `skill.diagnostics.truncated` record. No unbounded array of control locations is retained.

Module initialization is the trust boundary for `Reflect.apply`, the Buffer constructor and UTF-8
byte counter, the Object constructor and definition/freezing functions, and the String
`charCodeAt` and `slice` operations. Scanning and copying use numeric loops and captured own-slot
definition rather than live array or string iteration. The guarantee covers post-import
replacement of those bindings; it does not claim protection from pollution already present before
module initialization.

## Authored verification

The authored focused file contains ten tests. It covers LF, CRLF, CR, EOF and empty-body offsets;
astral UTF-16 offsets; exact delimiters; all six projection failures and their priority; ASCII and
multibyte 64 KiB boundaries; the absence of a standalone 512 KiB body cap; multiple-control legacy
diagnostics and truncation; fixed failure identity and shape; nested freezing and raw-free output;
boxed, ordinary-proxy, and revoked-proxy rejection with zero traps; and combined post-import
Buffer, String, Object, Reflect, and iterator pollution.

Formatting, lint, type checking, focused execution, coverage, and `git diff --check` pass. The
focused result is one file and ten tests. `skill-source.ts` reaches 98.95% statements, 96.77%
branches, 100% functions, and 100% lines. The production file is 256 lines, a net increase of 130
lines from the base; the focused test file is 256 lines.

## Design and compatibility review

The design reviewer reconstructed the frozen files in a fresh private `/private/tmp` snapshot,
verified the base and both SHA-256 values, and returned PASS with zero blockers. Its complete
`npm run check` passed 44 files and 474 tests. Global coverage was 96.36% statements, 95.07%
branches, 99.76% functions, and 97.51% lines; the focused module retained the authored
98.95%/96.77%/100%/100% result.

That reviewer replayed `skill-source` and `frontmatter` together as two files and 20 tests on
Node.js 22, 24, and 26, with every selection passing. A separate old/new differential compared 16
crafted cases and 100,000 seeded strings. The prior and candidate envelope return values and full
diagnostic-report JSON had zero differences. The differential evidence is separate from the 20
tests and the 44-file complete gate.

The reviewer found zero dependency vulnerabilities. A bare `npm pack --json` executed prepack and
build successfully and produced 179 entries, a 133,687-byte tarball, and 695,198 unpacked bytes.
Candidate and base `dist/index.js`, `dist/index.d.ts`, and `package.json` were byte-identical.

The fresh installed consumer confirmed version `0.1.0` and the unchanged 18 root runtime keys.
`projectSkillDocumentEnvelope`, `SkillDocumentEnvelopeProjectionFailureReason`, and
`SkillDocumentEnvelopeProjectionResult` were absent from both root runtime own keys and root
declarations. Importing the exact internal
`@mushanyoung/skillpress/dist/validate/skill-source.js` subpath returned
`ERR_PACKAGE_PATH_NOT_EXPORTED`.

## Adversarial review

The adversarial reviewer independently reconstructed the candidate in
`/private/tmp/skillpress-009q0a-review.f4baLT`, verified the base and frozen hashes, and returned
PASS with zero blockers. It used two standalone private Node scripts rather than private Vitest
tests.

The differential script, SHA-256
`adb66a78c0acda1171af25f76d9bc9ad883a374181277f2220b70bbb08396525`, loaded separate fresh base
and candidate builds. Its fixed cases covered empty and unclosed documents, LF/CRLF/CR/EOF,
BOM, controls, ASCII and emoji 64 KiB boundaries, 300 controls, and a body over 512 KiB. It then
generated 10,000 strings with 0 through 95 generation steps from an 11-element alphabet with
fixed seed `0x9e3779b9`. Every sample's legacy parser return value and complete collector report
compared deep-equal. It separately checked all six projection reasons and their priority, fixed failure
identity/shape/freezing, success shape/freezing, primitive families, boxed values, ordinary and
revoked proxies, and zero observations across four proxy trap classes.

The intrinsic script, SHA-256
`32378518b22cb1b920c8cbf0579e1f7f99bd763ec566d6ab695b24a0f1347109`, combined post-import
replacement of Reflect apply, Buffer byte length, String character/slice operations, Object
definition/freezing, Array push/iteration, Object-prototype numeric and `then` accessors, and the
global Object, Array, String, and Buffer bindings. Success, control, and multibyte-overflow results
remained exact with zero poison calls. It also checked a foreign primitive string, a foreign boxed
string, and control counts 254 through 257.

The authored ten tests plus both standalone scripts passed independently on Node.js 22.23.2,
24.19.0, and 26.7.0. The private scripts are not Vitest groups and are not included in the authored
test count or tracked 44-file gate. The adversarial fresh complete gate passed the same 44 files
and 474 tracked tests with the same module and global coverage.

The adversarial review independently reported zero total and production vulnerabilities and the
same bare pack result: prepack/build success, 179 entries, 133,687 packed bytes, and 695,198
unpacked bytes. Its installed consumer independently confirmed version `0.1.0`, 18 root runtime
keys, absence of all three new names from root runtime and declarations, and
`ERR_PACKAGE_PATH_NOT_EXPORTED` for the exact internal skill-source subpath.

## Additional independent audit and workspace note

A separate contract audit added a private focused supplement with SHA-256
`265fb0902f5e21a2ddab5443dc4eaec98f49b548fb419a935b96822cd27923ca`. On Node.js 26, the authored
and private selections passed 15 of 15 tests. That audit did not provide another complete-gate,
pack, or cross-version result, so none is attributed to it here.

During that audit, the reviewer accidentally ran one `npm ci --ignore-scripts` command in the
shared workspace. It immediately verified that tracked files, HEAD, and both frozen candidate
SHA-256 values were unchanged. All remaining audit, build, and test work was performed in private
temporary space. This accidental dependency-install action is recorded transparently and is not
presented as candidate verification or as a source change.

## Frozen files

The candidate is based on `7bbd551d2e3516401a7248414180c4f7bafc2dc7`. Its frozen SHA-256
values are:

- `src/validate/skill-source.ts`:
  `bc6e9caa82b3c4b026ee849ca1147426ab98c314c2eb264a731c867bd2fe4a9e`
- `test/skill-source.test.ts`:
  `225e7537e83b047b64b5a58bdde0ab544a89447328c4e4ee75038fc772934ca9`

Only those two candidate paths differ from the frozen base. No package-root export, package export
map entry, schema, configuration surface, filesystem operation, session API, or authority API was
added.
