# Review 009k: resource-tree IO snapshot

- Slice: `refactor: snapshot resource-tree capture IO`
- Review: independent API and adversarial runtime reviews
- Date: 2026-08-20
- Frozen base: `43ab1cdfe0d58039bcd9dada170c761c9bd68a33`
- Final result: PASS

## Scope and guarantees

The internal resource-tree capture module now exports
`snapshotResourceTreeCaptureIo(value = DEFAULT_IO)`. The helper converts an unknown adapter into a
frozen `ResourceTreeCaptureIo` snapshot or returns `undefined`. The existing
`captureInspectedResourceTree` operation uses this helper at its IO-validation checkpoint; its
capture result, traversal order, budget enforcement, failure vocabulary, and package-root API are
unchanged.

An omitted or explicitly undefined value selects the module-initialization-captured default
adapter. A custom adapter must provide `lstatPath`, `openDirectory`, and `rootIsCurrent` as own data
properties with callable values. The helper reads descriptors in exactly that order and stops at
the first failure. Missing, inherited, accessor, or noncallable fields and descriptor exceptions
all return `undefined`. Property getters are never invoked. A transparent proxy may participate
through its descriptor trap, so this structural check is not described as provenance or a brand.

On success, the three current callback values are copied into a newly frozen ordinary object.
Later replacement or mutation of the source adapter cannot change the snapshot. Re-snapshotting a
valid snapshot retains the callback identities while producing another frozen snapshot with the
same exact data-property shape. The helper does not invoke a callback, examine a path, read the
filesystem, or retain the source object.

The fixed validation priority in the outer capture remains genuine document and root validation,
path invariant, invalid initial signal, IO snapshot, then already-aborted signal. Thus an invalid
signal wins without touching the IO descriptor surface, while an invalid IO adapter wins over an
already-aborted valid signal. Within the helper, `lstatPath` failure wins before
`openDirectory`, which wins before `rootIsCurrent`; no later descriptor is consulted after a
failure.

Module initialization captures descriptor lookup, invocation and freezing intrinsics as well as
the default adapter's native bindings. Post-import replacement of live intrinsics does not alter
the helper. Its return value is only a stable callback bundle. It grants no filesystem,
containment, traversal, root-currentness, session, or provenance authority, and callers remain
responsible for applying the bounded operations and authority checks appropriate to their task.
The helper is exported only from the internal source module; neither the package root nor an
exported package subpath exposes the function or its internal module.

## Independent review

Two reviewers reconstructed the frozen candidate in fresh private worktrees and returned PASS
with zero blockers. The API reviewer replayed the authored three-file, ten-test focused selection
and the complete 38-file, 435-test repository gate. The authored ten tests passed independently on
Node.js 22.23.2, 24.19.0, and 26.7.0. The API reviewer also ran a separate two-case private suite.
Its first case verified callback identity across default snapshots, exact property descriptors,
and snapshotting an existing snapshot. Its second case verified descriptor-prefix short-circuiting
at each failure position and stability after post-import mutation of
`Object.getOwnPropertyDescriptor`, `Object.freeze`, and `Reflect.apply`.

The adversarial reviewer independently added a different four-test hostile oracle with SHA-256
`7c8986f8b341c6ba66f742409dfdf50dd2abff341c44be2eeb630e0b804e1eb6`. Combined with the authored
selection, all four files and 14 tests passed on Node.js 22.23.2, 24.19.0, and 26.7.0. That
reviewer's complete gate included the four extra tests and passed 39 files and 439 tests.

The API review's two private cases and the adversarial review's four private tests are distinct
suites. They were not combined into one complete-run count: 38 files and 435 tests is the frozen
candidate without either private suite, while 39 files and 439 tests is the adversarial complete
run with only its own four-test oracle added. The Node matrix for the API review refers only to the
authored ten tests; the adversarial Node matrix contains those ten plus its four private tests.

Both fresh reviews reported zero production dependency vulnerabilities. A bare
`npm pack --json` ran prepack and its build successfully, producing 163 files, a 110,752-byte
tarball, and 561,984 unpacked bytes. Installed-consumer checks confirmed that
`snapshotResourceTreeCaptureIo` is absent from both the package-root runtime object and its root
declaration output. Importing the internal capture subpath failed with
`ERR_PACKAGE_PATH_NOT_EXPORTED`.

## Verification

The frozen candidate is based on
`43ab1cdfe0d58039bcd9dada170c761c9bd68a33`. Its implementation SHA-256 is
`e83c97307a74f2995687e3d10255b08c8a4771ae3859a0a32ba173cf7a3b6c9a`, and its targeted-test
SHA-256 is `eff5f204b411ec6bbd8a2786bfe7d716fbaba49aa5ec6bdedd70e175de87bdd7`.

The authored focused selection passes three files and ten tests. The complete frozen-candidate
check passes 38 files and 435 tests. The resource-tree-capture module reaches 93.54% statements,
91.47% branches, 100% functions, and 97.79% lines. Formatting, lint, generated-file freshness,
type checking, build, coverage thresholds, and `git diff --check` all pass for this pre-commit
candidate.
