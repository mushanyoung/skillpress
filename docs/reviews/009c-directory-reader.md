# Review 009c: bounded raw directory reader

- Slice: `feat: read bounded directory inventories`
- Review: independent implementation review and external-runtime oracle
- Date: 2026-08-20
- Frozen base: `85ce8c963778fe0127d544f89ea77394cb4b976b`
- Final result: PASS

## Scope and guarantees

The new internal reader performs one bounded directory-inventory transaction from an inspected
directory and a trusted context verifier. It copies the path, all expected bigint metadata, and
the injected verifier and IO capabilities before its first await. The default adapter opens the
directory with `{ encoding: "buffer", bufferSize: 1, recursive: false }`, so names enter the
portability pipeline as observed filesystem bytes rather than locale-decoded strings.

Exactly 1,024 entries are accepted only after a 1,025th read proves `null` EOF. A present 1,025th
entry fails as `too-many-entries` before its `name` property is inspected. For entries within the
bound, only an own `name` data descriptor whose value is a genuine `Buffer` is accepted; own and
inherited accessors are never invoked. Each buffer is capped at 255 bytes and copied immediately,
before another read can mutate the adapter-owned storage.

The handle is closed before post-read decisions, then the complete directory metadata snapshot
and caller-supplied context are revalidated. Read, close, callback, or native IO exceptions collapse
to a frozen `io` result without leaking native errors or paths. Transaction failures and detected
changes dominate inventory semantics; overflow then dominates invalid reads, oversized names,
invalid encoding, and name-index failures in that order. A malformed post-read metadata snapshot
also fails closed rather than being compared partially.

Within a stable transaction, names are decoded with fatal UTF-8, checked by an exact encode/byte
round trip, and retain a leading UTF-8 BOM as part of the filename. The decoded spelling passes
through the pinned resource-name profile and deterministic exact/NFC/fixed-fold directory index.
The reader returns only copied, deeply frozen inspection and index data. It does not open, stat, or
otherwise inspect any child path; exact observed spellings remain the only future candidates for
that later work.

This is an internal adapter boundary, not a new whole-result authority. The inspected context must
be authenticated by its caller, and the trusted verifier must establish that context before and
after the bounded read. The result therefore needs deep immutability but no independent WeakSet
provenance brand. The later resource-tree session will compose these single-directory transactions
and perform its own final inventory comparison.

Node.js exposes no portable `openat`/directory-file-descriptor traversal through these APIs, so
this operation is not an atomic filesystem snapshot. Metadata and context revalidation detect
ordinary concurrent changes, but cannot prove absence of a same-account swap-away/read/swap-back
attack that restores the compared metadata. That limitation is explicit and is not presented as a
security guarantee.

## Independent review

The independent reviewer reconstructed the candidate in a clean detached worktree under
`/private/tmp`, obtained the same 382-test candidate result, and added five separate oracle probes
for byte-level adapter behavior and bounds. All 387 checks passed with no blocker. The probes
confirmed the raw open options, exact 1,024/1,025 boundary, zero reads of overflow-name getters,
immediate buffer copying, close and revalidation behavior, error priority, fatal UTF-8 handling,
BOM preservation, and deterministic profile/index integration.

A real-filesystem matrix on Node.js 22.0.0, 24.0.0, and 26.0.0 independently observed `Buffer`
filenames from the raw directory adapter. Each runtime produced the same semantic digest, with
prefix `2a7cf`, for the exercised inventory matrix. The review also verified that the reader
performs no child IO and that the API remains internal rather than extending the package-root
surface.

## Verification

The frozen candidate is based on
`85ce8c963778fe0127d544f89ea77394cb4b976b`. Its implementation SHA-256 is
`d4d0af9695c67137f371572815e0e5ca41528b1edee43c80231a95139e897188`, and its contract-test
SHA-256 is `40344084139212557d3cd19e35870e98865ba9213d243744cba2b042d6e224e2`.

The focused implementation verification passes 39 tests. The complete candidate check passes 31
test files and 382 tests with 97.18% statement, 95.52% branch, 99.65% function, and 97.49% line
coverage. The new directory-reader module reaches 92.82% statements, 91.05% branches, 100%
functions, and 94.62% lines. Formatting, lint, generated-file freshness, type checking, coverage
thresholds, and `git diff --check` all pass for this pre-commit candidate.
