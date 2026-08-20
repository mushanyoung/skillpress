# Review 008c: pinned Unicode 15.1 filename keys

- Slice: `feat: pin Unicode 15.1 filename keys`
- Reviewers: independent subagents `/root/review_unicode_provenance` and
  `/root/review_unicode_profile_api`
- Author: subagent `/root/implement_unicode_generator`, finalized by root agent
- Date: 2026-08-19
- Final result: PASS after two adversarial fixes

## Findings and resolution

The first review found that a Node build without internationalization support can implement
`String.prototype.normalize` as a no-op. The final wrapper snapshots its normalization function at
module initialization, requires a strict runtime Unicode version of at least 15.1, and verifies
both NFC and NFD sentinels. An unsupported runtime returns a frozen, input-independent failure
before inspecting the filename.

The API review then demonstrated two post-initialization intrinsic attacks. Replacing the String
iterator or `codePointAt` could bypass the assigned-scalar gate, while replacing
`String.fromCodePoint` could poison a fold result. After those were removed, replacing the Array
iterator could still corrupt tuple destructuring inside generated table searches. The final code
uses captured intrinsics, manual UTF-16 scalar traversal, explicit tuple indexes, and integer-only
binary-search midpoints. Tests replace the relevant String and Array iterators, scalar helpers,
`Reflect.apply`, `Number.isInteger`, `Object.freeze`, and normalization after module load with both
throwing and misleading implementations. The module-initialization environment itself is the
documented same-process trust boundary.

The filename key follows Unicode D145 exactly: reject scalars not assigned in Unicode 15.1, require
the original filename to be NFC, then compute `NFD(fullCaseFold15.1(NFD(value)))`. It never uses
runtime casing, locale comparison, compatibility normalization, or `Intl`; a comparison key is
opaque and is never used as a filesystem path.

## Verification

Independent UCD oracles checked all 1,114,112 code-point integers and 100,000 multi-scalar strings.
The semantic digest was
`fba04af3aa1854d8213213787e58877764ec3131041f251d29fb396fb96319a9`, with 286,292 successful
keys, 1,120 non-NFC inputs, and 826,700 unassigned inputs. Node.js 22.0.0, 24.0.0, 26.0.0,
22.23.2, 24.19.0, and 26.7.0 produced identical results.

Clean checks passed 301 tests with 97.65% statement and 96.40% branch coverage; both Unicode runtime
files reached 100% statement, branch, function, and line coverage. The production dependency audit
reported zero vulnerabilities. The npm package contains the internal runtime modules and Unicode
notices, while its root export and export map keep the helpers private.
