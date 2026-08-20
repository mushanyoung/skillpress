# Review 009h: directory-name entry reprofiling

- Slice: `feat: reprofile indexed directory names`
- Review: independent API and adversarial runtime reviews
- Date: 2026-08-20
- Frozen base: `3704f4522f385fc6e7e6796b81196ddb50e269a3`
- Final result: PASS

## Scope and guarantees

The existing internal directory-name index now exposes
`reprofileDirectoryNameIndexEntry(index, ordinal)`. The helper bridges one entry from a genuine
current-module `DirectoryNameIndex` to a newly produced genuine `ResourceNameProfile`, so the
future resource-tree capture can pass an already indexed exact name to the layout reservation API.
It adds no filesystem access, host-path handling, traversal, session state, or public package API.

The module's existing private `WeakSet` provenance is checked before reading any property from the
candidate index. Structural clones, foreign module instances, proxies, and revoked proxies cannot
substitute for a genuine index. The ordinal must be a primitive safe integer in range, must be
nonnegative, and must not be negative zero. Only then does the helper retrieve the trusted entries
array's own dense slot.

The helper invokes the module-initialization-captured resource-name profiler on the indexed exact
spelling. The result must be a current genuine successful profile, and its `exact`,
`exactByteLength`, `nfc`, `key`, and `isNfc` fields must each exactly match the five copied index
fields. Success returns a frozen wrapper containing that genuine profile. Invalid index provenance
or ordinal input returns the fixed frozen `invalid_input` result; a missing trusted slot, profiler
failure, non-current result, exception, or copied-field mismatch returns the fixed frozen
`inconsistent` result. Neither failure exposes input data or a raw exception.

This bridge does not create a new authority boundary. A genuine index can be built independently of
a filesystem read, and selecting one of its ordinals does not prove filesystem membership,
currentness, containment, or session ownership. The returned profile grants only the existing
resource-name validation provenance needed by the layout primitive. The private index brand is not
exported as a predicate, and neither the package root nor an exported package subpath exposes the
new helper or result type.

## Independent review

Two reviewers reconstructed the candidate from the frozen base in fresh private worktrees and
returned PASS with zero blockers. The API reviewer performed a line-by-line contract and authority
review, replayed the authored focused file, ran the complete repository gate, and installed the
packed artifact into an independent consumer. That review intentionally added no separate hostile
Vitest oracle: its independent-oracle count is zero groups and zero tests, distinct from its replay
of the authored one-file, six-test suite.

The adversarial reviewer separately added seven grouped runtime oracle tests. Combined with the six
authored focused tests, all 13 of 13 passed on Node.js 22.23.2, 24.19.0, and 26.7.0. Those probes
covered brand-first rejection with zero proxy traps; structural clones, foreign instances,
proxies, and revoked proxies; negative zero, overflow, and other ordinal shapes; UTF-16 index order;
UTF-8, NFC, fixed-key, and all five copied-field checks; current profile and layout provenance;
intrinsic and prototype pollution; raw-free frozen failures; and the internal export boundary.

The API review replayed the authored focused suite as one file and six tests on each of the same
three Node versions. Its fresh complete check passed 34 files and 416 tests. The adversarial
review's complete check included its additional oracle file and passed 35 files and 423 tests.
These counts are intentionally reported separately rather than treating package-consumer checks or
static review cases as Vitest tests.

Production dependency audit reported zero vulnerabilities. A real `npm pack --json` ran the
prepack build successfully and produced 155 files, a 104,091-byte tarball, and 523,884 unpacked
bytes. The independently installed consumer made three runtime assertions: the package-root object
contained neither the function name nor the result-type name, and importing the internal subpath
failed with `ERR_PACKAGE_PATH_NOT_EXPORTED`.

## Verification

The frozen candidate is based on
`3704f4522f385fc6e7e6796b81196ddb50e269a3`. Its implementation SHA-256 is
`115294ceb70fb775e7e9fe3da94d7b04eee7b5b2e44cdf8a9e9f9da17d807058`, and its focused-test
SHA-256 is `4652455d1e8d59b70469e96809549d84849e1cfc0c645d2fdc5c4cd69a899aaa`.

The authored focused verification passes six tests. The complete candidate check passes 34 test
files and 416 tests with 97.15% statement, 95.46% branch, 99.67% function, and 97.62% line
coverage. The modified directory-name-index module reaches 96.5% statements, 91.27% branches, 100%
functions, and 96.98% lines. Formatting, lint, generated-file freshness, type checking, coverage
thresholds, and `git diff --check` all pass for this pre-commit candidate.
