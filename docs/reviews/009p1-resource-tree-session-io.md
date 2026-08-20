# Review 009p1: compound resource-tree session IO snapshots

- Slice: `refactor: retain compound resource-tree session IO`
- Review: independent API and adversarial runtime reviews
- Date: 2026-08-20
- Frozen base: `974f428555ced9cc5e15b0ffb19a85441c6ee04f`
- Final result: PASS

## Scope and API

The new internal `resource-tree-session-io` module exports
`ResourceTreeSessionIo`, which extends both `ResourceTreeCaptureIo` and
`InspectedFileReadIo`, and one synchronous structural snapshot operation:

```ts
snapshotResourceTreeSessionIo(value?: unknown): ResourceTreeSessionIo | undefined
```

The helper adds no result union, brand, predicate, default export, read operation, path resolver,
session-context accessor, or package-root API. It does not invoke a callback or inspect a path.

An omitted or explicitly undefined input uses module-initialization-captured defaults. The three
capture callbacks are the callback identities obtained from one captured
`snapshotResourceTreeCaptureIo(undefined)` result. `openFile` is the captured native
`node:fs/promises.open`, and the `noFollow` and `nonBlock` booleans are computed at module
initialization from whether the corresponding native constants are numeric and nonzero. Each call
still produces a fresh ordinary outer object and a fresh ordinary capabilities object.

The outer snapshot has exactly these enumerable own data fields in order:
`lstatPath`, `openDirectory`, `rootIsCurrent`, `openFile`, and `capabilities`. The nested object has
exactly `noFollow` and `nonBlock`. Both objects are frozen. Re-snapshotting a successful snapshot
creates new containers while retaining all four callback identities and copying the two boolean
values.

## Custom adapter validation

A custom source is inspected in a fixed observable order. The initialization-captured capture-IO
producer first reads `lstatPath`, `openDirectory`, and `rootIsCurrent`; this module then reads own
data `openFile` and `capabilities`, followed by nested own data `noFollow` and `nonBlock`. The first
failure stops the sequence.

All four callbacks must be callable own data values. `capabilities` must be an own data non-null
object or function, and both nested values must be primitive booleans. Missing, inherited,
accessor, noncallable, nonboolean, revoked, or throwing descriptor shapes return `undefined`.
Ordinary property getters are not invoked. A transparent proxy can participate through its
descriptor trap, so this is deliberately a structural snapshot rather than a brand or provenance
check.

The capture producer's returned wrapper is not trusted by cast. This module independently reads
its three required callbacks as own data in the same order and requires each to be callable.
Producer exceptions, `undefined`, malformed records, accessors, inherited or noncallable fields,
throwing or revoked proxies, and other contradictions all normalize to `undefined` without raw
failure data.

On success, only the four callback values and two booleans are copied. Source extras are dropped;
the source outer and nested containers are not retained; and later source mutation cannot replace
a retained callback or capability value. Module initialization captures invocation, descriptor,
and freezing intrinsics as well as the producer and native binding. Post-import changes to their
live properties do not redirect the snapshot.

## Session integration and identity

`openInspectedResourceTreeSession` now calls the compound snapshot helper exactly once at its
existing IO checkpoint. Its private session context retains that exact frozen compound object.
Both opening observations and every later currentness observation pass the same compound object
identity to `captureInspectedResourceTree`; the baseline remains the second successful capture and
is still never updated by a currentness check.

The capture module deliberately applies its own narrower boundary on every capture call. It
creates a distinct frozen `ResourceTreeCaptureIo` wrapper each time, containing only
`lstatPath`, `openDirectory`, and `rootIsCurrent`. Those narrow wrapper identities are not the
retained compound identity and are not equal to one another, while their three callback references
are exactly the references retained in the compound snapshot. This distinction preserves the
capture module's reviewed adapter boundary without allowing adapter replacement across session
observations.

The public session signature and all result and failure types are unchanged. Validation priority
remains genuine document, invalid initial signal, complete compound IO snapshot, then an already
aborted valid signal. Consequently, a formerly accepted custom capture-only adapter now returns
`io`, including when the signal is already aborted; a complete compound adapter with that signal
returns `aborted` without invoking any of its four callbacks.

Capture settlement checkpoints, comparison, final signal sampling, second-observation baseline,
last-step `WeakMap` registration, currentness behavior, and all existing non-thenable barriers are
unchanged. No async step or callback was added after successful registration.

## Capability and authority boundary

The retained callbacks are caller-supplied capabilities and remain a behavioral trust boundary.
Freezing their identities does not make their behavior honest, deterministic, current, or safe;
the functions can still consult their own mutable closure or external state when later invoked.
The snapshot does not authorize an entry, member, component, or path and does not prove
containment, openat-style identity, atomicity, permanent freshness, or swapback resistance.

The session brand still records only two equal complete observations through one retained adapter.
This prep exposes neither the compound adapter nor its callbacks from a session and adds no file
read API. The helper and type are internal source-module exports only; neither is available from
the package root or an exported package subpath.

## Authored verification

The authored focused selection is three files and 12 tests: the new session-IO tests, the existing
session tests, and the capture-IO regression tests. It covers omitted and explicit defaults,
custom and re-snapshot identity, exact outer and nested shapes, fixed descriptor order and prefix
short-circuiting, every required malformed field class, hostile producer outputs, source mutation,
compound retention, session validation priority, capture-only rejection, post-import intrinsic
and native-binding mutation, ordinary prototypes, freezing, and internal export boundaries.

All 12 focused tests pass. The tracked candidate's fresh complete gate passes 43 files and 462
tests. The new session-IO module reaches 100% statements, 100% branches, 100% functions, and 100%
lines; the session module remains at 97.22% statements, 100% branches, 100% functions, and 96.77%
lines. Global coverage is 96.50% statements, 95.02% branches, 99.75% functions, and 97.70% lines.
Formatting, lint, generated-file freshness, type checking, build, coverage thresholds, and diff
checks pass in the independent complete gates.

## API and release review

The API reviewer reconstructed the exact base in a fresh private snapshot with `git archive`,
copied the four frozen files, and verified every SHA-256 before running dependencies or gates. It
returned FINAL PASS with zero blockers. It replayed the authored three-file, 12-test selection on
Node.js 22.23.2, 24.19.0, and 26.7.0; all 12 tests passed on every version. Its complete gate passed
43 files and 462 tests.

That reviewer also ran one separate built-distribution scenario with 34 assertions. Under
post-import replacement of live `Reflect.apply`, `Object.freeze`, and
`Object.getOwnPropertyDescriptor`, it verified the first snapshot's existence; both outer and
nested descriptor order, exact keys, and frozen state; zero callback and poison calls; four
callback identities and two capability values; and no retention of either source container. It
mutated the source and confirmed the first snapshot remained stable, then verified a second
snapshot's existence, fresh outer and nested identities, and copied updated callbacks and
capabilities. Finally, omitted and explicitly undefined defaults were both present with fresh
containers, four stable callback identities, and two boolean capabilities. The 34 assertions are
a separate inline scenario and are not added to the authored 12 tests or tracked 43-file, 462-test
gate.

The API review reported zero production dependency vulnerabilities. Its bare `npm pack --json`
ran prepack and build successfully and produced 179 files, a 128,994-byte tarball, and 665,282
unpacked bytes. Its six fresh-consumer checks confirmed package version `0.1.0`; absence of
`snapshotResourceTreeSessionIo` and `ResourceTreeSessionIo` from both root runtime own exports and
the root declaration output; and `ERR_PACKAGE_PATH_NOT_EXPORTED` for
`@mushanyoung/skillpress/dist/validate/resource-tree-session-io.js`.

## Adversarial review

The adversarial reviewer independently added one private file with four tests, SHA-256
`08b8188933ee5b6fb9ea7d537a7098bb7b51069b27fd9737894f8c3a4bc5a2a4`:

1. It locked the outer five-field and nested two-field proxy descriptor traces, zero accessor
   calls, revoked-proxy rejection, strict booleans, exact frozen output, and prefix failure order.
2. It used `syncBuiltinESMExports()` to strengthen the native-open mutation probe and combined it
   with post-import Reflect and Object pollution. Default callback references and capability
   booleans remained stable with zero poison calls.
3. It combined the real compound helper with a mocked capture to verify
   document-over-signal-over-IO-over-abort priority, zero capture calls for pre-abort failure,
   source-mutation isolation, one session snapshot, and exact retained compound identity for the
   opening A/B and currentness calls. On every mocked capture call, the oracle invoked the real
   capture-IO snapshot helper; it produced a distinct narrow wrapper each time, while all three
   narrow callback references equaled the retained compound references.
4. It installed an inherited `then` getter and callable during comparison and queued an abort in a
   microtask. Registration still completed successfully before that later microtask; the getter
   and callable were never invoked, preserving the final registration and result-barrier window.

For its cross-version combination, the reviewer selected the two authored session-IO and session
files, nine tests total, plus its four-test private file. All three files and 13 tests passed on
Node.js 22.23.2, 24.19.0, and 26.7.0. The capture-IO regression file belongs to the authored
three-file, 12-test gate but was not included in this adversarial Node combination.

The adversarial review's tracked-only complete gate passed 43 files and 462 tests. With its private
file installed, the complete gate passed 44 files and 466 tests with global coverage of 96.50%
statements, 95.02% branches, 99.75% functions, and 97.70% lines. The API inline scenario and
adversarial private file are separate evidence and were not combined in a claimed test count.

The adversarial review independently reported zero production dependency vulnerabilities and the
same bare pack result: prepack build success, 179 files, 128,994 packed bytes, and 665,282 unpacked
bytes. Its installed consumer confirmed package version and the absence of
`ResourceTreeSessionIo`, `snapshotResourceTreeSessionIo`, `ResourceTreeSession`,
`ResourceTreeSessionFailureReason`, `openInspectedResourceTreeSession`,
`isGenuineResourceTreeSession`, and `resourceTreeSessionIsCurrent` from both root runtime and root
declaration surfaces. Both exact internal subpaths,
`@mushanyoung/skillpress/dist/validate/resource-tree-session-io.js` and
`@mushanyoung/skillpress/dist/validate/resource-tree-session.js`, failed with
`ERR_PACKAGE_PATH_NOT_EXPORTED`.

## Frozen files

The candidate is based on `974f428555ced9cc5e15b0ffb19a85441c6ee04f`. The four frozen
SHA-256 values are:

- `src/validate/resource-tree-session-io.ts`:
  `25d9ae4bfbaa7e61b5a1efd3cd1c4e9ef97a7dc2c048e96bdda14bef6cff0dbd`
- `src/validate/resource-tree-session.ts`:
  `6a4064a111bb9624e5498d425ffc4aa8ebeb8c9d5b91007587cc8222577b4462`
- `test/resource-tree-session-io.test.ts`:
  `898bd42dc203ececea1c65ad63b565b262b28d1a2dcb4b512d88e96b1adb95a6`
- `test/resource-tree-session.test.ts`:
  `260b476b04fcadb28fc127a3c86aa9dc058f9a0451aa983678d6d0cf8957c541`

The new production module is 109 lines and its paired test is 240 lines. The existing session
production diff is a net two lines and its focused-test diff is a net 49 lines. Only these four
frozen files and this review record belong to the slice; no package-root export, export-map entry,
schema, read API, or public configuration surface was added.
