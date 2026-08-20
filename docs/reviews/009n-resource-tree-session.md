# Review 009n: two-observation resource-tree sessions

- Slice: `feat: open branded resource-tree sessions`
- Review: independent API and adversarial runtime reviews
- Date: 2026-08-20
- Frozen base: `b201b4ca22d57012192a80601a2366dbc2d2692d`
- Final result: PASS

## Scope and API

The new internal `resource-tree-session` module exports three runtime operations:

- `openInspectedResourceTreeSession(document, signal, io)` observes one genuine document twice.
- `isGenuineResourceTreeSession(value)` recognizes only identities registered by this module.
- `resourceTreeSessionIsCurrent(session, signal)` compares one new observation with the retained
  baseline without updating that baseline.

It also exports the internal `ResourceTreeSession` and result types. The failure-reason alias is
exactly the capture vocabulary: `invalid_input`, `aborted`, `changed`, `invalid_inventory`,
`invalid_metadata`, `unsupported_kind`, `too_many_entries`, `too_deep`, `paths_too_large`,
`inconsistent`, and `io`. Failures are fixed frozen records containing only `ok` and `reason` as
enumerable fields. Neither the runtime operations nor their types are exported from the package
root or through an importable package subpath.

A successful session exposes only the second capture's frozen `root` and `entries`. A private
module-owned `WeakMap` associates that exact session identity with the genuine document, the one
frozen IO snapshot used to open it, and the second capture as its baseline. The TypeScript type has
a private unique-symbol nominal member, but no runtime brand property is added. Clones, structural
lookalikes, proxies, revoked proxies, functions, and sessions made by a different module instance
are not registered identities. The brand predicate and currentness lookup consult the captured
`WeakMap` operations and do not inspect caller properties.

## Two-observation protocol

Opening first validates the genuine document without reading properties from an invalid value,
samples the cooperative signal, and snapshots the IO adapter exactly once. An invalid initial
signal wins before IO inspection; an invalid IO adapter wins over an already-aborted valid signal.
Both captures then receive the same genuine document, signal value, and frozen IO snapshot.
Mutating the caller's original adapter after snapshotting cannot substitute a callback between the
two observations or during later currentness checks.

After each awaited private capture observation settles, the outer operation samples the signal
before branching on or returning its normalized outcome. This closes the outer
Promise-continuation window: an abort or newly invalid signal queued after capture settlement
overrides a fulfilled failure, malformed value, or rejection, and prevents the second capture,
comparison, or registration as appropriate. Capture failures preserve their eleven fixed reasons;
a thrown, rejected, proxy, or malformed capture result becomes `inconsistent` without exposing a
raw value or exception.

The two successful observations are compared with the captured semantic comparator. `different`
maps to `changed`; `invalid` or a comparator exception maps to `inconsistent`. Only `equal` proceeds
to registration. The session, its frozen private context, and its successful outer result are fully
constructed before the final signal sample. If that sample remains active, the only remaining
operation is the captured `WeakMap.set`, followed by immediate return. No await, caller callback,
adapter access, or object construction occurs after registration.

Currentness checks require a registered session identity before examining the signal. They perform
one fresh capture with the retained genuine document and the exact retained IO snapshot, sample
immediately after its await, compare it with the fixed second-observation baseline, and sample once
more after comparison. An invalid comparison returns `inconsistent`; a semantic difference returns
the fixed success `{ok: true, current: false}`; equality returns the fixed success
`{ok: true, current: true}`. The original baseline is never replaced, so a changed tree does not
become current merely because the same changed state is observed again.

## Async-result barrier and authority boundary

Every session failure, open success, current true/false result, and successful private capture
observation has an own `then: undefined` data property that is non-enumerable, non-writable, and
non-configurable before the record is frozen. The session object itself has the same barrier. The
module uses initialization-captured `Object.defineProperty` and `Object.freeze`, so later mutation
of those live intrinsics cannot reopen the reviewed inherited-thenable windows. The hidden field
does not change the enumerable API or JSON shape.

This barrier remains local to records constructed by the session module. It does not harden an
upstream Promise before settlement, native Promise machinery, the document, IO adapter, or nested
capture values. Copying or serializing a barriered record need not preserve its hidden property.

Likewise, a session brand records that two complete observations compared equal through one
caller-trusted adapter at open time. It is not proof of permanent freshness, openat-style handle
authority, atomic filesystem identity, containment, or immunity to path replacement and swapback
between observations. `resourceTreeSessionIsCurrent` is another bounded observation through that
same adapter, not a transaction or an authority upgrade. Injected IO remains an explicit trust
boundary.

Module initialization captures signal sampling, capture, comparison, document recognition, IO
snapshotting, proxy detection, own-data descriptor lookup, freezing, property definition,
`Reflect.apply`, and the relevant `WeakMap` methods. Post-import replacement of those live
intrinsics or producer bindings does not redirect the session protocol.

## Independent review

Two reviewers reconstructed the frozen candidate in fresh private worktrees and returned PASS
with zero blockers. The API reviewer added a distinct one-file, two-test private suite. Its first
case rejected a captured Promise and queued an abort before the session continuation, confirming
that `aborted` overrides `inconsistent` while the second capture and comparator remain uncalled.
Its second case installed an inherited `Object.prototype.then` getter and callable during
comparison, then confirmed successful registration with zero getter or callable invocations and
the exact hidden descriptor on both the outer wrapper and session.

The API reviewer replayed the authored one-file, six-test focused selection independently on
Node.js 22.23.2, 24.19.0, and 26.7.0; all six tests passed on every version. The private two-test
suite was run separately and is not attributed to that cross-version matrix. That reviewer's fresh
complete repository gate passed 41 files and 447 tests.

The adversarial reviewer independently added one trace-oracle test with SHA-256
`28f916d96143912e24886f8dcefb967bf22de516ea0248cbff7680a486faab44`. It verified the exact open
trace `document -> sample -> snapshot -> A -> sample -> B -> sample -> compare -> sample`, then
verified that two currentness calls reused the same retained IO and each compared its fresh capture
with the fixed second-pass baseline. Combined with the authored suite, both files and all seven
tests passed independently on Node.js 22.23.2, 24.19.0, and 26.7.0. The adversarial review's
separate fresh complete candidate gate, without that private oracle installed, passed 41 files and
447 tests.

The API review's two private tests and the adversarial review's one trace oracle are distinct and
were not combined into a claimed complete-run count. The 41-file, 447-test candidate gate does not
mean that all three private tests were installed together.

The API reviewer reported zero production dependency vulnerabilities. Its bare
`npm pack --json` completed prepack and build successfully, producing 171 files, a 120,491-byte
tarball, and 613,536 unpacked bytes. The adversarial review's installed-consumer checks confirmed
that `ResourceTreeSession`, `ResourceTreeSessionFailureReason`,
`openInspectedResourceTreeSession`, `isGenuineResourceTreeSession`, and
`resourceTreeSessionIsCurrent` were all absent as package-root runtime keys and as names in the
root declaration output. Importing the internal session subpath failed with
`ERR_PACKAGE_PATH_NOT_EXPORTED`.

## Verification

The frozen candidate is based on
`b201b4ca22d57012192a80601a2366dbc2d2692d`. Its implementation SHA-256 is
`e4f790847bd6f6c9e0d47d65555ddfebdddf4c59bd359702f10d87c7aec6f6ed`, and its targeted-test
SHA-256 is `6bbfab2a701685b20595e5d00d203f9322b8541155e677c8b6e08d6d3ad01160`.

The authored focused file passes all six tests. The frozen candidate's complete gate passes 41
test files and 447 tests. The resource-tree-session module reaches 97.22% statements, 100%
branches, 100% functions, and 96.77% lines. The authored suite covers stable real-filesystem open
and currentness, change detection without baseline replacement, both-pass failure propagation,
capture and comparison normalization, abort checkpoints including queued post-settlement changes,
adapter retention, identity-only branding, exact result barriers, intrinsic pollution, deep-frozen
public shape, and the package export boundary. Formatting, lint, generated-file freshness, type
checking, build, coverage thresholds, and `git diff --check` pass in the fresh complete gates.
