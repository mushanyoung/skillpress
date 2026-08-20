# Review 009l: C-local non-thenable resource-tree results

- Slice: `fix: barrier resource-tree async result records`
- Review: independent API and adversarial runtime reviews
- Date: 2026-08-20
- Frozen base: `8b7acbebb1b3a383f1d9aa052ed6f8a5b1b4a5d6`
- Final result: PASS

## Scope and guarantees

The internal resource-tree capture module now applies a C-local non-thenable barrier to every
ordinary record that it returns directly across one of its own async object boundaries. The
private `freezeAsyncResult` helper defines an own `then` data property with value `undefined`,
`enumerable: false`, `writable: false`, and `configurable: false`, then freezes the record. It uses
the module-initialization-captured `Object.defineProperty` and `Object.freeze` capabilities.

The five covered result classes are:

1. Every fixed failure singleton created by `fixedFailure`, covering all eleven capture reasons.
2. The copied `captureMetadata` success wrapper containing `ok` and `metadata`.
3. The `boundedAwait` success wrapper containing `ok` and `value`.
4. The `captureDirectory` success wrapper containing `ok`, `names`, and `metadata`.
5. The exported capture success wrapper containing `ok`, `root`, and `entries`.

`captureMetadata` deliberately copies a successful upstream lstat result instead of returning or
trying to modify that producer's frozen record. Failure paths reuse the already barriered fixed
singletons. The other private async paths return either those fixed singletons or primitive
`undefined` on success, so they do not introduce another ordinary result-record boundary.

The hidden property does not change `Object.keys`, JSON serialization, the ordinary object
prototype, or the static result types. It is intentionally visible through `Reflect.ownKeys`.
Existing deep equality over enumerable fields therefore retains the previous shapes, while native
Promise resolution finds the own `undefined` before an inherited `Object.prototype.then` getter or
callable can reinterpret one of these C-produced outer records as a thenable.

The barrier is not added to the captured root, the entries array, individual entries, metadata,
name indexes, document or root inspection parameters, or the IO snapshot. Those values are nested
or synchronous inputs rather than direct C-local async result records. The package-root exports and
the public TypeScript result vocabulary are unchanged.

## Deliberate boundary

This mitigation is strictly local to outer records constructed or selected by the resource-tree
capture module. It does not harden an upstream native or producer promise before C receives its
fulfillment. Such an upstream operation can still consult a polluted prototype, substitute a
different fulfillment value, or remain pending before C has an opportunity to copy and barrier
the value. It likewise does not modify native Promise machinery or protect nested values.

Because the property is non-enumerable, object spread, ordinary copying, JSON round trips, and
structured cloning do not preserve the barrier. A caller-created clone can therefore regain an
inherited `then`. The change is not described as provenance, authority, unforgeability, or general
thenable immunity; it only closes the reviewed C-local async return windows on the exact records
that retain the hidden descriptor.

## Independent review

Two reviewers reconstructed the frozen candidate in fresh private worktrees and returned PASS
with zero blockers. The API reviewer checked all five result classes, all eleven fixed reasons,
the exact descriptor, the absence of barriers on nested and synchronous values, and stability
under post-import replacement of live `Object.defineProperty` and `Object.freeze`. That reviewer
replayed the authored four-file, eleven-test focused selection on Node.js 22.23.2, 24.19.0, and
26.7.0; all eleven tests passed on every version.

The API reviewer also ran one separate private Node test. It exercised the early `invalid_input`
async return under both an inherited direct-callable data `then` and an inherited noncallable
accessor getter. Neither inherited path was invoked or read, while the fixed failure retained its
expected enumerable keys, frozen state, JSON shape, and exact hidden descriptor. The complete
repository gate did not include that private test and passed 39 files and 436 tests.

The adversarial reviewer independently added two different tests with oracle SHA-256
`5480b60ef84aaafe79795096139728c12f02bcb5bd6396337728eda72f902978`. One exercised an inherited
callable that would otherwise remain pending while checking fixed-result identity and shape; the
other used a getter-provided callable that would otherwise replace the fulfillment value. Combined
with the authored selection, all five files and 13 tests passed on Node.js 22.23.2, 24.19.0, and
26.7.0. That reviewer's complete gate included its two tests and passed 40 files and 438 tests.

The API review's one private case and the adversarial review's two-test oracle are distinct suites
and were not added together in a claimed complete run. The 39-file, 436-test count is the frozen
candidate without either private suite. The 40-file, 438-test count includes only the adversarial
reviewer's two additional tests. The API Node matrix contains the authored eleven tests; the
adversarial Node matrix contains those eleven plus its two tests.

Both fresh reviews reported zero production dependency vulnerabilities. A bare
`npm pack --json` ran prepack and its build successfully, producing 163 files, a 111,008-byte
tarball, and 562,858 unpacked bytes. Installed-consumer checks confirmed that the package-root
runtime and declaration surfaces did not expose the internal resource-tree capture API or its
private barrier helper. Importing the internal capture subpath remained blocked with
`ERR_PACKAGE_PATH_NOT_EXPORTED`.

## Verification

The frozen candidate is based on
`8b7acbebb1b3a383f1d9aa052ed6f8a5b1b4a5d6`. Its implementation SHA-256 is
`9c5c50e1878f3cb674ff5dc9992058e82be53ebb536dcd541fb764a37bd90094`, and its targeted-test
SHA-256 is `5ce249e008d0f724ae885bfaf5c1b7041efca9d42c51e8022bcbfa6503f8a0be`.

The authored focused selection passes four files and eleven tests. The complete frozen-candidate
check passes 39 test files and 436 tests. The resource-tree-capture module reaches 93.60%
statements, 91.47% branches, 100% functions, and 97.81% lines. Formatting, lint, generated-file
freshness, type checking, build, coverage thresholds, and `git diff --check` all pass for this
pre-commit candidate.
